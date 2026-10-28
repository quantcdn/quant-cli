// quant serve end to end with the Orbit template API function, the local KV
// in memory and a fixed --seed-key.

import { expect } from 'chai';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveOptions, runServe } from '../../src/commands/serve.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORBIT_APP = path.join(HERE, '..', 'fixtures', 'orbit-app');
const ORBIT_DIST = path.join(HERE, '..', 'fixtures', 'orbit', 'dist');
const SEED_KEY = '5e'.repeat(32);
const ULID = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const PROJECT = { description: 'Integration', owner: 'Ada', status: 'planned', priority: 'medium', progress: 0, due: '' };

async function serve(flags = {}) {
  const options = resolveOptions(
    { dir: ORBIT_DIST, port: 0, memory: true, 'seed-key': SEED_KEY, ...flags },
    { root: ORBIT_APP, gitUserName: () => 'Ada' }
  );
  let stop;
  const stopped = new Promise((resolve) => { stop = resolve; });
  let url;
  const running = runServe(options, {
    stop: stopped,
    print: () => {},
    log: () => {},
    onListening: (server) => { url = server.url; }
  });
  await new Promise((resolve, reject) => {
    running.catch(reject);
    const check = () => (url ? resolve() : setTimeout(check, 20));
    check();
  });
  return { url, close: async () => { stop(); await running; } };
}

function client(url) {
  let cookie = '';
  return async (method, route, body, headers = {}) => {
    const res = await fetch(`${url}${route}`, {
      method,
      headers: {
        Origin: url,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers
      },
      body: body ? JSON.stringify(body) : undefined
    });
    const set = (res.headers.get('set-cookie') || '').match(/(orbit-local=[a-f0-9]{64})/);
    if (set) cookie = set[1];
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch (_err) {
      json = null;
    }
    return { status: res.status, headers: res.headers, json, text };
  };
}

const requestId = () => crypto.randomUUID();

describe('quant serve with the Orbit API (integration)', function () {
  this.timeout(30000);

  describe('indexes active', () => {
    let site;
    let call;
    let created;

    before(async () => {
      site = await serve();
      call = client(site.url);
    });

    after(async () => {
      await site.close();
    });

    it('signs in with the --seed-key access key', async () => {
      const res = await call('POST', '/api/session', { accessKey: SEED_KEY });
      expect(res.status).to.equal(200);
      const session = await call('GET', '/api/session');
      expect(session.status).to.equal(200);
      expect(session.json.user.name).to.equal('Ada');
      expect(session.json).to.have.property('settingsVersion');
    });

    it('creates a project (201) with a version', async () => {
      const res = await call('POST', '/api/projects', { ...PROJECT, name: 'Launch' }, { 'X-Request-Id': requestId() });
      expect(res.status).to.equal(201);
      created = res.json.project;
      expect(created.version).to.be.a('string').and.not.equal('');
    });

    it('gives a 26-character ULID version', () => {
      expect(created.version).to.match(ULID);
    });

    it('refuses a duplicate name (409)', async () => {
      const res = await call('POST', '/api/projects', { ...PROJECT, name: '  LAUNCH ' }, { 'X-Request-Id': requestId() });
      expect(res.status).to.equal(409);
      expect(res.json.error).to.match(/already exists/);
    });

    it('refuses a stale edit (409) with the current version', async () => {
      const edit = await call('PATCH', `/api/projects/${created.id}`, { ...PROJECT, name: 'Launch', status: 'active', version: created.version }, { 'X-Request-Id': requestId() });
      expect(edit.status).to.equal(200);
      const current = edit.json.project.version;
      expect(current).to.match(ULID).and.not.equal(created.version);
      const stale = await call('PATCH', `/api/projects/${created.id}`, { ...PROJECT, name: 'Launch', status: 'complete', version: created.version }, { 'X-Request-Id': requestId() });
      expect(stale.status).to.equal(409);
      expect(stale.json.error).to.match(/Someone else changed/);
      expect(stale.json.currentVersion).to.equal(current);
    });

    it('counts the project in the summary', async () => {
      const res = await call('GET', '/api/projects/summary');
      expect(res.status).to.equal(200);
      expect(res.json.counts.active).to.equal(1);
      expect(res.json.counts.planned).to.equal(0);
      expect(res.json.total).to.equal(1);
    });

    it('serves /app with no-store and the quant headers', async () => {
      const res = await call('GET', '/app');
      expect(res.status).to.equal(200);
      expect(res.headers.get('cache-control')).to.equal('no-store');
      expect(res.headers.get('quant-server')).to.equal('QuantCDN (quant serve)');
    });

    it('answers /nope with the _quant404 page', async () => {
      const res = await call('GET', '/nope');
      expect(res.status).to.equal(404);
      expect(res.text).to.include('Orbit 404');
      expect(res.headers.get('quant-server')).to.equal('QuantCDN (quant serve)');
    });
  });

  describe('--indexes building', () => {
    let site;

    before(async () => {
      site = await serve({ indexes: 'building' });
    });

    after(async () => {
      await site.close();
    });

    it('answers the summary with 503 while the count index builds', async () => {
      const call = client(site.url);
      expect((await call('POST', '/api/session', { accessKey: SEED_KEY })).status).to.equal(200);
      const res = await call('GET', '/api/projects/summary');
      expect(res.status).to.equal(503);
      expect(res.json.error).to.equal('The workspace is still being set up. Try again in a minute.');
    });
  });
});
