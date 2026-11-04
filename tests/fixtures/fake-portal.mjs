/**
 * A fake portal for the quant serve end-to-end test. It serves the routes
 * that --pull-rules and --kv-remote read from JSON fixtures, on 127.0.0.1,
 * and records the method, path and Authorization header of each request.
 */

import fs from 'node:fs';
import http from 'node:http';

const DEFAULT_FIXTURES = new URL('./fake-portal/fixtures.json', import.meta.url);

export function loadFixtures(file = DEFAULT_FIXTURES) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

// The routes, as { method, path (after /api/v2/organizations/<org>/projects/<project>), reply(body) }.
function routes(fixtures) {
  const store = fixtures.stores[0];
  const keys = fixtures.items.map((item) => item.key);
  const byKey = new Map(fixtures.items.map((item) => [item.key, item]));
  return [
    { method: 'GET', path: '/rules', reply: () => fixtures.rules },
    { method: 'GET', path: '/custom-headers', reply: () => fixtures.customHeaders },
    { method: 'GET', path: '/kv', reply: () => fixtures.stores },
    { method: 'GET', path: `/kv/${store.id}/indexes`, reply: () => ({ indexes: fixtures.indexes }) },
    { method: 'GET', path: `/kv/${store.id}/keys`, reply: () => ({ data: keys.map((key) => ({ key })), next_cursor: null, has_more: false }) },
    { method: 'POST', path: `/kv/${store.id}/batch-get`, reply: (body) => ({ items: JSON.parse(body).keys.map((key) => byKey.get(key) ?? null) }) }
  ];
}

/**
 * Start the fake portal.
 * @returns {Promise<{ base: string, requests: Object[], close: () => Promise<void> }>}
 *   base: the value for QUANT_BASE_URL; requests: { method, path, auth } in order.
 */
export async function startFakePortal(fixtures = loadFixtures()) {
  const requests = [];
  const prefix = `/api/v2/organizations/${fixtures.organization}/projects/${fixtures.project}`;
  const table = routes(fixtures);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    requests.push({ method: req.method, path: url.pathname, auth: req.headers.authorization });
    const body = await readBody(req);
    const route = table.find((entry) => entry.method === req.method && `${prefix}${entry.path}` === url.pathname);
    res.writeHead(route ? 200 : 404, { 'content-type': 'application/json' });
    res.end(JSON.stringify(route ? route.reply(body) : { message: 'not found' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    base: `http://127.0.0.1:${port}/api/v2`,
    requests,
    close: () => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); })
  };
}
