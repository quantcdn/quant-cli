import { expect } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveOptions, runServe } from '../../../src/commands/serve.js';
import { toLocalIndex } from '../../../src/serve/kv/remote.js';

const TOKEN = 'remote-token-never-printed';
const ENV = { QUANT_API_TOKEN: TOKEN, QUANT_BASE_URL: 'http://127.0.0.1:8080/api/v2' };
const PREFIX = '/api/v2/organizations/acme/projects/site/kv';
const FN = 'aaaa0000-0000-4000-8000-0000000000bb';
const SNAPSHOT_VALUE = 'snapshot-value-never-on-disk';
const LOCAL_WRITE = 'local-write-never-on-disk';
const SNAPSHOT_STORE = 'acme-site-sessions';

const reply = (status, body) => ({ status, headers: { get: () => null }, json: async () => body });

// The remote store: three index members, a masked secret and a key with a ttl.
function remoteItems() {
  return [
    { key: 'item:1', value: { color: 'red', note: SNAPSHOT_VALUE }, encrypted: false, version: 'V1' },
    { key: 'item:2', value: { color: 'red' }, encrypted: false, version: 'V1' },
    { key: 'item:3', value: { color: 'blue' }, encrypted: false, version: 'V1' },
    { key: 'api-key', value: '[ENCRYPTED]', encrypted: true, version: 'V1' },
    { key: 'short', value: 'lives', encrypted: false, version: 'V1', expires_at: Math.floor(Date.now() / 1000) + 3600 }
  ];
}

const INDEXES = [
  { name: 'byColor', collection: 'item', fields: ['color'], unique: false, count: true, slot: 1, state: 'ACTIVE', createdAt: '2026-11-01T00:00:00.000Z' }
];

// A fake portal for one store "sessions" (id abc). `status` maps a route to a status.
function fakePortal({ items = remoteItems(), status = {}, stores } = {}) {
  const calls = [];
  const byKey = new Map(items.map((item) => [item.key, item]));
  const keys = items.map((item) => item.key);
  const fetchImpl = async (url, init) => {
    const u = new URL(String(url));
    const route = u.pathname.replace(PREFIX, '') || '/';
    calls.push({ route, auth: init.headers.Authorization });
    if (status[route]) return reply(status[route], { message: 'refused' });
    if (route === '/') return reply(200, stores ?? [{ id: 'abc', name: 'sessions' }, { id: 'zzz', name: 'local' }]);
    if (route === '/abc/indexes') return reply(200, { indexes: INDEXES });
    if (route === '/abc/keys') {
      const from = Number(u.searchParams.get('cursor') ?? 0);
      const to = Math.min(from + Number(u.searchParams.get('limit')), keys.length);
      return reply(200, { data: keys.slice(from, to).map((key) => ({ key })), next_cursor: to < keys.length ? String(to) : null, has_more: to < keys.length });
    }
    if (route === '/abc/batch-get') return reply(200, { items: JSON.parse(init.body).keys.map((key) => byKey.get(key) ?? null) });
    return reply(404, {});
  };
  return { calls, fetchImpl };
}

// The function: ?op=get|set|count|list&store=<name>&key=&value=&color=
const FUNCTION = `
const url = new URL(event.request.url);
const q = (name) => url.searchParams.get(name);
const store = kvStore.open('acme-site-' + (q('store') || 'sessions'));
let out;
if (q('op') === 'set') out = await store.set(q('key'), q('value'));
else if (q('op') === 'count') out = await store.count({ index: 'byColor', equals: { color: q('color') } });
else if (q('op') === 'list') out = (await store.list({ index: 'byColor', equals: { color: q('color') } })).items.map((item) => item.key);
else out = await store.get(q('key'));
return new Response(JSON.stringify(out === undefined ? null : out), { headers: { 'x-version': 'one' } });
`;

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function projectRoot(tmp, { ledgers } = {}) {
  const root = path.join(tmp, 'site');
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist', 'index.html'), 'home');
  fs.mkdirSync(path.join(root, 'quant', 'edge-functions'), { recursive: true });
  fs.writeFileSync(path.join(root, 'quant', 'edge-functions', 'kv.js'), FUNCTION);
  writeJson(path.join(root, 'quant', 'edge-functions.json'), [{ id: 'kv', uuid: FN, type: 'function', path: 'quant/edge-functions/kv.js', description: 'kv' }]);
  writeJson(path.join(root, 'quant', 'edge-rules.json'), { version: 1, namespace: 'test', rules: [
    { id: 'kv', name: 'KV', type: 'function', urls: ['/kv'], weight: 100, function_uuid: FN }
  ] });
  writeJson(path.join(root, 'quant', 'meta.json'), { kv_stores: [
    { name: 'sessions', initial_values: [{ key: 'seeded', value: 'from meta' }] },
    { name: 'local', initial_values: [{ key: 'own', value: 'mine' }] }
  ] });
  fs.mkdirSync(path.join(root, 'quant', 'kv-fixtures'), { recursive: true });
  writeJson(path.join(root, 'quant', 'kv-fixtures', 'sessions.json'), [{ key: 'fixture', value: 'from fixtures' }]);
  if (ledgers) writeJson(path.join(root, 'quant', 'kv-ledgers.json'), ledgers);
  return root;
}

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

async function until(check, timeoutMs = 8000) {
  const started = Date.now();
  while (!(await check())) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// Start quant serve; returns { url, output, ask(query), close() }.
async function serve(root, portal, flags = {}) {
  const output = [];
  let stop;
  const stopped = new Promise((resolve) => { stop = resolve; });
  let url;
  const options = resolveOptions({ dir: 'dist', port: 0, org: 'acme', project: 'site', 'kv-remote': 'sessions', ...flags }, { root, gitUserName: () => null });
  const running = runServe(options, {
    stop: stopped,
    print: (line) => output.push(line),
    log: (line) => output.push(line),
    env: ENV,
    fetchImpl: portal.fetchImpl,
    onListening: (server) => { url = server.url; }
  });
  let failed = null;
  running.catch((err) => { failed = err; });
  await until(() => url || failed);
  if (failed) throw failed;
  const ask = async (query) => JSON.parse(await (await fetch(`${url}/kv?${new URLSearchParams(query)}`)).text());
  return { url, output, ask, close: async () => { stop(); await running; } };
}

async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

describe('serve --kv-remote', function () {
  this.timeout(20000);
  let tmp;

  beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-kv-remote-')); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  describe('toLocalIndex', () => {
    it('keeps the definition fields of a portal index and drops the state fields', () => {
      expect(toLocalIndex(INDEXES[0])).to.deep.equal({ name: 'byColor', collection: 'item', fields: ['color'], unique: false, count: true });
      expect(toLocalIndex({ name: 'byDate', collection: 'post', sortBy: 'date', state: 'ACTIVE' }))
        .to.deep.equal({ name: 'byDate', collection: 'post', fields: [], sortBy: 'date', unique: false, count: false });
    });
  });

  it('serves the snapshot, keeps writes local, and runs no seed for the remote store', async () => {
    const root = projectRoot(tmp);
    const portal = fakePortal();
    const site = await serve(root, portal);
    try {
      expect((await site.ask({ key: 'item:1' })).note).to.equal(SNAPSHOT_VALUE);
      expect(await site.ask({ op: 'set', key: 'new', value: LOCAL_WRITE })).to.not.equal(null);
      expect(await site.ask({ key: 'new' })).to.equal(LOCAL_WRITE);
      expect(await site.ask({ key: 'api-key' })).to.equal('[ENCRYPTED]');
      expect(await site.ask({ key: 'short' })).to.equal('lives');
      expect(await site.ask({ op: 'count', color: 'red' })).to.equal(2);
      expect(await site.ask({ op: 'list', color: 'red' })).to.deep.equal(['item:1', 'item:2']);
      expect(await site.ask({ key: 'seeded' })).to.equal(null);
      expect(await site.ask({ key: 'fixture' })).to.equal(null);
      expect(await site.ask({ store: 'local', key: 'own' })).to.equal('mine');
    } finally {
      await site.close();
    }
    expect(site.output).to.include('KV store sessions: copied 5 keys from the portal (1 encrypted values masked).');
    expect(site.output.some((line) => line.includes('sessions → acme-site-sessions in memory'))).to.equal(true);
    expect(site.output.join('\n')).to.not.include('Ledgers of sessions');
    expect(portal.calls.every((call) => call.auth === `Bearer ${TOKEN}`)).to.equal(true);
    const printed = site.output.join('\n');
    expect(printed).to.not.include(TOKEN);
    expect(fs.existsSync(path.join(root, '.quant'))).to.equal(true);
    for (const file of filesUnder(root)) {
      const text = fs.readFileSync(file, 'latin1');
      for (const value of [SNAPSHOT_VALUE, LOCAL_WRITE, TOKEN]) expect(text, `${value} in ${file}`).to.not.include(value);
    }
    const state = JSON.parse(fs.readFileSync(path.join(root, '.quant', 'kv', 'state.json'), 'utf8'));
    expect(state.seeded[SNAPSHOT_STORE]).to.equal(undefined);
    expect(state.seeded['acme-site-local']).to.be.a('string');
  });

  it('reads the snapshot again on a restart, and the local write is gone', async () => {
    const root = projectRoot(tmp);
    const portal = fakePortal();
    const first = await serve(root, portal);
    try {
      await first.ask({ op: 'set', key: 'item:1', value: LOCAL_WRITE });
      await first.ask({ store: 'local', op: 'set', key: 'kept', value: 'on disk' });
      expect(await first.ask({ key: 'item:1' })).to.equal(LOCAL_WRITE);
    } finally {
      await first.close();
    }
    const reads = portal.calls.length;
    const second = await serve(root, portal);
    try {
      expect(portal.calls.length).to.be.greaterThan(reads);
      expect((await second.ask({ key: 'item:1' })).note).to.equal(SNAPSHOT_VALUE);
      expect(await second.ask({ store: 'local', key: 'kept' })).to.equal('on disk');
    } finally {
      await second.close();
    }
  });

  it('keeps the local state of the store for a session without --kv-remote', async () => {
    const root = projectRoot(tmp);
    const portal = fakePortal();
    const plain = await serve(root, portal, { 'kv-remote': undefined });
    try {
      expect(await plain.ask({ key: 'seeded' })).to.equal('from meta');
      await plain.ask({ op: 'set', key: 'mine', value: 'local only' });
    } finally {
      await plain.close();
    }
    expect(portal.calls).to.have.length(0);
    const remote = await serve(root, portal);
    try {
      expect(await remote.ask({ key: 'mine' })).to.equal(null);
      await remote.ask({ op: 'set', key: 'mine', value: LOCAL_WRITE });
    } finally {
      await remote.close();
    }
    const again = await serve(root, portal, { 'kv-remote': undefined });
    try {
      expect(await again.ask({ key: 'mine' })).to.equal('local only');
      expect(await again.ask({ key: 'item:1' })).to.equal(null);
    } finally {
      await again.close();
    }
  });

  it('keeps the snapshot and its local writes on a --watch reload, with no new read', async () => {
    const root = projectRoot(tmp);
    const portal = fakePortal();
    const site = await serve(root, portal, { watch: true });
    try {
      await site.ask({ op: 'set', key: 'new', value: 'written' });
      const reads = portal.calls.length;
      await new Promise((resolve) => setTimeout(resolve, 300));
      fs.writeFileSync(path.join(root, 'quant', 'edge-functions', 'kv.js'), FUNCTION.replace("'x-version': 'one'", "'x-version': 'two'"));
      await until(async () => (await fetch(`${site.url}/kv?key=new`)).headers.get('x-version') === 'two');
      expect(await site.ask({ key: 'new' })).to.equal('written');
      expect((await site.ask({ key: 'item:1' })).note).to.equal(SNAPSHOT_VALUE);
      expect(portal.calls.length).to.equal(reads);
    } finally {
      await site.close();
    }
  });

  it('works with --memory', async () => {
    const root = projectRoot(tmp);
    const site = await serve(root, fakePortal(), { memory: true });
    try {
      expect((await site.ask({ key: 'item:1' })).note).to.equal(SNAPSHOT_VALUE);
      expect(await site.ask({ store: 'local', key: 'own' })).to.equal('mine');
    } finally {
      await site.close();
    }
    expect(fs.existsSync(path.join(root, '.quant'))).to.equal(false);
  });

  it('copies the first 10000 keys only and says that writes stay local', async () => {
    const root = projectRoot(tmp);
    const items = Array.from({ length: 10001 }, (_, i) => ({ key: `k${String(i).padStart(5, '0')}`, value: i, encrypted: false }));
    const site = await serve(root, fakePortal({ items }));
    try {
      expect(await site.ask({ key: 'k09999' })).to.equal(9999);
      expect(await site.ask({ key: 'k10000' })).to.equal(null);
    } finally {
      await site.close();
    }
    expect(site.output).to.include('KV store sessions: copied the first 10000 keys only (limit 10000). Writes stay local.');
  });

  it('says that ledgers are not copied when quant/kv-ledgers.json has entries for the store', async () => {
    const root = projectRoot(tmp, { ledgers: { sessions: [{ name: 'events', collection: 'events', chains: 1, retentionDays: 30 }] } });
    const site = await serve(root, fakePortal());
    await site.close();
    expect(site.output).to.include('Ledgers of sessions are not copied from the portal; declare local ledgers in quant/kv-ledgers.json.');
  });

  it('refuses a store that quant/meta.json does not declare, before any portal call', async () => {
    const root = projectRoot(tmp);
    const portal = fakePortal();
    const error = await failure(serve(root, portal, { 'kv-remote': 'other' }));
    expect(error.message).to.equal('--kv-remote other is not a KV store in quant/meta.json.');
    expect(portal.calls).to.have.length(0);
  });

  it('stops start-up with the one-line portal error, without the token', async () => {
    const root = projectRoot(tmp);
    const denied = await failure(serve(root, fakePortal({ status: { '/abc/keys': 403 } })));
    expect(denied.message).to.equal('QUANT_API_TOKEN lacks the kv:read scope for KV store sessions.');
    const missing = await failure(serve(root, fakePortal({ stores: [] })));
    expect(missing.message).to.equal('The KV store sessions is not linked to this project.');
    for (const error of [denied, missing]) expect(`${error.message}\n${error.stack}`).to.not.include(TOKEN);
  });

  it('needs the portal organisation and project', () => {
    const root = projectRoot(tmp);
    const error = (() => {
      try {
        resolveOptions({ dir: 'dist', 'kv-remote': 'sessions' }, { root, gitUserName: () => null });
      } catch (err) {
        return err;
      }
      return null;
    })();
    expect(error.message).to.equal('--kv-remote needs the portal organisation and project: pass --org and --project, or set them in quant/serve.json or quant.json.');
  });
});
