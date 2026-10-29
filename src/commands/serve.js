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

const DEFAULTS = Object.freeze({ dir: 'dist', port: 8787, host: '127.0.0.1', org: 'local', project: 'dev', userName: 'Owner' });
const LATER_RELEASE = ['pull-rules', 'kv-remote'];
const CLOCKS = ['real', 'manual'];
// An offset of the KV time from the real time below this is not reported.
const OFFSET_TOLERANCE_MS = 1000;
const LOOPBACK_HOSTS = ['127.0.0.1', '::1', 'localhost'];
const POSIX = process.platform !== 'win32';
/** The signals that stop quant serve. SIGHUP comes when the terminal closes. */
export const STOP_SIGNALS = Object.freeze(['SIGINT', 'SIGTERM', 'SIGHUP']);
export const RUN_GRACE_MS = 2000;

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

function refuseLaterFlags(args) {
  for (const flag of LATER_RELEASE) {
    if (args[flag] !== undefined && args[flag] !== false) throw new Error(`--${flag} is available in a later release`);
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

function siteOptions(args) {
  return {
    dir: first([args.dir], DEFAULTS.dir),
    port: portOf(args.port),
    host: first([args.host], DEFAULTS.host),
    functions: first([args.functions], DEFAULT_FILES.functions),
    rules: first([args.rules], DEFAULT_FILES.rules),
    meta: first([args.meta], DEFAULT_FILES.meta),
    fixtures: first([args.fixtures], DEFAULT_FILES.fixtures)
  };
}

function identityOptions(args, root, gitUserName) {
  const saved = readQuantJson(root);
  return {
    org: first([args.org, args.clientid, saved.clientid], DEFAULTS.org),
    project: first([args.project, saved.project], DEFAULTS.project),
    domain: first([args.domain], undefined),
    userName: first([args['user-name'], gitUserName(root)], DEFAULTS.userName)
  };
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
  refuseLaterFlags(args);
  return {
    root,
    ...siteOptions(args),
    ...identityOptions(args, root, gitUserName),
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

function clockLines(clock) {
  return clock === 'manual' ? ['Clock: manual. Time moves only with POST /_quant_serve/clock.'] : [];
}

/**
 * The start-up output: the URL, the stores, the ledgers, the clock, the
 * rules, the edge libraries from the project, the warnings, then the
 * revealed keys in a box.
 */
export function startupLines({ url, host, summary, keys = [], ledgers = [], clock = 'real' }) {
  const libraries = summary.libraries.length > 0 ? summary.libraries.join(', ') : 'none';
  return [
    `quant serve is running at ${url}`,
    ...section('KV stores:', summary.stores.map((store) => `${store.name} → ${store.location || store.id}`)),
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
function startRun(command, root, print) {
  const child = spawn(command, {
    shell: true,
    cwd: root,
    detached: POSIX,
    stdio: POSIX ? ['ignore', 'inherit', 'inherit'] : 'inherit'
  });
  child.on('error', (err) => print(`The --run command could not start: ${err.message}`));
  child.on('exit', (code, signal) => {
    if (!child.stopping) print(`The --run command stopped (${signal || `exit code ${code}`}).`);
  });
  return child;
}

function groupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (_err) {
    return false;
  }
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

/**
 * Stop the --run command: SIGTERM to its process group, then SIGKILL when
 * the group is still alive after the grace period.
 */
export async function stopRun(child, { graceMs = RUN_GRACE_MS } = {}) {
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

// --clock real: a clock offset that an earlier --clock manual session stored
// in the state is cleared (the KV time is set to the real time).
async function clearClockOffset(backend, mode, print) {
  if (mode !== 'real' || Math.abs(backend.now() - Date.now()) < OFFSET_TOLERANCE_MS) return;
  await backend.setClock(Date.now());
  print('The local clock offset was cleared (--clock real).');
}

// The local KV of the project (unless the caller gives a kvStore): open the
// state, declare the meta.json stores and indexes and the local ledgers,
// then seed new stores.
async function localKv(options, log, print) {
  const files = { root: options.root, functions: options.functions, rules: options.rules, meta: options.meta, fixtures: options.fixtures };
  const { stores, fixtures } = loadProject(files);
  const ledgers = readLedgerFile({ root: options.root, stores, meta: options.meta });
  const kv = await openLocalKv({
    root: options.root, org: options.org, project: options.project, stores, ledgers,
    memory: options.memory, reset: options.reset, lagMs: options.kvLag, indexState: options.indexes,
    warn: log, ledgerWait: options.clock !== 'manual', ...backendClock(options.clock)
  });
  await clearClockOffset(kv.backend, options.clock, print);
  const withFile = (list) => list.map((key) => ({ ...key, file: kv.paths ? kv.paths.revealKeys(key.storeId) : null }));
  let seeded;
  try {
    seeded = await kv.seed({ fixtures, userName: options.userName, seedKey: options.seedKey });
  } catch (err) {
    showKeys(withFile(err.revealed || []), print);
    throw err;
  }
  const keys = withFile(seeded.revealed);
  return {
    kvStore: kv.kvStore, backend: kv.backend, ledgers, keys, warnings: kv.warnings,
    location: kv.paths ? kv.paths.file : 'memory'
  };
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
async function kvFor(options, kvStore, log, print) {
  return kvStore ? { kvStore, given: true } : localKv(options, log || stderrLine, print);
}

// The start-up summary and keys, with the KV state location, warnings, ledgers and revealed keys.
function startupSummary(summary, kv) {
  if (kv.given) return { summary, keys: [] };
  return {
    ledgers: kv.ledgers,
    summary: {
      ...summary,
      stores: summary.stores.map((store) => ({ ...store, location: `${store.id} in ${kv.location}` })),
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
 * @param {Object} [deps] stop, print, log, kvStore (replaces the local KV), onListening.
 */
export async function runServe(options, { stop, print = console.log, log, kvStore, onListening } = {}) {
  if (options.build) runBuild(options.build, options.root);
  const kv = await kvFor(options, kvStore, log, print);
  const server = await startOrShowKeys(serverOptions(options, { kvStore: kv.kvStore, backend: kv.backend, log }, print), kv, print);
  const lines = startupLines({ url: server.url, host: options.host, clock: options.clock, ...startupSummary(server.summary, kv) });
  for (const line of lines) print(line);
  const child = options.run ? startRun(options.run, options.root, print) : null;
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
    .option('meta', { type: 'string', default: DEFAULT_FILES.meta, describe: 'Template metadata with KV stores' })
    .option('fixtures', { type: 'string', default: DEFAULT_FILES.fixtures, describe: 'KV fixtures directory' })
    .option('org', { type: 'string', describe: 'Organisation (default: quant.json clientid, then local)' })
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
    .option('pull-rules', { type: 'boolean', describe: 'Read portal-managed rules (a later release)' })
    .option('kv-remote', { type: 'string', describe: 'Read-only remote KV store (a later release)' })
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
