/**
 * The request and response headers and the request body of a forwarded
 * request. The --proxy dev server stage and the proxy rule action use them.
 */

const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'te', 'trailer', 'upgrade', 'expect'];
const PROXY_REQUEST_DROP = [...HOP_BY_HOP, 'host', 'content-length'];
// Node fetch decodes the body, so the encoding and length headers are dropped.
export const PROXY_RESPONSE_DROP = [...HOP_BY_HOP, 'content-encoding', 'content-length'];

export function withoutHeaders(source, names) {
  const headers = new Headers(source);
  for (const name of names) headers.delete(name);
  return headers;
}

/** The client request headers without the hop-by-hop, host and length headers. */
export function proxyRequestHeaders(req) {
  const headers = new Headers();
  for (let i = 0; i < req.rawHeaders.length; i += 2) headers.append(req.rawHeaders[i], req.rawHeaders[i + 1]);
  return withoutHeaders(headers, PROXY_REQUEST_DROP);
}

// The proxy streams the request body to the origin, unless a function
// (an auth rule that continued) has read it already. Then the proxy sends the
// capped body that the function saw.
export async function proxyBody(ctx) {
  if (['GET', 'HEAD'].includes(ctx.method)) return {};
  if (ctx.bodyPending) {
    const bytes = await ctx.bodyPending;
    return bytes ? { body: bytes } : {};
  }
  ctx.bodyStreamed = true;
  return { body: ctx.req, duplex: 'half' };
}
