/**
 * The `quant serve` HTTP server.
 * One function for each pipeline stage: context, rules, proxy, static, 404,
 * filter and headers. The KV store comes from the caller (options.kvStore).
 */

import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import tls from 'node:tls';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { storeId } from '../helper/quant-meta.js';
import { controlRoutes, isControlPath } from './control.js';
import { loadProjectLibraries } from './edge-libraries.js';
import { createExecutor, authContinueHeaders, readCappedBody, DEFAULT_TIMEOUT_MS } from './functions.js';
import { loadProject, watchProject } from './project.js';
import { matchRules, matchFilter } from './rules.js';
import { startWatchdog } from './watchdog.js';
import { buildIndex, containsProject, findOnDisk, lookup, serveStatic, notFound, NOT_SERVED } from './static.js';

const SERVER_HEADER = 'QuantCDN (quant serve)';
const AUTH_UNAVAILABLE = 'Authentication for this page is not available.';
const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'expect'];
const PROXY_REQUEST_DROP = [...HOP_BY_HOP, 'host', 'content-length'];
// Node fetch decodes the body, so the encoding and length headers are dropped.
const PROXY_RESPONSE_DROP = [...HOP_BY_HOP, 'content-encoding', 'content-length'];
const VERSION = readVersion();

function readVersion() {
  try {
    return JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
  } catch (_err) {
    return 'unknown';
  }
}

function errorMessage(err) {
  return err && typeof err.message === 'string' ? err.message : String(err);
}

function defaultLog(line) {
  process.stderr.write(`${line}\n`);
}

function text(status, body, extra = {}) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', ...extra } });
}

// node:vm cannot contain a promise that a function leaves rejected, or a
// throw from a callback that it schedules. One process-level handler logs
// these errors so that the server keeps serving. An error that does not come
// from function code is a fault of quant serve: it crashes with its stack.
const processServers = new Set();

function uninstallProcessHandlers() {
  process.off('unhandledRejection', onProcessError);
  process.off('uncaughtException', onProcessError);
}

function onProcessError(err) {
  const owners = [...processServers].filter((server) => server.fromFunction(err));
  if (owners.length === 0) {
    uninstallProcessHandlers();
    processServers.clear();
    process.nextTick(() => { throw err; });
    return;
  }
  for (const server of owners) server.log(`Unhandled error: ${errorMessage(err)}`);
}

function installProcessHandlers(server) {
  if (processServers.size === 0) {
    process.on('unhandledRejection', onProcessError);
    process.on('uncaughtException', onProcessError);
  }
  processServers.add(server);
  return () => {
    if (!processServers.delete(server) || processServers.size > 0) return;
    uninstallProcessHandlers();
  };
}

// --- Identity --------------------------------------------------------------------

const HEADER_TEXT = /^[\x20-\x7e]+$/;

// The org and project go in the x-quant-org and x-quant-project headers.
function checkIdentity(org, project) {
  for (const [name, value] of [['org', org], ['project', project]]) {
    if (!HEADER_TEXT.test(value)) {
      throw new Error(`The ${name} ${JSON.stringify(value)} cannot go in a response header. Use printable ASCII characters only.`);
    }
  }
}

// --- Host check ----------------------------------------------------------------

// On a loopback bind, quant serve answers the local names and the --domain
// value only. A page that a DNS name points at 127.0.0.1 cannot read the
// local site. A bind that is not loopback answers any Host.
const LOOPBACK_BINDS = new Set(['127.0.0.1', '::1', 'localhost']);
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];
const MISDIRECTED = 'quant serve answers the Host names localhost, 127.0.0.1 and [::1], and the --domain value, only.';

/** The Host header value without the port, in lowercase. */
export function hostName(value) {
  const host = String(value || '').trim().toLowerCase();
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1);
  return host.replace(/:\d*$/, '');
}

function allowedHosts(options) {
  if (!LOOPBACK_BINDS.has(options.host || '127.0.0.1')) return null;
  return new Set([...LOCAL_HOSTS, ...(options.domain ? [hostName(options.domain)] : [])]);
}

function hostAllowed(state, req) {
  return !state.allowedHosts || state.allowedHosts.has(hostName(req.headers.host));
}

// --- Context -----------------------------------------------------------------

// The body for a function: read once, up to the request body cap. A body
// over the cap reaches the function as an empty body (null). After the proxy
// has streamed the body, there is no body left to read.
function functionRequestBody(ctx) {
  if (!ctx.bodyPending) ctx.bodyPending = ctx.bodyStreamed ? Promise.resolve(null) : readCappedBody(ctx.req);
  return ctx.bodyPending;
}

const ENCODED_SEPARATOR = /%(2f|5c)/i;
const PERCENT_ENCODED = /%([0-9a-f]{2})/gi;
const UNRESERVED = /^[A-Za-z0-9\-._~]$/;
const BAD_PATH = 'The request path has an encoded "/" or "\\".';

function decodeUnreserved(match, hex) {
  const char = String.fromCharCode(parseInt(hex, 16));
  return UNRESERVED.test(char) ? char : match;
}

/**
 * The one request path that rule matching, filter matching and the static
 * lookup use: percent-encoded unreserved characters are decoded and repeated
 * "/" become one. Null for an encoded "/" or "\" (the request gets 400).
 * Functions and the proxy get the path as the client sent it.
 */
export function canonicalPath(pathname) {
  if (ENCODED_SEPARATOR.test(pathname)) return null;
  return pathname.replace(PERCENT_ENCODED, decodeUnreserved).replace(/\/{2,}/g, '/');
}

// The query string stays as it was sent, for query-pattern rules.
function requestPath(rawUrl) {
  const url = rawUrl.startsWith('/') ? new URL(`http://localhost${rawUrl}`) : new URL(rawUrl);
  return { pathname: canonicalPath(url.pathname), sentPath: url.pathname, search: url.search };
}

function requestContext(state, req) {
  const host = state.options.domain || req.headers.host || '';
  const { pathname, sentPath, search } = requestPath(req.url);
  return {
    badPath: pathname === null,
    req,
    host,
    method: req.method,
    pathname,
    sentPath,
    search,
    publicUrl: `http://${host || 'localhost'}${sentPath}${search}`,
    remoteAddress: req.socket.remoteAddress,
    bodyPending: null,
    bodyStreamed: false,
    authHeaders: null
  };
}

function matchContext(ctx) {
  return { host: ctx.host || '', method: ctx.method, pathname: ctx.pathname, search: ctx.search };
}

function clientAddress(state, ctx) {
  const address = state.options.clientIp ?? ctx.remoteAddress ?? '';
  return String(address).replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i, '$1');
}

// The request headers a function sees: quant-client-ip is the client
// address, never the value that the client sent.
function functionHeaders(req, address) {
  const headers = Object.entries(req.headers)
    .filter(([key]) => key !== 'quant-client-ip')
    .map(([key, value]) => [key, Array.isArray(value) ? value.join(', ') : value]);
  headers.push(['quant-client-ip', address]);
  return headers;
}

async function functionContext(state, ctx, mode) {
  const address = clientAddress(state, ctx);
  return {
    mode,
    url: ctx.publicUrl,
    method: ctx.method,
    headers: functionHeaders(ctx.req, address),
    body: await functionRequestBody(ctx),
    clientAddress: address
  };
}

// --- Rules -------------------------------------------------------------------

// The headers of each auth 201 in a chain: a later auth function replaces
// a header that an earlier one set, and set-cookie values add up.
function mergeHeaders(target, source) {
  const headers = new Headers(target || []);
  for (const [key, value] of source) {
    if (key === 'set-cookie') headers.append(key, value);
    else headers.set(key, value);
  }
  return headers;
}

async function authStage(state, ctx, fn) {
  if (!fn) return text(503, AUTH_UNAVAILABLE, { 'cache-control': 'no-store' });
  const response = await state.executor.run(fn, await functionContext(state, ctx, 'auth'));
  if (response.status !== 201) return response;
  ctx.authHeaders = mergeHeaders(ctx.authHeaders, authContinueHeaders(response));
  return null;
}

async function functionStage(state, ctx, rule, fn) {
  if (!fn) {
    state.log(`Rule ${rule.id}: function ${rule.fnUuid} is not in the functions manifest.`);
    return new Response(null, { status: 500 });
  }
  return state.executor.run(fn, await functionContext(state, ctx, 'function'));
}

// The matching rules run in order. An auth 201 continues to the next rule;
// any other auth response, and every function rule, ends the request.
async function ruleStage(state, ctx) {
  for (const rule of matchRules(state.project.rules, matchContext(ctx))) {
    const fn = state.project.functions.get(rule.fnUuid);
    const response = rule.type === 'auth' ? await authStage(state, ctx, fn) : await functionStage(state, ctx, rule, fn);
    if (response) return response;
  }
  return null;
}

// --- Proxy -------------------------------------------------------------------

function withoutHeaders(source, names) {
  const headers = new Headers(source);
  for (const name of names) headers.delete(name);
  return headers;
}

function proxyRequestHeaders(req) {
  const headers = new Headers();
  for (let i = 0; i < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
  return withoutHeaders(headers, PROXY_REQUEST_DROP);
}

function proxyTarget(base, ctx) {
  const target = new URL(base);
  target.pathname = ctx.sentPath;
  target.search = ctx.search;
  return target;
}

// The proxy streams the request body to the dev server, unless a function
// (an auth rule that continued) has read it already. Then the proxy sends the
// capped body that the function saw.
async function proxyBody(ctx) {
  if (['GET', 'HEAD'].includes(ctx.method)) return {};
  if (ctx.bodyPending) {
    const bytes = await ctx.bodyPending;
    return bytes ? { body: bytes } : {};
  }
  ctx.bodyStreamed = true;
  return { body: ctx.req, duplex: 'half' };
}

async function proxyStage(state, ctx) {
  const base = state.options.proxy;
  if (!base) return null;
  try {
    const upstream = await fetch(proxyTarget(base, ctx), {
      method: ctx.method,
      headers: proxyRequestHeaders(ctx.req),
      ...(await proxyBody(ctx)),
      redirect: 'manual'
    });
    const headers = withoutHeaders(upstream.headers, PROXY_RESPONSE_DROP);
    return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers });
  } catch (_err) {
    return text(502, `The dev server at ${base} did not answer.`);
  }
}

// --- Static, 404 and filter ----------------------------------------------------

// With --watch, a build can delete and make the site directory again, and
// the watch of the folder can stop. A file in the index must still exist,
// and a miss is looked up on disk with the same exclusions as the index.
function staticFile(state, ctx) {
  const file = lookup(state.index, ctx.pathname, ctx.search);
  if (!state.options.watch) return file;
  if (file && fs.existsSync(file.path)) return file;
  return findOnDisk(state.dir, state.root, ctx.pathname);
}

function staticStage(state, ctx) {
  const file = staticFile(state, ctx);
  return file ? serveStatic(file, ctx.method, ctx.req.headers.range) : null;
}

function notFoundStage(state) {
  const { response, warning } = notFound(state.dir, state.index);
  if (warning && !state.notFoundWarned) {
    state.notFoundWarned = true;
    state.log(warning);
  }
  return response;
}

function isHtml(response) {
  return (response.headers.get('content-type') || '').toLowerCase().startsWith('text/html');
}

// A filter rule applies to text/html responses only. A filter rule whose
// function is missing is skipped (start-up prints the warning).
async function filterStage(state, ctx, response) {
  if (!isHtml(response)) return response;
  const rule = matchFilter(state.project.rules, matchContext(ctx));
  const fn = rule && state.project.functions.get(rule.fnUuid);
  if (!fn) return response;
  return state.executor.run(fn, { ...(await functionContext(state, ctx, 'filter')), response });
}

async function respond(state, ctx) {
  if (!hostAllowed(state, ctx.req)) return text(421, MISDIRECTED, { 'cache-control': 'no-store' });
  if (ctx.badPath) return text(400, BAD_PATH, { 'cache-control': 'no-store' });
  if (isControlPath(ctx.pathname)) {
    return state.control({ method: ctx.method, pathname: ctx.pathname, remoteAddress: ctx.remoteAddress, headers: ctx.req.headers });
  }
  const response = await ruleStage(state, ctx)
    || await proxyStage(state, ctx)
    || staticStage(state, ctx)
    || notFoundStage(state);
  return filterStage(state, ctx, response);
}

// --- Headers and send ------------------------------------------------------------

function finalHeaders(state, source, authHeaders) {
  const headers = new Headers(source);
  for (const [key, value] of authHeaders || []) {
    if (key === 'set-cookie') headers.append(key, value);
    else headers.set(key, value);
  }
  headers.set('quant-server', SERVER_HEADER);
  headers.set('x-quant-org', state.org);
  headers.set('x-quant-project', state.projectName);
  return headers;
}

function writeHead(res, response, headers) {
  res.statusCode = response.status;
  if (response.statusText) res.statusMessage = response.statusText;
  for (const [key, value] of headers) {
    if (key !== 'set-cookie') res.setHeader(key, value);
  }
  const cookies = headers.getSetCookie();
  if (cookies.length > 0) res.setHeader('set-cookie', cookies);
}

async function send(state, res, response, method, authHeaders) {
  writeHead(res, response, finalHeaders(state, response.headers, authHeaders));
  if (!response.body || method === 'HEAD') {
    res.end();
    if (response.body) await response.body.cancel().catch(() => {});
    return;
  }
  try {
    await pipeline(Readable.fromWeb(response.body), res);
  } catch (_err) {
    res.destroy();
  }
}

// A response that cannot be sent (for example a header value that Node
// refuses) gets a bare 500, so the socket does not stay open.
function sendFailed(state, req, res, err) {
  state.log(`quant serve could not send the response to ${req.method} ${req.url}: ${errorMessage(err)}`);
  if (res.headersSent) {
    res.destroy();
    return;
  }
  for (const name of res.getHeaderNames()) res.removeHeader(name);
  res.statusCode = 500;
  res.statusMessage = 'Internal Server Error';
  res.end();
}

async function handleRequest(state, req, res) {
  let ctx = null;
  let response;
  try {
    ctx = requestContext(state, req);
    response = await respond(state, ctx);
  } catch (err) {
    state.log(`quant serve could not answer ${req.method} ${req.url}: ${errorMessage(err)}`);
    response = new Response(null, { status: 500 });
  }
  try {
    await send(state, res, response, req.method, ctx && ctx.authHeaders);
  } catch (err) {
    sendFailed(state, req, res, err);
  }
}

// --- WebSocket upgrades ------------------------------------------------------------

function upgradeHead(req) {
  const lines = [`${req.method} ${req.url} HTTP/1.1`];
  for (let i = 0; i < req.rawHeaders.length; i += 2) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
  return `${lines.join('\r\n')}\r\n\r\n`;
}

function connectUpstream(target, onConnect) {
  const secure = target.protocol === 'https:';
  const host = target.hostname.replace(/^\[|\]$/g, '');
  const port = Number(target.port) || (secure ? 443 : 80);
  return secure ? tls.connect({ host, port, servername: host }, onConnect) : net.connect(port, host, onConnect);
}

function track(state, socket) {
  state.sockets.add(socket);
  socket.on('close', () => state.sockets.delete(socket));
}

function upgradeAllowed(state, req) {
  if (!state.options.proxy || !hostAllowed(state, req)) return false;
  try {
    const { pathname } = requestPath(req.url);
    return pathname !== null && !isControlPath(pathname);
  } catch (_err) {
    return false;
  }
}

// The auth rules of the upgrade path run in order, as for a request. The
// response of an auth that does not answer 201 ends the upgrade. Function
// rules do not run for an upgrade. An upgrade has no body.
async function upgradeAuth(state, req) {
  const ctx = { ...requestContext(state, req), bodyStreamed: true };
  for (const rule of matchRules(state.project.rules, matchContext(ctx))) {
    if (rule.type !== 'auth') continue;
    const response = await authStage(state, ctx, state.project.functions.get(rule.fnUuid));
    if (response) return response;
  }
  return null;
}

async function refuseUpgrade(state, socket, response) {
  const body = Buffer.from(await response.arrayBuffer());
  const headers = finalHeaders(state, response.headers);
  headers.set('connection', 'close');
  headers.set('content-length', String(body.length));
  const lines = [`HTTP/1.1 ${response.status} ${response.statusText || http.STATUS_CODES[response.status] || ''}`];
  for (const [key, value] of headers) lines.push(`${key}: ${value}`);
  socket.end(Buffer.concat([Buffer.from(`${lines.join('\r\n')}\r\n\r\n`), body]));
}

async function upgradeRefusal(state, req) {
  try {
    return await upgradeAuth(state, req);
  } catch (err) {
    state.log(`quant serve could not run the auth rules for the upgrade ${req.url}: ${errorMessage(err)}`);
    return new Response(null, { status: 500 });
  }
}

// WebSocket upgrades go to the dev server (for example, Vite HMR), after
// the auth rules of the path.
async function handleUpgrade(state, req, socket, head) {
  socket.on('error', () => socket.destroy());
  if (!upgradeAllowed(state, req)) {
    socket.destroy();
    return;
  }
  track(state, socket);
  const refusal = await upgradeRefusal(state, req);
  if (refusal) {
    await refuseUpgrade(state, socket, refusal).catch(() => socket.destroy());
    return;
  }
  if (socket.destroyed) return;
  const upstream = connectUpstream(new URL(state.options.proxy), () => {
    upstream.write(upgradeHead(req));
    if (head && head.length > 0) upstream.write(head);
    socket.pipe(upstream).pipe(socket);
  });
  track(state, upstream);
  upstream.on('error', () => socket.destroy());
  socket.on('close', () => upstream.destroy());
}

// --- Start-up -------------------------------------------------------------------

function projectFiles(state) {
  const { functions, rules, meta, fixtures } = state.options;
  return { root: state.root, functions, rules, meta, fixtures };
}

function siteIndex(state) {
  if (fs.existsSync(state.dir)) {
    const warning = containsProject(state.dir, state.root)
      ? `The site directory ${state.dir} contains the project files. quant serve does not serve ${NOT_SERVED}.`
      : null;
    return { index: buildIndex(state.dir, state.root), warning };
  }
  return { index: new Map(), warning: `The site directory ${state.dir} was not found.` };
}

function reloadProject(state) {
  try {
    state.project = loadProject(projectFiles(state));
    for (const warning of state.project.warnings) state.log(warning);
  } catch (err) {
    state.log(`${errorMessage(err)}\nquant serve keeps the last valid version of the project files.`);
  }
}

function changedUnder(paths, prefix) {
  if (prefix === '.') return paths.length > 0;
  return paths.some((item) => item === prefix || item.startsWith(`${prefix}${path.sep}`));
}

// A --build run (onSourceChange) can make the site directory again, so the
// static index is built again after it.
function onWatchChange(state, paths, siteRel) {
  if (changedUnder(paths, 'quant')) reloadProject(state);
  const sourceChanged = changedUnder(paths, 'src') || changedUnder(paths, 'public');
  const build = sourceChanged && state.options.onSourceChange;
  if (build) state.options.onSourceChange(paths);
  if (build || changedUnder(paths, siteRel)) state.index = siteIndex(state).index;
}

function startWatch(state) {
  if (!state.options.watch) return () => {};
  const siteRel = path.relative(state.root, state.dir) || '.';
  return watchProject(state.root, (paths) => onWatchChange(state, paths, siteRel), {
    paths: ['quant', siteRel, 'src', 'public']
  });
}

function storeList(state) {
  return state.project.stores.map((store) => ({ name: store.name, id: storeId(state.org, state.projectName, store.name) }));
}

function createState(options) {
  const root = path.resolve(options.root || process.cwd());
  const state = {
    options,
    root,
    dir: path.resolve(root, options.dir || 'dist'),
    org: options.org || 'local',
    projectName: options.project || 'dev',
    log: options.log || defaultLog,
    sockets: new Set(),
    notFoundWarned: false,
    allowedHosts: allowedHosts(options)
  };
  checkIdentity(state.org, state.projectName);
  state.project = loadProject(projectFiles(state));
  state.executor = createExecutor({
    kvStore: options.kvStore, org: state.org, project: state.projectName, root,
    timeoutMs: options.timeoutMs, geo: options.geo, clientIp: options.clientIp, log: state.log,
    watch: { enter: (uuid) => state.watchdog && state.watchdog.enter(uuid), leave: (token) => state.watchdog && state.watchdog.leave(token) }
  });
  state.control = controlRoutes({
    info: () => ({ version: VERSION, org: state.org, project: state.projectName, stores: storeList(state).map((s) => s.id) })
  });
  return state;
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (err) => reject(err.code === 'EADDRINUSE' ? new Error(`Port ${port} is in use. Use --port.`) : err);
    server.once('error', onError);
    server.listen(port, host, () => {
      server.off('error', onError);
      resolve(server.address());
    });
  });
}

function serverUrl(host, port) {
  const shown = ['0.0.0.0', '::'].includes(host) ? '127.0.0.1' : host;
  return `http://${net.isIPv6(shown) ? `[${shown}]` : shown}:${port}`;
}

function closer(state, server, cleanups) {
  let closing = null;
  return () => {
    if (!closing) {
      for (const cleanup of cleanups) cleanup();
      for (const socket of state.sockets) socket.destroy();
      server.closeAllConnections();
      closing = new Promise((resolve) => server.close(() => resolve()));
    }
    return closing;
  };
}

/**
 * Start the server.
 * @param {Object} options The parsed flags plus root and kvStore:
 *   root, dir, port, host, functions, rules, meta, fixtures, org, project,
 *   domain, proxy, watch, geo, clientIp, timeoutMs, kvStore, log, onSourceChange.
 * @returns {Promise<{ url: string, close: () => Promise<void>, setRunPid: (pid: number) => void, summary: Object }>}
 *   setRunPid: the --run process group that the watchdog ends when a function blocks the server.
 *   summary: { stores, rules, libraries, warnings } for the start-up output.
 */
export async function startServer(options) {
  const state = createState(options);
  const site = siteIndex(state);
  state.index = site.index;
  const { fromProject, errors: libraryErrors } = await loadProjectLibraries(state.root);
  const server = http.createServer((req, res) => handleRequest(state, req, res));
  server.on('upgrade', (req, socket, head) => handleUpgrade(state, req, socket, head));
  const host = options.host || '127.0.0.1';
  const address = await listen(server, options.port ?? 8787, host);
  state.watchdog = startWatchdog({ budgetMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS });
  const processServer = { log: state.log, fromFunction: (err) => state.executor.fromFunction(err) };
  const cleanups = [installProcessHandlers(processServer), startWatch(state), () => state.watchdog.stop()];
  return {
    url: serverUrl(host, address.port),
    close: closer(state, server, cleanups),
    setRunPid: (pid) => state.watchdog.setRunPid(pid),
    summary: {
      stores: storeList(state),
      rules: state.project.rules.map((rule) => ({ id: rule.id, type: rule.type, urls: rule.url })),
      libraries: fromProject,
      warnings: [site.warning, ...libraryErrors, ...state.project.warnings].filter(Boolean)
    }
  };
}
