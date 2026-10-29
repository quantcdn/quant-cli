/**
 * The local control route of `quant serve`: /_quant_serve/ on the same port.
 * It answers loopback addresses only, and only a request with the header
 * x-quant-serve: 1 (a page in a browser cannot send it without a preflight).
 * It is never proxied, and it never exists on the Quant edge.
 */

import { ERROR_CODES } from '@quantcdn/edge-kv';

const PREFIX = '/_quant_serve';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const REFUSED = 'The quant serve control route answers loopback addresses only.';
const NEEDS_HEADER = 'The quant serve control route needs the request header x-quant-serve: 1.';
const FOREIGN_ORIGIN = 'The quant serve control route refuses a request with an Origin that is not local.';
const LOCAL_ORIGIN_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
const NEEDS_MANUAL = 'The clock route needs quant serve --clock manual.';
const NEEDS_BACKEND = 'The clock route needs the local KV backend of quant serve.';
const BAD_CLOCK = 'The body must be JSON: { "advanceMs": <ms> } or { "setMs": <epoch ms> }, a whole number of 0 or more.';
// The largest time that a Date can hold.
const MAX_DATE_MS = 8.64e15;
const OUT_OF_RANGE = `The new time must be in the Date range (at most ${MAX_DATE_MS} ms).`;

// No Origin (curl, scripts), or an http(s) origin on a local host name.
function localOrigin(origin) {
  if (origin === undefined) return true;
  try {
    const url = new URL(origin);
    return ['http:', 'https:'].includes(url.protocol) && LOCAL_ORIGIN_HOSTS.has(url.hostname);
  } catch (_err) {
    return false;
  }
}

/** True for /_quant_serve and every path under /_quant_serve/. */
export function isControlPath(pathname) {
  return pathname === PREFIX || pathname.startsWith(`${PREFIX}/`);
}

function text(status, body) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
}

// The JSON object of the request body, or null.
async function bodyObject(body) {
  const bytes = await body();
  if (!bytes) return null;
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (_err) {
    return null;
  }
}

const isMs = (value) => Number.isSafeInteger(value) && value >= 0;

// The new server time from { advanceMs } or { setMs }, or null.
function clockTarget(request, now) {
  const keys = request ? Object.keys(request) : [];
  if (keys.length !== 1 || !isMs(request[keys[0]])) return null;
  if (keys[0] === 'advanceMs') return now + request.advanceMs;
  return keys[0] === 'setMs' ? request.setMs : null;
}

const BAD_SUBJECT_BODY = 'The body must be a JSON object with "store" and "ledger" names.';
const SHRED_FIELDS = ['subjectId', 'reason', 'authority', 'requestedBy'];
const SUBJECT_ENTRIES_FIELDS = ['subjectId', 'collection', 'since', 'until', 'limit', 'nextToken', 'personal'];

// The fields of the request that the backend call takes (absent fields are left out).
function pick(request, fields) {
  return Object.fromEntries(fields.filter((field) => request[field] !== undefined).map((field) => [field, request[field]]));
}

const isKVError = (err) => err !== null && typeof err === 'object' && err.name === 'KVError' && typeof err.code === 'string';

// A KVError of the backend as its status and code; any other error goes up.
function kvErrorResponse(err) {
  if (!isKVError(err)) throw err;
  const status = Number.isInteger(err.status) ? err.status : (ERROR_CODES[err.code]?.status ?? 500);
  return json({ code: err.code, message: err.message }, status);
}

function backendInfo(backend) {
  return backend ? { now: backend.now(), publicKey: backend.publicKey() } : {};
}

/**
 * The control route handler.
 * - GET /_quant_serve/info: the server fields, the clock mode, the server time
 *   and the PEM public key that signs the local ledger proofs.
 * - POST /_quant_serve/clock { advanceMs } or { setMs }: --clock manual only.
 * - POST /_quant_serve/ledger/archive-now { store }: archive the ledger
 *   entries of a meta.json store now.
 * - POST /_quant_serve/ledger/shred { store, ledger, subjectId, reason, authority, requestedBy }
 *   and POST /_quant_serve/ledger/subject-entries { store, ledger, subjectId, ... }: the
 *   backend shred and subjectEntries calls. A backend KVError keeps its status and code.
 * @param {Object} options
 * @param {string} [options.clock] The clock mode: 'real' or 'manual'.
 * @param {Object} [options.backend] The local KV backend.
 * @param {() => Map<string, string>} [options.stores] The meta.json store names and their ids.
 * @param {string} [options.meta] The meta.json file in use (--meta), for the error text.
 * @param {Function} [options.info] Returns the server fields for /_quant_serve/info.
 * @returns {(request: { method: string, pathname: string, remoteAddress: string, headers: Object,
 *   body?: () => Promise<Uint8Array|null> }) => Promise<Response>}
 */
export function controlRoutes({ clock = 'real', backend = null, stores = () => new Map(), meta = 'quant/meta.json', info = () => ({}) } = {}) {
  async function moveClock(body) {
    if (clock !== 'manual') return text(409, NEEDS_MANUAL);
    if (!backend) return text(409, NEEDS_BACKEND);
    const target = clockTarget(await bodyObject(body), backend.now());
    if (target === null) return text(400, BAD_CLOCK);
    if (target > MAX_DATE_MS) return text(400, OUT_OF_RANGE);
    await backend.setClock(target);
    return json({ now: backend.now() });
  }

  async function archiveNow(body) {
    const request = await bodyObject(body);
    const id = request && typeof request.store === 'string' ? stores().get(request.store) : undefined;
    if (!id || !backend) return noStore();
    await backend.archiveNow(id);
    return json({ archived: true });
  }

  const noStore = () => text(404, `No KV store with that name in ${meta}. Send { "store": "<store name>" }.`);

  // A subject call: { store, ledger, ...fields } -> call(storeId, ledger, fields).
  function subjectRoute(fields, call) {
    return async (body) => {
      const request = await bodyObject(body);
      if (!request || typeof request.ledger !== 'string') return text(400, BAD_SUBJECT_BODY);
      const id = typeof request.store === 'string' ? stores().get(request.store) : undefined;
      if (!id || !backend) return noStore();
      try {
        return json(await call(id, request.ledger, pick(request, fields)));
      } catch (err) {
        return kvErrorResponse(err);
      }
    };
  }

  const routes = {
    'GET /_quant_serve/info': () => json({ server: 'quant serve', clock, ...backendInfo(backend), ...info() }),
    'POST /_quant_serve/clock': moveClock,
    'POST /_quant_serve/ledger/archive-now': archiveNow,
    'POST /_quant_serve/ledger/shred': subjectRoute(SHRED_FIELDS, (id, ledger, fields) => backend.shred(id, ledger, fields)),
    'POST /_quant_serve/ledger/subject-entries': subjectRoute(SUBJECT_ENTRIES_FIELDS,
      (id, ledger, fields) => backend.subjectEntries(id, ledger, fields))
  };
  return async function control({ method, pathname, remoteAddress, headers = {}, body = async () => null }) {
    if (!LOOPBACK.has(remoteAddress)) return text(403, REFUSED);
    if (headers['x-quant-serve'] !== '1') return text(403, NEEDS_HEADER);
    if (!localOrigin(headers.origin)) return text(403, FOREIGN_ORIGIN);
    const route = routes[`${method} ${pathname}`];
    return route ? route(body) : text(404, 'Not found');
  };
}
