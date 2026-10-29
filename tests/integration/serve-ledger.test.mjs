// quant serve end to end with a local ledger: a function appends to the
// ledger of quant/kv-ledgers.json and reads its status, a proof and a time
// window. With --clock manual, the control route moves the time and runs the
// archive, and the archived proof verifies with the key from
// /_quant_serve/info.

import { expect } from 'chai';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyProof } from '@quantcdn/kv-ledger-conformance/verifier';
import { LIMITS } from '@quantcdn/edge-kv';
import { resolveOptions, runServe } from '../../src/commands/serve.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const LEDGER_APP = path.join(HERE, '..', 'fixtures', 'ledger-app');
const CONTROL = { 'x-quant-serve': '1', 'content-type': 'application/json' };

async function serve(flags = {}) {
  const options = resolveOptions({ dir: 'dist', port: 0, memory: true, ...flags }, { root: LEDGER_APP, gitUserName: () => 'Ada' });
  const output = [];
  let stop;
  const stopped = new Promise((resolve) => { stop = resolve; });
  let url;
  const running = runServe(options, {
    stop: stopped,
    print: (line) => output.push(line),
    log: () => {},
    onListening: (server) => { url = server.url; }
  });
  await new Promise((resolve, reject) => {
    running.catch(reject);
    const check = () => (url ? resolve() : setTimeout(check, 20));
    check();
  });
  return { url, output, close: async () => { stop(); await running; } };
}

// A raw request, so that the test can send any Host header.
function raw(url, route, { method = 'POST', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(route, url);
    const req = http.request({ hostname: target.hostname, port: target.port, path: target.pathname, method, headers }, (res) => {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

async function call(url, method, route, body, headers = {}) {
  const res = await fetch(`${url}${route}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  return { status: res.status, json: text.startsWith('{') ? JSON.parse(text) : null, text };
}

describe('quant serve with a local ledger (integration)', function () {
  this.timeout(30000);

  describe('--clock manual', () => {
    let site;

    before(async () => {
      site = await serve({ clock: 'manual' });
    });

    after(async () => {
      if (site) await site.close();
    });

    it('prints the ledgers and the manual clock at start', () => {
      const text = site.output.join('\n');
      expect(text).to.include('audit → events');
      expect(text).to.include('active after the activation delay on the manual clock');
      expect(text).to.include('Clock: manual.');
    });

    it('refuses an append before the activation time, then is ACTIVE after a clock advance', async () => {
      const early = await call(site.url, 'POST', '/api/append', { what: 'too early' });
      expect(early.json.code).to.equal('LEDGER_NOT_READY');
      expect((await call(site.url, 'GET', '/api/status')).json.state).to.equal('PENDING');
      const moved = await call(site.url, 'POST', '/_quant_serve/clock', { advanceMs: LIMITS.ledgerActivationMs }, CONTROL);
      expect(moved.status).to.equal(200);
      expect((await call(site.url, 'GET', '/api/status')).json.state).to.equal('ACTIVE');
    });

    it('appends, gives a pending proof, then an archived proof that verifies', async () => {
      const info = (await call(site.url, 'GET', '/_quant_serve/info', null, CONTROL)).json;
      expect(info.clock).to.equal('manual');
      const start = info.now;

      const appended = await call(site.url, 'POST', '/api/append?id=evt-1', { what: 'login', user: 'ada' });
      expect(appended.status).to.equal(200);
      const receipt = appended.json;
      expect(receipt).to.include({ seq: 1, ledger: 'events', at: start });

      const replay = await call(site.url, 'POST', '/api/append?id=evt-1', { what: 'login', user: 'ada' });
      expect(replay.json).to.include({ key: receipt.key, replayed: true });

      const status = (await call(site.url, 'GET', '/api/status')).json;
      expect(status).to.include({ name: 'events', state: 'ACTIVE', headSeq: 1, archivedSeq: 0 });

      const pending = await call(site.url, 'GET', `/api/proof?key=${encodeURIComponent(receipt.key)}`);
      expect(pending.json).to.deep.equal({ status: 'pending' });

      const moved = await call(site.url, 'POST', '/_quant_serve/clock', { advanceMs: 10 * 60 * 1000 }, CONTROL);
      expect(moved.json).to.deep.equal({ now: start + 10 * 60 * 1000 });
      const archived = await call(site.url, 'POST', '/_quant_serve/ledger/archive-now', { store: 'audit' }, CONTROL);
      expect(archived.json).to.deep.equal({ archived: true });

      const proof = (await call(site.url, 'GET', `/api/proof?key=${encodeURIComponent(receipt.key)}`)).json;
      expect(proof.status).to.equal('archived');
      const result = verifyProof({ proof, keys: info.publicKey });
      expect(result.steps.filter((step) => !step.ok)).to.deep.equal([]);
      expect(result.ok).to.equal(true);

      const after = (await call(site.url, 'GET', '/api/status')).json;
      expect(after).to.include({ headSeq: 1, archivedSeq: 1 });
    });

    it('lists a time window of the ledger and its chain checks out', async () => {
      const { now } = (await call(site.url, 'GET', '/_quant_serve/info', null, CONTROL)).json;
      const second = (await call(site.url, 'POST', '/api/append', { what: 'logout', user: 'ada' })).json;
      expect(second.at).to.equal(now);
      const window = (await call(site.url, 'GET', `/api/window?since=${now}&until=${now + 1}`)).json;
      expect(window.keys).to.deep.equal([second.key]);
      expect(window.chain.ok).to.equal(true);
    });
    it('archives a closed period on the clock alone, with no archive-now', async () => {
      const receipt = (await call(site.url, 'POST', '/api/append', { what: 'export' })).json;
      expect((await call(site.url, 'GET', `/api/proof?key=${encodeURIComponent(receipt.key)}`)).json).to.deep.equal({ status: 'pending' });
      const pastClose = LIMITS.archivePeriodMs + LIMITS.archiveDelayMs + 1000;
      await call(site.url, 'POST', '/_quant_serve/clock', { advanceMs: pastClose }, CONTROL);
      const proof = (await call(site.url, 'GET', `/api/proof?key=${encodeURIComponent(receipt.key)}`)).json;
      expect(proof.status).to.equal('archived');
      const { publicKey } = (await call(site.url, 'GET', '/_quant_serve/info', null, CONTROL)).json;
      expect(verifyProof({ proof, keys: publicKey }).ok).to.equal(true);
    });
  });

  describe('ledger subjects over HTTP', () => {
    let site;
    const SHRED = { reason: 'Erasure request 1', authority: 'Policy 4', requestedBy: 'Privacy officer' };

    before(async () => {
      site = await serve();
    });

    after(async () => {
      if (site) await site.close();
    });

    it('answers shred and subject-entries with the header, and refuses a foreign Host or a missing header', async () => {
      const receipt = (await call(site.url, 'POST', '/api/person', { userId: 'u-17', email: 'a@example.com' })).json;
      expect(receipt.ledger).to.equal('people');
      const entries = await call(site.url, 'POST', '/_quant_serve/ledger/subject-entries', { store: 'audit', ledger: 'people', subjectId: 'u-17' }, CONTROL);
      expect(entries.status).to.equal(200);
      expect(entries.json).to.include({ subjectState: 'live' });
      expect(entries.json.entries.map((entry) => entry.key)).to.deep.equal([receipt.key]);

      const shred = await call(site.url, 'POST', '/_quant_serve/ledger/shred', { store: 'audit', ledger: 'people', subjectId: 'u-17', ...SHRED }, CONTROL);
      expect(shred.status).to.equal(200);
      expect(shred.json.receipt.keyId).to.be.a('string');
      const read = (await call(site.url, 'GET', `/api/get?key=${encodeURIComponent(receipt.key)}`)).json;
      expect(read.value).to.deep.equal({ userId: { $shredded: true }, email: { $shredded: true } });
      const after = await call(site.url, 'POST', '/_quant_serve/ledger/subject-entries', { store: 'audit', ledger: 'people', subjectId: 'u-17' }, CONTROL);
      expect(after.json.subjectState).to.equal('shredded');

      const { port } = new URL(site.url);
      const body = JSON.stringify({ store: 'audit', ledger: 'people', subjectId: 'u-18', ...SHRED });
      for (const route of ['/_quant_serve/ledger/shred', '/_quant_serve/ledger/subject-entries']) {
        const foreign = await raw(site.url, route, { headers: { host: 'evil.example', ...CONTROL }, body });
        expect(foreign.status, route).to.equal(421);
        const bare = await raw(site.url, route, { headers: { host: `localhost:${port}`, 'content-type': 'application/json' }, body });
        expect(bare.status, route).to.equal(403);
      }
    });
  });

  describe('--clock real', () => {
    it('refuses the clock route and still archives on request', async () => {
      const site = await serve();
      try {
        const refused = await call(site.url, 'POST', '/_quant_serve/clock', { advanceMs: 1000 }, CONTROL);
        expect(refused.status).to.equal(409);
        const receipt = (await call(site.url, 'POST', '/api/append', { what: 'login' })).json;
        expect(receipt.seq).to.equal(1);
        await call(site.url, 'POST', '/_quant_serve/ledger/archive-now', { store: 'audit' }, CONTROL);
        const proof = (await call(site.url, 'GET', `/api/proof?key=${encodeURIComponent(receipt.key)}`)).json;
        expect(proof.status).to.equal('archived');
        expect(site.output.join('\n')).not.to.include('Clock:');
      } finally {
        await site.close();
      }
    });
  });
});
