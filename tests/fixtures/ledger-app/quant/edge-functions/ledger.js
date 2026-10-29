// A test function for the local ledgers of quant serve: append to the events
// ledger, read its status, a proof and a time window.
const url = new URL(event.request.url);
const store = kvStore.open(`${event.quantOrg}-${event.quantProject}-audit`);
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store' }
});
try {
  if (event.request.method === 'POST' && url.pathname === '/api/append') {
    return json(await store.append('events', await event.request.json(), { idempotencyKey: url.searchParams.get('id') || undefined }));
  }
  if (url.pathname === '/api/status') return json(await store.ledgerStatus('events'));
  if (url.pathname === '/api/proof') return json(await store.ledgerProof('events', url.searchParams.get('key')));
  if (url.pathname === '/api/window') {
    const page = await store.list({ collection: 'events', since: Number(url.searchParams.get('since')), until: Number(url.searchParams.get('until')) });
    return json({ keys: page.items.map((item) => item.key), chain: await kvStore.verifyChain(page.items) });
  }
} catch (err) {
  return json({ code: err.code, message: err.message }, 400);
}
return json({ error: 'Not found' }, 404);
