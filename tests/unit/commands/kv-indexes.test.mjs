import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'node:fs';
import axios from 'axios';
import kvIndexes from '../../../src/commands/kv-indexes.js';

const TOKEN = 'tok_SECRET';
const BASE = 'https://portal.test/api/v2';
const URL = `${BASE}/organizations/org/projects/site/kv/org-site-main/indexes`;
const ARGS = { c: 'org', p: 'site', 'api-token': TOKEN, 'api-base-url': BASE };
const META = {
  kv_stores: [{ name: 'main', indexes: [
    { name: 'byCustomer', collection: 'order', fields: ['customerId'], sortBy: 'createdAt' },
    { name: 'orders', collection: 'order', fields: [], count: true }
  ] }]
};
const DEFINITIONS = {
  byCustomer: { name: 'byCustomer', collection: 'order', fields: ['customerId'], sortBy: 'createdAt' },
  orders: { name: 'orders', collection: 'order', fields: [], unique: false, count: true }
};
const live = (name, extra = {}) => ({ ...DEFINITIONS[name], slot: 1, state: 'ACTIVE', createdAt: '2026-10-16T00:00:00.000Z', ...extra });
const httpError = (status, data, headers = {}) => Object.assign(new Error('boom'), { response: { status, data, headers }, config: { headers: { Authorization: `Bearer ${TOKEN}` } } });

describe('quant kv-indexes', () => {
  let out;
  let get;
  let post;
  beforeEach(() => {
    out = [];
    sinon.stub(console, 'log').callsFake((...a) => out.push(a.join(' ')));
    sinon.stub(console, 'warn').callsFake((...a) => out.push(a.join(' ')));
    sinon.stub(fs, 'readFileSync').callsFake(path => {
      if (path === 'quant/meta.json') return JSON.stringify(META);
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    });
    get = sinon.stub(axios, 'get');
    post = sinon.stub(axios, 'post');
  });
  afterEach(() => sinon.restore());

  const run = async (args = {}) => {
    try { return { result: await kvIndexes.handler({ ...ARGS, ...args }) }; } catch (error) { return { error }; }
  };

  it('reports ready when both indexes are live, active and the same', async () => {
    get.resolves({ data: { indexes: [live('byCustomer'), live('orders')] } });
    const { result, error } = await run();
    expect(error).to.equal(undefined);
    expect(result).to.equal('KV indexes are in sync');
    expect(out).to.deep.equal(['main/byCustomer: ready', 'main/orders: ready']);
    expect(get.firstCall.args[0]).to.equal(URL);
    expect(get.firstCall.args[1].headers).to.deep.equal({ Authorization: `Bearer ${TOKEN}`, Accept: 'application/json' });
    expect(get.firstCall.args[1].maxRedirects).to.equal(0);
    expect(post.called).to.equal(false);
  });

  it('reports building and exits 0', async () => {
    get.resolves({ data: { indexes: [live('byCustomer', { state: 'BUILDING' }), live('orders')] } });
    const { error } = await run();
    expect(error).to.equal(undefined);
    expect(out[0]).to.equal('main/byCustomer: building');
  });

  it('ignores extra live fields such as state, slot and job', async () => {
    get.resolves({ data: { indexes: [live('byCustomer', { job: { phase: 'done' }, unique: false }), live('orders')] } });
    expect((await run()).error).to.equal(undefined);
  });

  it('reports conflict when the live definition differs, and fails', async () => {
    get.resolves({ data: { indexes: [live('byCustomer', { sortBy: 'other' }), live('orders')] } });
    const { error } = await run();
    expect(error.message).to.include('1 KV index is failed or in conflict');
    expect(out[0]).to.equal('main/byCustomer: conflict the live definition differs from the one in meta.json');
    expect(post.called).to.equal(false);
  });

  it('reports failed with the error code and DROPPING as failed', async () => {
    get.resolves({ data: { indexes: [live('byCustomer', { state: 'FAILED', error: 'UNIQUE_VIOLATION', conflicts: ['k1'] }), live('orders', { state: 'DROPPING' })] } });
    const { error } = await run();
    expect(error.message).to.include('2 KV indexes are failed');
    expect(out[0]).to.equal('main/byCustomer: failed the index build failed (UNIQUE_VIOLATION)');
    expect(out[1]).to.equal('main/orders: failed the index is being dropped');
    expect(out.join('\n')).not.to.include('k1');
  });

  it('declares a missing index with one POST of the normalised definition', async () => {
    get.resolves({ data: { indexes: [live('byCustomer')] } });
    post.resolves({ status: 202, data: {} });
    const { error } = await run();
    expect(error).to.equal(undefined);
    expect(post.callCount).to.equal(1);
    expect(post.firstCall.args[0]).to.equal(URL);
    expect(post.firstCall.args[1]).to.deep.equal({ name: 'orders', collection: 'order', fields: [], count: true });
    expect(out).to.deep.equal(['main/byCustomer: ready', 'main/orders: declared']);
  });

  it('counts a VALIDATION already-exists answer after a race as declared', async () => {
    get.resolves({ data: { indexes: [live('byCustomer')] } });
    post.rejects(httpError(400, { error: true, code: 'VALIDATION', message: 'Index orders already exists', retryable: false }));
    const { error } = await run();
    expect(error).to.equal(undefined);
    expect(out[1]).to.equal('main/orders: declared');
  });

  it('waits Retry-After on a 429 and retries, three tries at most', async () => {
    get.resolves({ data: { indexes: [live('byCustomer')] } });
    post.onCall(0).rejects(httpError(429, { code: 'RATE_LIMITED' }, { 'retry-after': '0' }));
    post.onCall(1).resolves({ status: 202, data: {} });
    expect((await run()).error).to.equal(undefined);
    expect(post.callCount).to.equal(2);
    post.reset();
    post.rejects(httpError(429, { code: 'RATE_LIMITED' }, { 'retry-after': '0' }));
    const { error } = await run();
    expect(post.callCount).to.equal(3);
    expect(error.message).to.include('429 RATE_LIMITED');
  });

  it('with --dry-run sends no POST and marks missing indexes', async () => {
    get.resolves({ data: { indexes: [] } });
    const { error } = await run({ 'dry-run': true });
    expect(error).to.equal(undefined);
    expect(post.called).to.equal(false);
    expect(out).to.deep.equal(['main/byCustomer: declared (dry run)', 'main/orders: declared (dry run)']);
  });

  it('prints the scope warning and exits 0 for a missing-scope 403', async () => {
    get.rejects(httpError(403, { error: true, message: 'Token does not have the required scope: kv:read', code: 'SCOPE_REQUIRED', retryable: false }));
    const { error, result } = await run();
    expect(error).to.equal(undefined);
    expect(result).to.equal(undefined);
    expect(out).to.deep.equal(['The deploy token cannot declare KV indexes (it needs the kv:read and kv:write scopes). Indexes in quant/meta.json were not declared.']);
  });

  it('treats any other 403 as an error', async () => {
    get.rejects(httpError(403, { error: true, message: 'role', code: 'PERMISSION_DENIED', retryable: false }));
    const { error } = await run();
    expect(error.message).to.include('403 PERMISSION_DENIED');
  });

  it('prints the format 2 message and fails', async () => {
    get.resolves({ data: { indexes: [] } });
    post.rejects(httpError(400, { code: 'REQUIRES_FORMAT_2', message: 'x' }));
    const { error } = await run();
    expect(error.message).to.equal('Upgrade this store to format 2 in Compute > K/V Stores, then deploy again.');
  });

  it('prints No KV indexes declared and makes no call when none are declared or the file is missing', async () => {
    fs.readFileSync.callsFake(() => JSON.stringify({ kv_stores: [{ name: 'main' }] }));
    expect((await run()).result).to.equal('No KV indexes declared');
    expect((await run({ meta: 'absent.json' })).result).to.equal('No KV indexes declared');
    fs.readFileSync.callsFake(() => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); });
    expect((await run()).result).to.equal('No KV indexes declared');
    expect(get.called).to.equal(false);
  });

  it('refuses an invalid meta.json with the file name', async () => {
    fs.readFileSync.callsFake(() => JSON.stringify({ kv_stores: [{ name: 'main', indexes: [{ name: '1bad', collection: 'a' }] }] }));
    expect((await run()).error.message).to.match(/^quant\/meta\.json: /);
  });

  it('never prints the token, config or an upstream body', async () => {
    get.resolves({ data: { indexes: [] } });
    post.rejects(httpError(500, { code: 'INTERNAL', message: 'upstream secret body' }));
    const { error } = await run();
    const text = `${out.join('\n')}\n${error.message}`;
    expect(text).not.to.include(TOKEN);
    expect(text).not.to.include('upstream secret body');
    expect(text).not.to.include('Authorization');
  });
});
