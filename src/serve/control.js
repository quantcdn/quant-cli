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

/**
 * The control route handler.
 * Phase 1 has GET /_quant_serve/info only. The clock and archive routes give
 * 404 until a later release.
 * @param {Object} options
 * @param {string} [options.clock] The clock mode ('real').
 * @param {Object} [options.backend] The local KV backend (a later release).
 * @param {Function} [options.info] Returns the fields for /_quant_serve/info.
 * @returns {(request: { method: string, pathname: string, remoteAddress: string, headers: Object }) => Promise<Response>}
 */
export function controlRoutes({ clock = 'real', backend = null, info = () => ({}) } = {}) {
  const routes = {
    'GET /_quant_serve/info': () => json({ server: 'quant serve', clock, ...info(backend) })
  };
  return async function control({ method, pathname, remoteAddress, headers = {} }) {
    if (!LOOPBACK.has(remoteAddress)) return text(403, REFUSED);
    if (headers['x-quant-serve'] !== '1') return text(403, NEEDS_HEADER);
    const route = routes[`${method} ${pathname}`];
    return route ? route() : text(404, 'Not found');
  };
}
