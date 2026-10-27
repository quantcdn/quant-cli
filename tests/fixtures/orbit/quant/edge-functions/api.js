// An Orbit-shaped stub of the Orbit API function, for the quant serve tests.
// It keeps the Orbit request handling (public origin, store id, JSON
// responses) and reads one KV value. It is not the Orbit API.
const request = event.request;
const url = new URL(request.url);
if (event.url) {
  const publicUrl = new URL(event.url);
  url.protocol = publicUrl.protocol;
  url.host = publicUrl.host;
}
const path = url.pathname.replace(/\/$/, '');
const store = `${event.quantOrg}-${event.quantProject}-orbit`;
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' }
  });
if (request.method === 'GET' && path === '/api/workspace') {
  const settings = await kvStore.get(store, 'workspace:studio:settings');
  return json({ store, settings, functionPath: event.url.pathname, clientIp: request.headers.get('quant-client-ip') });
}
return json({ error: 'Not found' }, 404);
