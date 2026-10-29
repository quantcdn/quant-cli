/**
 * Edge function executor for `quant serve`.
 * Each run gets a new node:vm context with the documented edge globals.
 * node:vm is not a security boundary: it runs the developer's own code.
 * The contract (event shape, modes, limits and error responses) follows the
 * documented behaviour of the Quant edge.
 */

import vm from 'node:vm';
import fs from 'node:fs';
import net from 'node:net';
import dns from 'node:dns';
import { format } from 'node:util';
import { loadProjectLibraries } from './edge-libraries.js';

export const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;
export const DEFAULT_TIMEOUT_MS = 15000;

const AUTH_MESSAGE = 'Invalid edge_auth function response: expected Response object';
const FILTER_MESSAGE = 'Edge filter must define a contentFilter class';
const SYNC_TIMEOUT_MESSAGE = 'Script execution timed out';
const TIME_BUDGET_MESSAGE = 'Edge function exceeded its time budget';
const FETCH_WARNING = 'This fetch goes to a private address; the Quant edge refuses it.';
const DEFAULT_CACHE_CONTROL = 'private, max-age=0';

// Response headers that a function cannot override.
const PROTECTED_HEADERS = ['quant-server', 'age', 'quant-project', 'quant-url-hash'];
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

// The stub location is Sydney, Australia. The field names are the geolocation
// record fields that the edge gives functions.
const STUB_GEO = Object.freeze({
  as_name: '',
  as_number: 0,
  area_code: 0,
  city: 'Sydney',
  conn_speed: 'broadband',
  conn_type: 'wired',
  continent: 'OC',
  country_code: 'AU',
  country_code3: 'AUS',
  country_name: 'Australia',
  gmt_offset: '+1000',
  latitude: -33.87,
  longitude: 151.21,
  metro_code: 0,
  postal_code: '2000',
  proxy_description: '',
  proxy_type: '',
  region: 'NSW',
  utc_offset: 1000
});

const WEB_GLOBALS = [
  'Request', 'Response', 'Headers', 'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder',
  'atob', 'btoa', 'structuredClone', 'crypto', 'console', 'setTimeout', 'clearTimeout',
  'setInterval', 'clearInterval', 'queueMicrotask', 'performance', 'AbortController', 'AbortSignal',
  'ReadableStream', 'WritableStream', 'TransformStream', 'TextEncoderStream', 'TextDecoderStream',
  'CompressionStream', 'DecompressionStream', 'ByteLengthQueuingStrategy', 'CountQueuingStrategy',
  'Blob', 'File', 'FormData', 'Event', 'EventTarget', 'DOMException', 'Buffer'
];

// The binary and error classes of the host realm. A library from the project
// (for example jose) checks a value with `instanceof` against its own realm,
// so a function must make its values with the same classes.
const REALM_GLOBALS = [
  'ArrayBuffer', 'DataView', 'Uint8Array', 'Uint8ClampedArray', 'Int8Array', 'Uint16Array', 'Int16Array',
  'Uint32Array', 'Int32Array', 'Float32Array', 'Float64Array', 'BigInt64Array', 'BigUint64Array',
  'Error', 'TypeError', 'RangeError', 'SyntaxError'
];

const META_TYPES = { function: 'edge_function', auth: 'edge_auth' };

const PRIVATE_ADDRESSES = new net.BlockList();
PRIVATE_ADDRESSES.addSubnet('10.0.0.0', 8, 'ipv4');
PRIVATE_ADDRESSES.addSubnet('172.16.0.0', 12, 'ipv4');
PRIVATE_ADDRESSES.addSubnet('192.168.0.0', 16, 'ipv4');
PRIVATE_ADDRESSES.addSubnet('127.0.0.0', 8, 'ipv4');
PRIVATE_ADDRESSES.addSubnet('169.254.0.0', 16, 'ipv4');
PRIVATE_ADDRESSES.addAddress('::1', 'ipv6');
PRIVATE_ADDRESSES.addSubnet('fe80::', 10, 'ipv6');
PRIVATE_ADDRESSES.addSubnet('fc00::', 7, 'ipv6');

let fetchWarningPrinted = false;

/** Let the private-address fetch warning print again (for tests). */
export function resetFetchWarning() {
  fetchWarningPrinted = false;
}

/**
 * Read a request body stream up to MAX_REQUEST_BODY_BYTES.
 * The stream is always read to the end so that the client can get a response.
 * @returns {Promise<Uint8Array|null>} null for an empty or over-cap body.
 */
export async function readCappedBody(stream) {
  const chunks = [];
  let total = 0;
  for await (const chunk of stream) {
    total += chunk.length;
    if (total <= MAX_REQUEST_BODY_BYTES) chunks.push(Buffer.from(chunk));
  }
  if (total === 0 || total > MAX_REQUEST_BODY_BYTES) return null;
  return new Uint8Array(Buffer.concat(chunks));
}

function toBytes(body) {
  if (body instanceof Uint8Array) return body;
  if (typeof body === 'string') return new TextEncoder().encode(body);
  return null;
}

function capBody(body) {
  const bytes = body == null ? null : toBytes(body);
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_REQUEST_BODY_BYTES) return null;
  return bytes;
}

function requestBody(method, body) {
  return method === 'GET' || method === 'HEAD' ? null : capBody(body);
}

function functionUrl(requestUrl, uuid) {
  const url = new URL(requestUrl);
  url.pathname = `/fn/${uuid}`;
  return url.toString();
}

function clientAddress(options, ctx) {
  const address = options.clientIp ?? ctx.clientAddress;
  return address == null ? null : String(address);
}

function eventMeta(fn, mode) {
  const type = META_TYPES[mode];
  return type ? { uuid: fn.uuid, type } : { uuid: null, type: null };
}

function geoRecord(override, address) {
  return { ...STUB_GEO, ip_address: address, ...override };
}

// The URL of the event. A function rule sees /fn/<uuid>; an inline function
// sees the page URL.
function eventUrl(fn, ctx, mode) {
  return mode === 'function' && !ctx.inline ? functionUrl(ctx.url, fn.uuid) : ctx.url;
}

// The plain event payload: the shape the edge passes before it builds the
// Request and URL objects.
function buildEventPayload(fn, ctx, mode, options) {
  const method = String(ctx.method || 'GET').toUpperCase();
  const address = clientAddress(options, ctx);
  return {
    request: { url: ctx.url, method, headers: [...new Headers(ctx.headers || {})], body: requestBody(method, ctx.body) },
    url: eventUrl(fn, ctx, mode),
    client: { address },
    geo: geoRecord(options.geo, address),
    quantOrg: options.org,
    quantProject: options.project,
    meta: eventMeta(fn, mode)
  };
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch (_err) {
    return undefined;
  }
}

function hydrateEvent(payload) {
  const source = payload.request;
  const init = { method: source.method, headers: new Headers(source.headers) };
  if (source.body) init.body = source.body;
  return { ...payload, request: new Request(source.url, init), url: parseUrl(payload.url) };
}

function uuidv7() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const ms = Date.now();
  for (let i = 0; i < 6; i++) bytes[i] = Math.floor(ms / 2 ** (8 * (5 - i))) % 256;
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isPrivateAddress({ address, family }) {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return PRIVATE_ADDRESSES.check(mapped[1], 'ipv4');
  return PRIVATE_ADDRESSES.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

function fetchHost(input) {
  const raw = input && typeof input === 'object' && 'url' in input ? input.url : String(input);
  const url = parseUrl(raw);
  return url ? url.hostname.replace(/^\[|\]$/g, '') : null;
}

async function resolveAddresses(host) {
  const family = net.isIP(host);
  if (family) return [{ address: host, family }];
  try {
    return await dns.promises.lookup(host, { all: true });
  } catch (_err) {
    return [];
  }
}

async function warnIfPrivate(input, log) {
  const host = fetchHost(input);
  if (!host) return;
  const addresses = await resolveAddresses(host);
  if (!fetchWarningPrinted && addresses.some(isPrivateAddress)) {
    fetchWarningPrinted = true;
    log(FETCH_WARNING);
  }
}

// The real Node fetch. The first fetch to a private address prints a warning,
// because the edge refuses such a fetch. The fetch is not blocked.
function edgeFetch(log) {
  return async function fetch(input, init) {
    if (!fetchWarningPrinted) await warnIfPrivate(input, log);
    return globalThis.fetch(input, init);
  };
}

// A throw in a timer or microtask callback must not reach the process as an
// uncaught exception. The callback error is logged like a function failure.
// A rejected promise that the callback returns is logged too.
function guardCallback(callback, report) {
  if (typeof callback !== 'function') return callback;
  return function guardedCallback(...args) {
    try {
      const result = callback.apply(this, args);
      if (result && typeof result.then === 'function') result.then(undefined, report);
      return result;
    } catch (err) {
      report(err);
      return undefined;
    }
  };
}

// The timers of one run. They are cleared when the run ends (its response
// is ready, or its time budget ends), so no callback runs after it.
function runTimers(report) {
  const handles = new Set();
  const start = (create) => (callback, ...rest) => {
    const handle = create(guardCallback(callback, report), ...rest);
    handles.add(handle);
    return handle;
  };
  const stop = (clear) => (handle) => {
    handles.delete(handle);
    clear(handle);
  };
  return {
    globals: {
      setTimeout: start(setTimeout),
      setInterval: start(setInterval),
      clearTimeout: stop(clearTimeout),
      clearInterval: stop(clearInterval),
      queueMicrotask: (callback) => queueMicrotask(guardCallback(callback, report))
    },
    clearAll() {
      for (const handle of handles) clearTimeout(handle);
      handles.clear();
    }
  };
}

function hostGlobals(state, libraries, timers) {
  const globals = {};
  for (const name of [...WEB_GLOBALS, ...REALM_GLOBALS]) {
    if (name in globalThis) globals[name] = globalThis[name];
  }
  return {
    ...globals,
    ...libraries,
    ...timers.globals,
    fetch: edgeFetch(state.log),
    kvStore: state.kvStore,
    KVStore: state.kvStore,
    uuidv4: () => crypto.randomUUID(),
    uuidv7,
    quantLog: (...args) => state.log(`quantLog: ${format(...args)}`),
    getGeolocationForIpAddress: (ip) => ({ ...STUB_GEO, ...state.geo, ip_address: String(ip) }),
    isFifoExecution: false
  };
}

function createFunctionContext(state, libraries, event, timers) {
  const context = vm.createContext({ ...hostGlobals(state, libraries, timers), event });
  vm.runInContext('delete globalThis.SharedArrayBuffer; delete globalThis.Atomics; globalThis.window = globalThis;', context);
  return context;
}

// The body runs as an async function in strict mode, so it can use
// top-level await and return. A filter body returns its contentFilter class.
function wrapBody(source, mode) {
  const tail = mode === 'filter' ? 'return typeof contentFilter !== \'undefined\' ? contentFilter : null;' : '';
  return `(async function () {\n'use strict';\n${source}\n${tail}\n})()`;
}

function compile(cache, fn, mode) {
  const stat = fs.statSync(fn.path);
  let entry = cache.get(fn.path);
  if (!entry || entry.mtimeMs !== stat.mtimeMs || entry.size !== stat.size) {
    entry = { mtimeMs: stat.mtimeMs, size: stat.size, source: fs.readFileSync(fn.path, 'utf8'), scripts: {} };
    cache.set(fn.path, entry);
  }
  if (!entry.scripts[mode]) {
    entry.scripts[mode] = new vm.Script(wrapBody(entry.source, mode), { filename: fn.path, lineOffset: -2 });
  }
  return entry.scripts[mode];
}

function runScript(script, context, timeoutMs) {
  try {
    return script.runInContext(context, { timeout: timeoutMs });
  } catch (err) {
    if (err && err.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT') throw new Error(SYNC_TIMEOUT_MESSAGE);
    throw err;
  }
}

function withTimeBudget(promise, timeoutMs) {
  let timer;
  const budget = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(TIME_BUDGET_MESSAGE)), timeoutMs);
  });
  return Promise.race([promise, budget]).finally(() => clearTimeout(timer));
}

function mergeFunctionHeaders(target, source) {
  let cookiesReplaced = false;
  for (const [key, value] of source) {
    if (PROTECTED_HEADERS.includes(key)) continue;
    if (key !== 'set-cookie') {
      target.set(key, value);
      continue;
    }
    if (!cookiesReplaced) target.delete('set-cookie');
    cookiesReplaced = true;
    target.append(key, value);
  }
  return target;
}

async function bufferedBody(response) {
  return NULL_BODY_STATUSES.has(response.status) ? null : await response.arrayBuffer();
}

async function functionResponse(result, baseHeaders) {
  const headers = new Headers(baseHeaders || {});
  if (!headers.has('cache-control')) headers.set('cache-control', DEFAULT_CACHE_CONTROL);
  if (!(result instanceof Response)) {
    return new Response(result == null ? null : result, { status: 200, headers });
  }
  mergeFunctionHeaders(headers, result.headers);
  const body = await bufferedBody(result);
  return new Response(body, { status: result.status, statusText: result.statusText, headers });
}

async function authResponse(result) {
  if (!(result instanceof Response)) throw new Error(AUTH_MESSAGE);
  const body = await bufferedBody(result);
  return new Response(body, { status: result.status, statusText: result.statusText, headers: result.headers });
}

async function filterResponse(FilterClass, event, response) {
  if (typeof FilterClass !== 'function') throw new Error(FILTER_MESSAGE);
  const headers = new Headers(response.headers);
  const filter = new FilterClass(event, headers);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const input = new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    }
  });
  const output = await new Response(input.pipeThrough(filter)).arrayBuffer();
  headers.delete('content-length');
  return new Response(output, { status: response.status, statusText: response.statusText, headers });
}

const MODES = {
  function: async (pending, _event, ctx) => functionResponse(await pending, ctx.baseHeaders),
  auth: async (pending) => authResponse(await pending),
  filter: async (pending, event, ctx) => filterResponse(await pending, event, ctx.response)
};

/**
 * The headers an auth function's 201 adds to the rest of the request:
 * all of its headers except content-type, with set-cookie kept as a group,
 * and `cache-control: private, max-age=0` when it sets none.
 */
export function authContinueHeaders(response) {
  const headers = new Headers();
  for (const [key, value] of response.headers) {
    if (key === 'content-type') continue;
    if (key === 'set-cookie') headers.append(key, value);
    else headers.set(key, value);
  }
  if (!response.headers.get('cache-control')) headers.set('cache-control', DEFAULT_CACHE_CONTROL);
  return headers;
}

// On the Quant edge, a failed function (a thrown error, either timeout, or an
// auth or filter contract error) gives the client a bare 500. Locally the
// message also goes to the terminal.
function errorResponse() {
  return new Response(null, { status: 500 });
}

function errorMessage(err) {
  return err && typeof err.message === 'string' ? err.message : String(err);
}

function failureLine(fn, err) {
  return `Edge function ${fn.uuid} failed: ${errorMessage(err)}`;
}

async function invoke(state, fn, ctx, mode) {
  const handler = MODES[mode];
  if (!handler) throw new Error(`Unknown function mode: ${mode}`);
  const script = compile(state.cache, fn, mode);
  const { globals } = await state.libraries();
  const event = hydrateEvent(buildEventPayload(fn, ctx, mode, state));
  const timers = runTimers((err) => state.log(failureLine(fn, err)));
  try {
    const context = createFunctionContext(state, globals, event, timers);
    const pending = runScript(script, context, state.timeoutMs);
    return await withTimeBudget(handler(pending, event, ctx), state.timeoutMs);
  } finally {
    timers.clearAll();
  }
}

function defaultLog(line) {
  process.stderr.write(`${line}\n`);
}

// Whether a process-level error comes from function code: a value that is
// not an object (only function code throws such values), an object made in
// a function context, or an error whose stack names a function file.
function fromFunctionCode(cache, err) {
  if (err === null || (typeof err !== 'object' && typeof err !== 'function')) return true;
  if (!(err instanceof Object)) return true;
  const stack = typeof err.stack === 'string' ? err.stack : '';
  return [...cache.keys()].some((file) => stack.includes(file));
}

const NO_WATCH = Object.freeze({ enter() {}, leave() {} });

/**
 * Create a function executor.
 * @param {Object} options
 * @param {Object} options.kvStore The kvStore global for functions.
 * @param {string} options.org The quantOrg value.
 * @param {string} options.project The quantProject value.
 * @param {string} options.root The project directory for edge libraries.
 * @param {number} [options.timeoutMs] The time budget for one run.
 * @param {Object} [options.geo] Geolocation fields that replace the stub values.
 * @param {string} [options.clientIp] The client address that replaces the socket address.
 * @param {Function} [options.log] Writes one line to the terminal.
 * @param {{ enter: Function, leave: Function }} [options.watch] Told when a run starts and ends (the watchdog):
 *   enter(uuid) returns a token, and leave(token) gets it back.
 * @returns {{ run: (fn: { uuid: string, path: string }, ctx: Object) => Promise<Response>, fromFunction: (err: unknown) => boolean }}
 *   fromFunction: whether an uncaught error comes from function code that this executor ran.
 *   ctx: { mode ('function' | 'auth' | 'filter'), url, method, headers, body,
 *   clientAddress, baseHeaders (function mode), inline (function mode: the event
 *   URL is the page URL), response (filter mode) }.
 */
export function createExecutor({ kvStore, org, project, root = process.cwd(), timeoutMs = DEFAULT_TIMEOUT_MS, geo, clientIp, log = defaultLog, watch = NO_WATCH }) {
  let libraries = null;
  const state = {
    kvStore, org, project, timeoutMs, geo, clientIp, log,
    cache: new Map(),
    libraries: () => {
      if (!libraries) libraries = loadProjectLibraries(root);
      return libraries;
    }
  };
  return {
    fromFunction: (err) => fromFunctionCode(state.cache, err),
    async run(fn, ctx = {}) {
      const mode = ctx.mode || 'function';
      if (mode === 'filter' && !(ctx.response && ctx.response.body)) return ctx.response;
      const token = watch.enter(fn.uuid);
      try {
        return await invoke(state, fn, ctx, mode);
      } catch (err) {
        log(failureLine(fn, err));
        return errorResponse();
      } finally {
        watch.leave(token);
      }
    }
  };
}
