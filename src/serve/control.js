/**
 * The local control route of `quant serve`: /_quant_serve/ on the same port.
 * It answers loopback addresses only, and only a request with the header
 * x-quant-serve: 1 (a page in a browser cannot send it without a preflight).
 * It is never proxied, and it never exists on the Quant edge.
 */

const PREFIX = '/_quant_serve';
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const REFUSED = 'The quant serve control route answers loopback addresses only.';
const NEEDS_HEADER = 'The quant serve control route needs the request header x-quant-serve: 1.';
const NEEDS_MANUAL = 'The clock route needs quant serve --clock manual.';
const BAD_CLOCK = 'The body must be JSON: { "advanceMs": <ms> } or { "setMs": <epoch ms> }, a whole number of 0 or more.';
const NO_STORE = 'No KV store with that name in quant/meta.json. Send { "store": "<store name>" }.';

/** True for /_quant_serve and every path under /_quant_serve/. */
export function isControlPath(pathname) {
  return pathname === PREFIX || pathname.startsWith(`${PREFIX}/`);
}

function text(status, body) {
  return new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}

function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
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
 * @param {Object} options
 * @param {string} [options.clock] The clock mode: 'real' or 'manual'.
 * @param {Object} [options.backend] The local KV backend.
 * @param {() => Map<string, string>} [options.stores] The meta.json store names and their ids.
 * @param {Function} [options.info] Returns the server fields for /_quant_serve/info.
 * @returns {(request: { method: string, pathname: string, remoteAddress: string, headers: Object,
 *   body?: () => Promise<Uint8Array|null> }) => Promise<Response>}
 */
export function controlRoutes({ clock = 'real', backend = null, stores = () => new Map(), info = () => ({}) } = {}) {
  async function moveClock(body) {
    if (clock !== 'manual' || !backend) return text(409, NEEDS_MANUAL);
    const target = clockTarget(await bodyObject(body), backend.now());
    if (target === null) return text(400, BAD_CLOCK);
    await backend.setClock(target);
    return json({ now: backend.now() });
  }

  async function archiveNow(body) {
    const request = await bodyObject(body);
    const id = request && typeof request.store === 'string' ? stores().get(request.store) : undefined;
    if (!id || !backend) return text(404, NO_STORE);
    await backend.archiveNow(id);
    return json({ archived: true });
  }

  const routes = {
    'GET /_quant_serve/info': () => json({ server: 'quant serve', clock, ...backendInfo(backend), ...info() }),
    'POST /_quant_serve/clock': moveClock,
    'POST /_quant_serve/ledger/archive-now': archiveNow
  };
  return async function control({ method, pathname, remoteAddress, headers = {}, body = async () => null }) {
    if (!LOOPBACK.has(remoteAddress)) return text(403, REFUSED);
    if (headers['x-quant-serve'] !== '1') return text(403, NEEDS_HEADER);
    const route = routes[`${method} ${pathname}`];
    return route ? route(body) : text(404, 'Not found');
  };
}
