import { expect } from 'chai';
import { findStore, readStore } from '../../../src/serve/portal/kv-remote.js';
import { createPortalClient, requestBudget } from '../../../src/serve/portal/client.js';
import { pullProject } from '../../../src/serve/portal/pull-rules.js';

const BASE = new URL('http://127.0.0.1:8080/api/v2');
const CTX = { customer: 'org', project: 'proj', name: 'sessions' };
const PREFIX = '/api/v2/organizations/org/projects/proj/kv';

const reply = (status, body) => ({
  status,
  headers: { get: () => null },
  json: async () => {
    if (body === undefined) throw new Error('no body');
    return body;
  }
});

// A fake portal: pages of keys, batch-get, indexes and the store list.
function portal({ total = 0, pageSize = 1000, stores, indexes = [], status = {}, encrypted = [], budget } = {}) {
  const calls = [];
  const keys = Array.from({ length: total }, (_, i) => `k${String(i).padStart(5, '0')}`);
  const fetchImpl = async (url, init) => {
    const u = new URL(String(url));
    const route = u.pathname.replace(PREFIX, '') || '/';
    calls.push({ route, method: init.method, query: Object.fromEntries(u.searchParams), body: init.body && JSON.parse(init.body) });
    if (status[route]) return reply(status[route], { message: 'x' });
    if (route === '/') return reply(200, stores ?? [{ id: 'abc', name: 'sessions' }]);
    if (route === '/abc/indexes') return reply(200, { indexes });
    if (route === '/abc/keys') {
      const from = Number(u.searchParams.get('cursor') ?? 0);
      const to = Math.min(from + Math.min(Number(u.searchParams.get('limit')), pageSize), total);
      return reply(200, { data: keys.slice(from, to).map(key => ({ key })), next_cursor: to < total ? String(to) : null, has_more: to < total, page_end: 'limit' });
    }
    if (route === '/abc/batch-get') {
      return reply(200, { items: init.body && JSON.parse(init.body).keys.map(key => encrypted.includes(key)
        ? { key, value: '[ENCRYPTED]', encrypted: true, version: 'V1' }
        : { key, value: { n: key }, encrypted: false, version: 'V1', updated_at: 't' }) });
    }
    return reply(404);
  };
  return { calls, client: createPortalClient({ base: BASE, token: 'tok', fetchImpl, sleep: async () => {}, ...(budget ? { budget } : {}) }) };
}

const rejection = async (promise) => {
  try { await promise; } catch (error) { return error; }
  throw new Error('expected a rejection');
};

describe('remote KV read', () => {
  describe('findStore', () => {
    it('matches the name exactly and returns id and name', async () => {
      const { client, calls } = portal({ stores: [{ id: 'z', name: 'Sessions' }, { id: 'abc', name: 'sessions' }] });
      expect(await findStore(client, CTX)).to.deep.equal({ id: 'abc', name: 'sessions' });
      expect(calls[0].route).to.equal('/');
    });

    it('passes the store format through when the list reports 1 or 2', async () => {
      expect(await findStore(portal({ stores: [{ id: 'abc', name: 'sessions', format: 1 }] }).client, CTX)).to.deep.equal({ id: 'abc', name: 'sessions', format: 1 });
      expect(await findStore(portal({ stores: [{ id: 'abc', name: 'sessions', format: 'x' }] }).client, CTX)).to.deep.equal({ id: 'abc', name: 'sessions' });
    });

    it('fails when the store is not linked', async () => {
      const { client } = portal({ stores: [{ id: 'z', name: 'other' }] });
      const error = await rejection(findStore(client, CTX));
      expect(error.message).to.equal('The KV store sessions is not linked to this project.');
    });

    it('fails when the list is not an array or answers 404', async () => {
      const bad = await rejection(findStore(portal({ stores: {} }).client, CTX));
      expect(bad.message).to.equal('The KV store sessions is not linked to this project.');
      const missing = await rejection(findStore(portal({ status: { '/': 404 } }).client, CTX));
      expect(missing.message).to.equal('The KV store sessions is not linked to this project.');
    });

    it('names kv:read on 403', async () => {
      const error = await rejection(findStore(portal({ status: { '/': 403 } }).client, CTX));
      expect(error.message).to.equal('QUANT_API_TOKEN lacks the kv:read scope for KV store sessions.');
    });
  });

  describe('readStore', () => {
    it('follows cursors with limit 1000', async () => {
      const { client, calls } = portal({ total: 2500 });
      const result = await readStore(client, CTX, 'abc');
      expect(result.entries).to.have.length(2500);
      const pages = calls.filter(c => c.route === '/abc/keys');
      expect(pages.map(c => c.query.cursor)).to.deep.equal([undefined, '1000', '2000']);
      expect(pages[0].query.limit).to.equal('1000');
      expect(result.truncated).to.equal(false);
      expect(result.stoppedBy).to.equal(null);
    });

    it('batches values at 100 keys per call', async () => {
      const { client, calls } = portal({ total: 250 });
      const result = await readStore(client, CTX, 'abc');
      const batches = calls.filter(c => c.route === '/abc/batch-get');
      expect(batches.map(c => c.body.keys.length)).to.deep.equal([100, 100, 50]);
      expect(batches.every(c => c.method === 'POST')).to.equal(true);
      expect(result.entries[0]).to.deep.equal({ key: 'k00000', value: { n: 'k00000' }, metadata: { encrypted: false, version: 'V1', updated_at: 't' } });
      expect(calls).to.have.length(1 + 1 + 3);
      expect(result).to.not.have.property('requests');
    });

    it('reads index definitions and counts them as a request', async () => {
      const indexes = [{ name: 'byX', collection: 'c', fields: ['x'], state: 'ACTIVE' }];
      const { client } = portal({ total: 1, indexes });
      const result = await readStore(client, CTX, 'abc');
      expect(result.indexes).to.deep.equal(indexes);
    });

    it('counts masked values and keeps the string', async () => {
      const { client } = portal({ total: 3, encrypted: ['k00001'] });
      const result = await readStore(client, CTX, 'abc');
      expect(result.masked).to.equal(1);
      expect(result.entries[1].value).to.equal('[ENCRYPTED]');
    });

    it('drops keys that vanished between list and read', async () => {
      const fetchImpl = async (url) => {
        const route = new URL(String(url)).pathname.replace(PREFIX, '');
        if (route === '/abc/keys') return reply(200, { data: [{ key: 'a' }, { key: 'b' }], next_cursor: null, has_more: false });
        if (route === '/abc/batch-get') return reply(200, { items: [null, { key: 'b', value: 1 }] });
        return reply(200, { indexes: [] });
      };
      const client = createPortalClient({ base: BASE, token: 'tok', fetchImpl });
      const result = await readStore(client, CTX, 'abc');
      expect(result.entries).to.deep.equal([{ key: 'b', value: 1, metadata: {} }]);
    });

    it('stops at maxKeys and sets truncated', async () => {
      const { client } = portal({ total: 2500 });
      const result = await readStore(client, CTX, 'abc', { maxKeys: 1500 });
      expect(result.entries).to.have.length(1500);
      expect(result.truncated).to.equal(true);
      expect(result.stoppedBy).to.equal('keys');
    });

    it('stops at the request budget of the client and sets truncated', async () => {
      const { client, calls } = portal({ total: 5000, budget: requestBudget(4) });
      const result = await readStore(client, CTX, 'abc');
      expect(calls).to.have.length(4);
      expect(result.entries).to.have.length(200);
      expect(result.truncated).to.equal(true);
      expect(result.stoppedBy).to.equal('requests');
    });

    it('keeps the indexes and no keys when the budget is spent before the keys', async () => {
      const indexes = [{ name: 'byX', collection: 'c', fields: ['x'], state: 'ACTIVE' }];
      const { client, calls } = portal({ total: 5, indexes, budget: requestBudget(1) });
      const result = await readStore(client, CTX, 'abc');
      expect(calls).to.have.length(1);
      expect(result.indexes).to.deep.equal(indexes);
      expect(result.entries).to.deep.equal([]);
      expect(result.stoppedBy).to.equal('requests');
      const spent = await readStore(portal({ total: 5, budget: { max: 1, used: 1 } }).client, CTX, 'abc');
      expect(spent).to.include({ truncated: true, stoppedBy: 'requests' });
      expect(spent.indexes).to.deep.equal([]);
    });

    it('counts the rules and headers requests toward the shared start-up budget', async () => {
      const budget = requestBudget(5);
      const rulesFetch = async (url) => (String(url).endsWith('/rules') ? reply(200, []) : reply(200, {}));
      await pullProject(createPortalClient({ base: BASE, token: 'tok', fetchImpl: rulesFetch, budget }), { customer: 'org', project: 'proj' });
      expect(budget.used).to.equal(2);
      const { client, calls } = portal({ total: 300, budget });
      await findStore(client, CTX);
      const result = await readStore(client, CTX, 'abc');
      // 2 rules and headers + 1 store list + 1 indexes + 1 keys page: no batch is left.
      expect(calls).to.have.length(3);
      expect(budget.used).to.equal(5);
      expect(result.entries).to.deep.equal([]);
      expect(result.stoppedBy).to.equal('requests');
    });

    it('reports not linked on 404 from a store route', async () => {
      const { client } = portal({ status: { '/abc/keys': 404 } });
      const error = await rejection(readStore(client, CTX, 'abc'));
      expect(error.message).to.equal('The KV store sessions is not linked to this project.');
    });

    it('reads one batch at exactly 100 keys and two at 101', async () => {
      for (const [total, sizes] of [[100, [100]], [101, [100, 1]]]) {
        const { client, calls } = portal({ total });
        const result = await readStore(client, CTX, 'abc');
        expect(calls.filter(c => c.route === '/abc/batch-get').map(c => c.body.keys.length)).to.deep.equal(sizes);
        expect(result.entries).to.have.length(total);
        expect(result.truncated).to.equal(false);
      }
    });

    it('sets truncated when maxKeys ends on a page boundary and more pages exist', async () => {
      const more = portal({ total: 2000 });
      const cut = await readStore(more.client, CTX, 'abc', { maxKeys: 1000 });
      expect(cut.entries).to.have.length(1000);
      expect(cut.truncated).to.equal(true);
      expect(cut.stoppedBy).to.equal('keys');
      expect(more.calls.filter(c => c.route === '/abc/keys')).to.have.length(1);
      const exact = await readStore(portal({ total: 1000 }).client, CTX, 'abc', { maxKeys: 1000 });
      expect(exact.entries).to.have.length(1000);
      expect(exact.truncated).to.equal(false);
      expect(exact.stoppedBy).to.equal(null);
    });

    // A fake portal with one fixed keys page: `page` is the keys reply.
    function onePage(page, budget) {
      const calls = [];
      const fetchImpl = async (url, init) => {
        const route = new URL(String(url)).pathname.replace(PREFIX, '');
        calls.push(route);
        if (route === '/abc/keys') return reply(200, page);
        if (route === '/abc/batch-get') return reply(200, { items: JSON.parse(init.body).keys.map(key => ({ key, value: 1 })) });
        return reply(200, { indexes: [] });
      };
      return { calls, client: createPortalClient({ base: BASE, token: 'tok', fetchImpl, ...(budget ? { budget } : {}) }) };
    }

    it('stops with truncated when has_more is true and next_cursor is missing or empty', async () => {
      for (const next of [undefined, null, '']) {
        const { client, calls } = onePage({ data: [{ key: 'a' }], has_more: true, ...(next === undefined ? {} : { next_cursor: next }) });
        const result = await readStore(client, CTX, 'abc');
        expect(result.entries).to.have.length(1);
        expect(result.truncated).to.equal(true);
        expect(result.stoppedBy).to.equal('cursor');
        expect(calls.filter(route => route === '/abc/keys')).to.have.length(1);
      }
    });

    it('stops a repeated cursor at the request cap', async () => {
      const { client, calls } = onePage({ data: [{ key: 'a' }], has_more: true, next_cursor: 'same' }, requestBudget(9));
      const result = await readStore(client, CTX, 'abc');
      expect(calls).to.have.length(9);
      expect(result.truncated).to.equal(true);
      expect(result.stoppedBy).to.equal('requests');
    });

    it('counts 429 retries in the request budget', async () => {
      const budget = requestBudget(6);
      let fetched = 0;
      let limited = 0;
      const fetchImpl = async (url, init) => {
        fetched += 1;
        const route = new URL(String(url)).pathname.replace(PREFIX, '') || '/';
        if (route === '/') return reply(200, [{ id: 'abc', name: 'sessions' }]);
        if (route === '/abc/indexes' && limited++ < 2) return { status: 429, headers: { get: () => '0' }, json: async () => ({}) };
        if (route === '/abc/indexes') return reply(200, { indexes: [] });
        if (route === '/abc/keys') return reply(200, { data: [{ key: 'a' }], has_more: true, next_cursor: 'n' });
        return reply(200, { items: JSON.parse(init.body).keys.map(key => ({ key, value: 1 })) });
      };
      const client = createPortalClient({ base: BASE, token: 'tok', fetchImpl, sleep: async () => {}, budget });
      await findStore(client, CTX);
      const result = await readStore(client, CTX, 'abc');
      // 1 store list + 3 index attempts + 1 keys page + 1 batch: the cap of 6 stops the read.
      expect(fetched).to.equal(6);
      expect(budget.used).to.equal(6);
      expect(result.entries).to.have.length(1);
      expect(result.truncated).to.equal(true);
      expect(result.stoppedBy).to.equal('requests');
    });

    it('stops 429 retries inside one call at the cap', async () => {
      let fetched = 0;
      const fetchImpl = async () => {
        fetched += 1;
        return { status: 429, headers: { get: () => '0' }, json: async () => ({}) };
      };
      const client = createPortalClient({ base: BASE, token: 'tok', fetchImpl, sleep: async () => {}, budget: requestBudget(4) });
      const result = await readStore(client, CTX, 'abc');
      expect(fetched).to.equal(4);
      expect(result).to.include({ truncated: true, stoppedBy: 'requests' });
    });

    it('names kv:read on 403 and never prints a value in errors', async () => {
      const { client } = portal({ total: 1, status: { '/abc/batch-get': 403 } });
      const error = await rejection(readStore(client, CTX, 'abc'));
      expect(error.message).to.equal('QUANT_API_TOKEN lacks the kv:read scope for KV store sessions.');
    });
  });
});
