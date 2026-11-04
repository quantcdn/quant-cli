/**
 * `quant serve`: run a built Quant edge site on this machine.
 * It needs no token and does not call config.fromArgs(). It reads quant.json
 * only for clientid and project, and a broken quant.json is ignored.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { text, isCancel } from '@clack/prompts';
import { createVirtualClock } from '@quantcdn/edge-kv';
import { startServer } from '../serve/server.js';
import { DEFAULT_FILES, loadProject } from '../serve/project.js';
import { openLocalKv } from '../serve/kv/wire.js';
import { LEDGERS_FILE, readLedgerFile } from '../serve/kv/ledgers.js';
import { readServeConfig } from '../serve/project-config.js';
import { createPortalClient, portalOptions, requestBudget } from '../serve/portal/client.js';
import { pullProject } from '../serve/portal/pull-rules.js';
import { readRemoteStore, remoteLines } from '../serve/kv/remote.js';

const DEFAULTS = Object.freeze({ dir: 'dist', port: 8787, host: '127.0.0.1', org: 'local', project: 'dev', userName: 'Owner' });
const IDENTITY_HELP = 'pass --org and --project, or set them in quant/serve.json or quant.json.';
const PULL_IDENTITY = `--pull-rules needs the portal organisation and project: ${IDENTITY_HELP}`;
const REMOTE_IDENTITY = `--kv-remote needs the portal organisation and project: ${IDENTITY_HELP}`;
const CLOCKS = ['real', 'manual'];
const LOOPBACK_HOSTS = ['127.0.0.1', '::1', 'localhost'];
const POSIX = process.platform !== 'win32';
/** The signals that stop quant serve. SIGHUP comes when the terminal closes. */
export const STOP_SIGNALS = Object.freeze(['SIGINT', 'SIGTERM', 'SIGHUP']);
export const RUN_GRACE_MS = 2000;
/** How long to wait for the --proxy URL after the --run command exits 0. */
export const RUN_BACKGROUND_WAIT_MS = 5000;

/** The first value that is set (not undefined, null or ''), else the fallback. */
function first(values, fallback) {
  const found = values.find((value) => value !== undefined && value !== null && value !== '');
  return found === undefined ? fallback : found;
}

function readQuantJson(root) {
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(root, 'quant.json'), 'utf8'));
    return saved && typeof saved === 'object' ? saved : {};
  } catch (_err) {
    return {};
  }
}

function readGitUserName(root) {
  try {
    const result = spawnSync('git', ['config', 'user.name'], { cwd: root, encoding: 'utf8' });
    return result.status === 0 ? result.stdout.trim() : null;
  } catch (_err) {
    return null;
  }
}

function portOf(value) {
  const port = Number(first([value], DEFAULTS.port));
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be a port number (0-65535)');
  return port;
}

function geoOf(value) {
  if (value === undefined || value === null || value === '') return undefined;
  let geo;
  try {
    geo = JSON.parse(value);
  } catch (_err) {
    geo = null;
  }
  if (!geo || typeof geo !== 'object' || Array.isArray(geo)) throw new Error('--geo must be a JSON object');
  return geo;
}

function proxyOf(value) {
  if (!value) return undefined;
  let url = null;
  try {
    url = new URL(value);
  } catch (_err) {
    url = null;
  }
  if (!url || !['http:', 'https:'].includes(url.protocol)) throw new Error('--proxy must be an http or https URL');
  return value;
}

function kvLagOf(value) {
  const lag = Number(first([value], 0));
  if (!Number.isSafeInteger(lag) || lag < 0) throw new Error('--kv-lag must be a whole number of milliseconds');
  return lag;
}

function clockOf(value) {
  const clock = first([value], 'real');
  if (!CLOCKS.includes(clock)) throw new Error('--clock must be real or manual');
  return clock;
}

function siteOptions(args, local) {
  return {
    dir: first([args.dir], DEFAULTS.dir),
    port: portOf(args.port),
    host: first([args.host], DEFAULTS.host),
    functions: first([args.functions], DEFAULT_FILES.functions),
    rules: first([args.rules], DEFAULT_FILES.rules),
    meta: first([args.meta, local.meta], DEFAULT_FILES.meta),
    fixtures: first([args.fixtures], DEFAULT_FILES.fixtures)
  };
}

// A warning for each of org and project that quant/serve.json and quant.json
// set to different values, when no flag chooses: quant/serve.json wins.
function precedenceWarnings(args, local, saved) {
  const fields = [
    { name: 'org', flag: first([args.org, args.clientid], undefined), saved: saved.clientid, field: 'clientid' },
    { name: 'project', flag: first([args.project], undefined), saved: saved.project, field: 'project' }
  ];
  return fields
    .filter((item) => item.flag === undefined && local[item.name] !== undefined && first([item.saved], undefined) !== undefined &&
      String(item.saved) !== local[item.name])
    .map((item) => `quant/serve.json ${item.name} "${local[item.name]}" is used, not quant.json ${item.field} "${item.saved}": ` +
      `quant/serve.json wins over quant.json. Pass --${item.name} to choose.`);
}

function identityOptions(args, root, gitUserName, local) {
  const saved = readQuantJson(root);
  return {
    configWarnings: precedenceWarnings(args, local, saved),
    org: first([args.org, args.clientid, local.org, saved.clientid], DEFAULTS.org),
    project: first([args.project, local.project, saved.project], DEFAULTS.project),
    domain: first([args.domain], undefined),
    userName: first([args['user-name'], gitUserName(root)], DEFAULTS.userName)
  };
}

// True when the org and project are named (the local defaults are not a portal project).
function portalIdentity(args, root, local) {
  const saved = readQuantJson(root);
  const org = first([args.org, args.clientid, local.org, saved.clientid], undefined);
  const project = first([args.project, local.project, saved.project], undefined);
  return org !== undefined && project !== undefined;
}

// --pull-rules reads the rules of a real project, so the org and project
// must be named.
function pullOptions(args, root, local) {
  if (args['pull-rules'] !== true) return { pullRules: false };
  if (!portalIdentity(args, root, local)) throw new Error(PULL_IDENTITY);
  return { pullRules: true };
}

// --kv-remote <name> reads one store of a real project.
function remoteOptions(args, root, local) {
  const name = args['kv-remote'];
  if (name === undefined || name === null || name === false) return { kvRemote: undefined };
  if (typeof name !== 'string' || name === '') throw new Error('--kv-remote needs the name of a KV store in quant/meta.json.');
  if (!portalIdentity(args, root, local)) throw new Error(REMOTE_IDENTITY);
  return { kvRemote: name };
}

function kvOptions(args) {
  return {
    reset: args.reset === true,
    memory: args.memory === true,
    seedKey: first([args['seed-key']], undefined),
    kvLag: kvLagOf(args['kv-lag']),
    indexes: first([args.indexes], 'active'),
    clock: clockOf(args.clock)
  };
}

function devOptions(args) {
  return {
    geo: geoOf(args.geo),
    clientIp: first([args['client-ip']], undefined),
    build: first([args.build], undefined),
    watch: args.watch === true,
    run: first([args.run], undefined),
    proxy: proxyOf(args.proxy)
  };
}

/**
 * The serve options from the parsed flags (CLI) or the menu answers, with
 * the defaults filled in.
 * @param {Object} args
 * @param {{ root?: string, gitUserName?: (root: string) => string|null }} [deps]
 */
export function resolveOptions(args, { root = process.cwd(), gitUserName = readGitUserName } = {}) {
  // The org, project and meta defaults of quant/serve.json (a flag wins).
  const local = readServeConfig(root).defaults;
  return {
    root,
    ...siteOptions(args, local),
    ...identityOptions(args, root, gitUserName, local),
    ...pullOptions(args, root, local),
    ...remoteOptions(args, root, local),
    ...kvOptions(args),
    ...devOptions(args)
  };
}

function section(title, items) {
  return items.length > 0 ? [title, ...items.map((item) => `  ${item}`)] : [];
}

function keysBox(keys) {
  if (keys.length === 0) return [];
  const rows = keys.flatMap((key) => [key.label, key.value, '']).slice(0, -1);
  const width = Math.max(...rows.map((row) => row.length));
  return [
    'Save these keys now. quant serve shows each key one time:',
    `┌${'─'.repeat(width + 2)}┐`,
    ...rows.map((row) => `│ ${row.padEnd(width)} │`),
    `└${'─'.repeat(width + 2)}┘`
  ];
}

function networkWarning(host) {
  if (LOOPBACK_HOSTS.includes(host)) return [];
  return [`--host ${host}: the local site, its KV data and its keys are reachable on the network.`];
}

// With --clock real the ledgers are declared with wait: true, so each one is
// ACTIVE at start. With --clock manual the activation follows the manual clock.
function ledgerLines(ledgers, clock) {
  const when = clock === 'manual'
    ? 'active after the activation delay on the manual clock'
    : 'active at start: quant serve skips the activation delay';
  const title = `Ledgers (from ${LEDGERS_FILE}, ${when}):`;
  return section(title, ledgers.map(({ store, defs }) => `${store} → ${defs.map((def) => def.name).join(', ')}`));
}

function pullLines(pull) {
  return pull ? [`Pulled ${pull.count} portal rules (${pull.local} from quant/edge-rules.json).`] : [];
}

function clockLines(clock) {
  return clock === 'manual' ? ['Clock: manual. Time moves only with POST /_quant_serve/clock.'] : [];
}

/**
 * The start-up output: the URL, the stores, the ledgers, the clock, the
 * rules, the edge libraries from the project, the warnings, then the
 * revealed keys in a box.
 */
export function startupLines({ url, host, summary, keys = [], ledgers = [], clock = 'real', pull = null, remote = [] }) {
  const libraries = summary.libraries.length > 0 ? summary.libraries.join(', ') : 'none';
  return [
    `quant serve is running at ${url}`,
    ...pullLines(pull),
    ...section('KV stores:', summary.stores.map((store) => `${store.name} → ${store.location || store.id}`)),
    ...remote,
    ...ledgerLines(ledgers, clock),
    ...clockLines(clock),
    ...section('Rules:', summary.rules.map((rule) => `${rule.id} ${rule.type} ${rule.urls.join(' ')}`)),
    `Edge libraries from the project: ${libraries}`,
    ...section('Warnings:', [...networkWarning(host), ...summary.warnings]),
    ...keysBox(keys),
    'Press Ctrl+C to stop.'
  ];
}

function runBuild(command, root) {
  const result = spawnSync(command, { shell: true, stdio: 'inherit', cwd: root });
  if (result.error) throw new Error(`The --build command could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`The --build command failed with exit code ${result.status ?? result.signal}.`);
}

function rebuild(options, print) {
  try {
    runBuild(options.build, options.root);
  } catch (err) {
    print(err.message);
  }
}

// On POSIX the --run command gets its own process group, so that a stop
// also ends the processes that the shell starts. Its stdin is not the
// terminal, because a background process group cannot read the terminal.
function startRun(command, root, print, proxy) {
  const child = spawn(command, {
    shell: true,
    cwd: root,
    detached: POSIX,
    stdio: POSIX ? ['ignore', 'inherit', 'inherit'] : 'inherit'
  });
  child.on('error', (err) => print(`The --run command could not start: ${err.message}`));
  // stopRun aborts the wait for the --proxy URL, so that it never keeps Node alive.
  child.runAbort = new AbortController();
  child.on('exit', (code, signal) => {
    if (child.stopping) return;
    runExitLine(child, { code, signal, proxy, abort: child.runAbort.signal }).then((line) => {
      if (!child.stopping) print(line);
    });
  });
  return child;
}

function groupAlive(pid) {
  if (!POSIX) return false;
  try {
    process.kill(-pid, 0);
    return true;
  } catch (_err) {
    return false;
  }
}

function requestSignal(abort) {
  const timeout = AbortSignal.timeout(500);
  return abort && AbortSignal.any ? AbortSignal.any([timeout, abort]) : timeout;
}

async function answers(url, abort) {
  try {
    await fetch(url, { redirect: 'manual', signal: requestSignal(abort) });
    return true;
  } catch (_err) {
    return false;
  }
}

// A delay that ends at once when abort fires.
function pause(ms, abort) {
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      if (abort) abort.removeEventListener('abort', done);
      resolve();
    }
    if (abort) abort.addEventListener('abort', done, { once: true });
  });
}

// True when the dev server answers within waitMs (it can still be starting).
// False at once when abort fires.
async function reachable(url, waitMs, abort) {
  const deadline = Date.now() + waitMs;
  while (!(abort && abort.aborted)) {
    if (await answers(url, abort)) return true;
    if (Date.now() >= deadline) return false;
    await pause(200, abort);
  }
  return false;
}

/**
 * The line to print when the --run command exits by itself. Some dev servers
 * move to the background and the command exits 0. When its process group is
 * still alive, quant serve stops that group on exit. When only the --proxy
 * URL still answers (the dev server left the group, or on Windows), quant
 * serve cannot stop it.
 */
export async function runExitLine(child, { code, signal, proxy, waitMs = RUN_BACKGROUND_WAIT_MS, abort }) {
  const stopped = `The --run command stopped (${signal || `exit code ${code}`}).`;
  if (signal || code !== 0) return stopped;
  if (groupAlive(child.pid)) {
    return 'The --run command moved to the background (exit code 0). quant serve keeps serving and stops its process group when quant serve stops.';
  }
  if (proxy && await reachable(proxy, waitMs, abort)) {
    return `The --run command exited (exit code 0), but the dev server at ${proxy} still answers. quant serve keeps serving, but it cannot stop that dev server. Stop it yourself.`;
  }
  return stopped;
}

function signalGroup(child, signal) {
  try {
    if (POSIX) process.kill(-child.pid, signal);
    else child.kill(signal);
  } catch (_err) {
    // The process group has already ended.
  }
}

function running(child) {
  return Boolean(child && child.pid && child.exitCode === null && child.signalCode === null);
}

async function waitForGroupEnd(pid, graceMs) {
  const deadline = Date.now() + graceMs;
  while (groupAlive(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return !groupAlive(pid);
}

function abortExitWait(child) {
  if (child && child.runAbort) child.runAbort.abort();
}

/**
 * Stop the --run command: SIGTERM to its process group, then SIGKILL when
 * the group is still alive after the grace period.
 */
export async function stopRun(child, { graceMs = RUN_GRACE_MS } = {}) {
  abortExitWait(child);
  if (!child || !child.pid || (!POSIX && !running(child))) return;
  child.stopping = true;
  signalGroup(child, 'SIGTERM');
  if (!POSIX) return;
  if (!(await waitForGroupEnd(child.pid, graceMs))) signalGroup(child, 'SIGKILL');
}

// On an unexpected process exit there is no time for a grace period.
function killRun(child) {
  if (child && child.pid) signalGroup(child, 'SIGKILL');
}

/** Resolve on the first stop signal. */
export function waitForSignal(signals = STOP_SIGNALS) {
  return new Promise((resolve) => {
    const done = () => {
      for (const signal of signals) process.off(signal, done);
      resolve();
    };
    for (const signal of signals) process.on(signal, done);
  });
}

// --clock manual: a virtual clock that moves only with the control route.
function backendClock(mode) {
  return mode === 'manual' ? { clock: createVirtualClock(Date.now()) } : {};
}

// --kv-remote: the store must be in meta.json (so functions may open it).
// The portal is read before the local state is opened.
async function remoteSnapshot(options, stores, portal) {
  const name = options.kvRemote;
  if (!name) return null;
  if (!stores.some((store) => store.name === name)) throw new Error(`--kv-remote ${name} is not a KV store in quant/meta.json.`);
  return readRemoteStore({ name, org: options.org, project: options.project }, portal);
}

// The start-up lines of the remote store, after it is in the local KV.
async function loadRemote(kv, snapshot, ledgers) {
  if (!snapshot) return null;
  const built = await kv.loadRemote(snapshot);
  return { name: snapshot.name, lines: remoteLines(snapshot, built, ledgers) };
}

// The local KV of the project (unless the caller gives a kvStore): open the
// state, declare the meta.json stores and indexes and the local ledgers,
// then seed new stores, then put the --kv-remote snapshot in memory.
async function localKv(options, { log, print, portal }) {
  const files = { root: options.root, functions: options.functions, rules: options.rules, meta: options.meta, fixtures: options.fixtures };
  const { stores, fixtures } = loadProject(files);
  const ledgers = readLedgerFile({ root: options.root, stores, meta: options.meta });
  const snapshot = await remoteSnapshot(options, stores, portal);
  const kv = await openLocalKv({
    root: options.root, org: options.org, project: options.project, stores, ledgers, remote: options.kvRemote,
    memory: options.memory, reset: options.reset, lagMs: options.kvLag, indexState: options.indexes,
    warn: log, ledgerWait: options.clock !== 'manual', realTime: options.clock === 'real', ...backendClock(options.clock)
  });
  if (kv.offsetCleared) print('The local clock offset was cleared (--clock real).');
  const withFile = (list) => list.map((key) => ({ ...key, file: kv.paths ? kv.paths.revealKeys(key.storeId) : null }));
  let seeded;
  try {
    seeded = await kv.seed({ fixtures, userName: options.userName, seedKey: options.seedKey });
  } catch (err) {
    showKeys(withFile(err.revealed || []), print);
    throw err;
  }
  const keys = withFile(seeded.revealed);
  const remote = await loadRemote(kv, snapshot, ledgers);
  return {
    kvStore: kv.kvStore, backend: kv.backend, ledgers, keys, warnings: kv.warnings,
    location: kv.paths ? kv.paths.file : 'memory', remote
  };
}

// --pull-rules: read the portal rules and global headers one time. They
// stay in memory only. QUANT_API_TOKEN and QUANT_BASE_URL come from the
// environment; the org and project are the serve identity.
async function pulledProject(options, { env = process.env, fetchImpl, budget } = {}) {
  if (!options.pullRules) return null;
  const { customer, project, token, base } = portalOptions({ clientid: options.org, project: options.project }, env, '--pull-rules');
  const client = createPortalClient({ base, token, budget, ...(fetchImpl ? { fetchImpl } : {}) });
  return pullProject(client, { customer, project });
}

// The start-up summary of a pull: the pulled rules and the local rules merged in.
function pullSummary(pulled, server) {
  return pulled ? { count: pulled.count, local: server.summary.localRules } : null;
}

function withPull(options, pulled) {
  return pulled ? { ...options, pulledRules: pulled.rules, pulledHeaders: pulled.headers } : options;
}

function serverOptions(options, { kvStore, backend, log }, print) {
  return {
    ...options,
    kvStore,
    backend,
    log,
    onSourceChange: options.watch && options.build ? () => rebuild(options, print) : undefined
  };
}

function stderrLine(line) {
  process.stderr.write(`${line}\n`);
}

// The kvStore that the caller gives, else the local KV.
async function kvFor(options, { kvStore, log, print, portal }) {
  return kvStore ? { kvStore, given: true } : localKv(options, { log: log || stderrLine, print, portal });
}

// The KV state location of a store in the start-up lines.
function storeLocation(store, kv) {
  if (kv.remote && store.name === kv.remote.name) return `${store.id} in memory (snapshot from the portal)`;
  return `${store.id} in ${kv.location}`;
}

// The start-up summary and keys, with the KV state location, warnings, ledgers and revealed keys.
function startupSummary(summary, kv) {
  if (kv.given) return { summary, keys: [] };
  return {
    ledgers: kv.ledgers,
    remote: kv.remote ? kv.remote.lines : [],
    summary: {
      ...summary,
      stores: summary.stores.map((store) => ({ ...store, location: storeLocation(store, kv) })),
      warnings: [...summary.warnings, ...kv.warnings]
    },
    keys: kv.keys
  };
}

// Print the revealed keys and the keys files.
function showKeys(keys, print) {
  for (const line of keysBox(keys)) print(line);
  for (const file of new Set(keys.map((key) => key.file).filter(Boolean))) print(`The keys are also in ${file}.`);
}

// The seed has run before the bind. When the server cannot start (for
// example, the port is in use), print the revealed keys and the keys files
// before the error ends quant serve, so no key is lost.
async function startOrShowKeys(serverOpts, kv, print) {
  try {
    return await startServer(serverOpts);
  } catch (err) {
    showKeys(kv.given ? [] : kv.keys, print);
    throw err;
  }
}

// The watchdog ends the --run process group when a function blocks the server.
function watchRun(server, child) {
  if (child && child.pid && server.setRunPid) server.setRunPid(child.pid);
}

/**
 * Build (optional), open the local KV, start the server and the --run
 * command, print the start-up output, then serve until `stop` resolves
 * (default: SIGINT, SIGTERM or SIGHUP).
 * @param {Object} options From resolveOptions().
 * @param {Object} [deps] stop, print, log, kvStore (replaces the local KV), onListening,
 *   env (QUANT_API_TOKEN and QUANT_BASE_URL for --pull-rules and --kv-remote) and fetchImpl (the portal fetch).
 */
export async function runServe(options, { stop, print = console.log, log, kvStore, onListening, env, fetchImpl } = {}) {
  if (options.build) runBuild(options.build, options.root);
  // One request budget for every portal read of the start-up.
  const budget = requestBudget();
  const pulled = await pulledProject(options, { env, fetchImpl, budget });
  const kv = await kvFor(options, { kvStore, log, print, portal: { env, fetchImpl, budget } });
  const server = await startOrShowKeys(serverOptions(withPull(options, pulled), { kvStore: kv.kvStore, backend: kv.backend, log }, print), kv, print);
  const pullWarnings = pulled ? pulled.warnings : [];
  const summary = { ...server.summary, warnings: [...(options.configWarnings || []), ...pullWarnings, ...server.summary.warnings] };
  const lines = startupLines({ url: server.url, host: options.host, clock: options.clock, pull: pullSummary(pulled, server), ...startupSummary(summary, kv) });
  for (const line of lines) print(line);
  const child = options.run ? startRun(options.run, options.root, print, options.proxy) : null;
  watchRun(server, child);
  const onExit = () => killRun(child);
  process.once('exit', onExit);
  if (onListening) onListening(server);
  try {
    await (stop || waitForSignal());
  } finally {
    process.off('exit', onExit);
    await stopRun(child);
    await server.close();
  }
}

function readJson(url) {
  try {
    return JSON.parse(fs.readFileSync(url, 'utf8'));
  } catch (_err) {
    return null;
  }
}

// Resolve like an import does, so a hoisted package is found too. The entry
// point is resolved (not package.json), because some packages do not export it.
function installedPackage(name) {
  let dir;
  try {
    dir = path.dirname(createRequire(import.meta.url).resolve(name));
  } catch (_err) {
    return null;
  }
  for (; dir !== path.dirname(dir); dir = path.dirname(dir)) {
    const pkg = readJson(path.join(dir, 'package.json'));
    if (pkg && pkg.name === name) return pkg;
  }
  return null;
}

function packageLine(name, pinned) {
  const pkg = installedPackage(name);
  if (!pkg || !pkg.version) return `${name} not installed${pinned ? ` (tested with ${pinned.split('#').pop()})` : ''}`;
  const commit = pinned && pinned.includes('#') ? ` (${pinned.split('#')[1]})` : '';
  return `${name} ${pkg.version}${commit}`;
}

/** The versions of quant-cli, node and the packages that quant serve uses. */
export function versionInfo() {
  const root = readJson(new URL('../../package.json', import.meta.url)) || {};
  const specs = { ...root.dependencies, ...root.devDependencies };
  return [
    `quant-cli ${root.version}`,
    `node ${process.version}`,
    ...['@quantcdn/edge-kv', '@quantcdn/edge-conformance', '@quantcdn/kv-ledger-conformance']
      .map((name) => packageLine(name, specs[name]))
  ].join('\n');
}

export default {
  command: 'serve [dir]',
  describe: 'Run the site locally: static files, edge functions and rules',
  builder: (yargs) => yargs
    .positional('dir', { type: 'string', describe: 'The built site', default: DEFAULTS.dir })
    .option('port', { type: 'number', default: DEFAULTS.port, describe: 'Port' })
    .option('host', { type: 'string', default: DEFAULTS.host, describe: 'Address to listen on' })
    .option('functions', { type: 'string', default: DEFAULT_FILES.functions, describe: 'Functions manifest' })
    .option('rules', { type: 'string', default: DEFAULT_FILES.rules, describe: 'Rules manifest' })
    .option('meta', { type: 'string', describe: `Template metadata with KV stores (default: quant/serve.json meta, then ${DEFAULT_FILES.meta})` })
    .option('fixtures', { type: 'string', default: DEFAULT_FILES.fixtures, describe: 'KV fixtures directory' })
    .option('org', { type: 'string', describe: 'Organisation (default: quant/serve.json org, quant.json clientid, then local)' })
    .option('domain', { type: 'string', describe: 'Host for rule domain matching (default: the request Host)' })
    .option('user-name', { type: 'string', describe: '{user_name} value (default: git config user.name, then Owner)' })
    .option('reset', { type: 'boolean', describe: 'Delete the local KV state and seed again' })
    .option('memory', { type: 'boolean', describe: 'Keep the KV state in memory only' })
    .option('seed-key', { type: 'string', describe: 'Value of the first reveal-once entry (in the first store that has one)' })
    .option('kv-lag', { type: 'number', default: 0, describe: 'Index list visibility delay in ms' })
    .option('indexes', { type: 'string', choices: ['active', 'building'], default: 'active', describe: 'Index state for the session' })
    .option('clock', { type: 'string', choices: CLOCKS, default: 'real', describe: 'Clock mode: manual moves time only with POST /_quant_serve/clock' })
    .option('geo', { type: 'string', describe: 'Geolocation fields for functions, as JSON' })
    .option('client-ip', { type: 'string', describe: 'Client address for functions' })
    .option('build', { type: 'string', describe: 'Command to run once before start' })
    .option('watch', { type: 'boolean', describe: 'Reload on changes; run --build again on changes under src/ and public/' })
    .option('run', { type: 'string', describe: 'Long-running command (a dev server) to start beside the server' })
    .option('proxy', { type: 'string', describe: 'Dev server URL for requests that no rule ends' })
    .option('pull-rules', { type: 'boolean', describe: 'Read the portal rules and global headers once at start and run them with the local rules (needs QUANT_API_TOKEN and QUANT_BASE_URL)' })
    .option('kv-remote', { type: 'string', describe: 'Serve one portal KV store from a snapshot read at start; writes stay local (needs QUANT_API_TOKEN and QUANT_BASE_URL)' })
    .option('version-info', { type: 'boolean', describe: 'Print the versions and exit' }),
  promptArgs: async () => {
    const dir = await text({ message: 'Directory of the built site', placeholder: DEFAULTS.dir, defaultValue: DEFAULTS.dir });
    return isCancel(dir) ? null : { dir };
  },
  async handler(args) {
    if (args['version-info']) return versionInfo();
    await runServe(resolveOptions(args));
    return null;
  }
};
