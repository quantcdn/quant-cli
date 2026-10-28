import { expect } from 'chai';
import sinon from 'sinon';
import dns from 'node:dns';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createExecutor,
  authContinueHeaders,
  readCappedBody,
  resetFetchWarning,
  MAX_REQUEST_BODY_BYTES
} from '../../../src/serve/functions.js';
import { EDGE_LIBRARIES, loadProjectLibraries } from '../../../src/serve/edge-libraries.js';
import { kvDouble } from '../../helpers/kv-double.mjs';
import { openLocalKv } from '../../../src/serve/kv/wire.js';

const LIB_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'libs');
const AUTH_MESSAGE = 'Invalid edge_auth function response: expected Response object';
const FILTER_MESSAGE = 'Edge filter must define a contentFilter class';
const FETCH_WARNING = 'This fetch goes to a private address; the Quant edge refuses it.';
const ORIGIN = 'http://localhost:4000';

let dir;
let counter = 0;
let lines;

function writeFn(body, uuid = `fn-${++counter}`) {
  const file = path.join(dir, `${uuid}.js`);
  fs.writeFileSync(file, body);
  return { uuid, path: file };
}

function request(over = {}) {
  return { url: `${ORIGIN}/api/thing?x=1`, method: 'GET', headers: {}, body: null, clientAddress: '127.0.0.1', ...over };
}

function executor(over = {}) {
  return createExecutor({ kvStore: kvDouble({ 'store/k': 'v' }), org: 'acme', project: 'site', root: LIB_ROOT, log: (line) => lines.push(line), ...over });
}

describe('serve functions', () => {
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-fn-'));
    lines = [];
    resetFetchWarning();
  });

  afterEach(() => {
    sinon.restore();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('exports the 10 MB request body cap', () => {
    expect(MAX_REQUEST_BODY_BYTES).to.equal(10 * 1024 * 1024);
  });

  it('builds the event with method, headers and body', async () => {
    const fn = writeFn(`
      const body = await event.request.text();
      return Response.json({ method: event.request.method, header: event.request.headers.get('x-test'), body });
    `);
    const res = await executor().run(fn, request({ method: 'POST', headers: { 'x-test': 'yes' }, body: Buffer.from('hello') }));
    expect(res.status).to.equal(200);
    expect(await res.json()).to.deep.equal({ method: 'POST', header: 'yes', body: 'hello' });
  });

  it('sets event.url to the public host and /fn/<uuid>, with org, project, meta, client and geo', async () => {
    const fn = writeFn(`
      return Response.json({
        host: event.url.host, pathname: event.url.pathname, search: event.url.search,
        requestUrl: event.request.url, org: event.quantOrg, project: event.quantProject, meta: event.meta,
        client: event.client.address, city: event.geo.city, country: event.geo.country_code,
        lookup: getGeolocationForIpAddress('1.2.3.4').country_code,
        kv: await kvStore.get('store', 'k'), same: kvStore === KVStore
      });
    `, 'abc-123');
    const res = await executor({ clientIp: '203.0.113.9' }).run(fn, request());
    expect(await res.json()).to.deep.equal({
      host: 'localhost:4000', pathname: '/fn/abc-123', search: '?x=1', requestUrl: `${ORIGIN}/api/thing?x=1`,
      org: 'acme', project: 'site', meta: { uuid: 'abc-123', type: 'edge_function' }, client: '203.0.113.9',
      city: 'Sydney', country: 'AU', lookup: 'AU', kv: 'v', same: true
    });
  });

  it('passes option objects from the function to the local KV', async () => {
    const stores = [{ name: 'orbit', indexes: [{ name: 'byStatus', collection: 'item', fields: ['status'], count: true }], initialValues: [] }];
    const { kvStore } = await openLocalKv({ root: dir, org: 'acme', project: 'site', stores, memory: true });
    const fn = writeFn(`
      const id = 'acme-site-orbit';
      const created = await kvStore.set(id, 'item:1', { status: 'open' }, { ifAbsent: true });
      const store = kvStore.open(id);
      const keys = [];
      for await (const item of store.list({ prefix: 'item:' }).items({ maxPages: 2 })) keys.push(item.key);
      let code = null;
      try {
        await store.set('item:1', { status: 'open' }, { ifAbsent: true });
      } catch (err) {
        code = err instanceof kvStore.KVError ? err.code : 'not a KVError';
      }
      const count = await store.count({ index: 'byStatus', equals: { status: 'open' } });
      return Response.json({ version: typeof created.version, keys, code, count, same: kvStore === KVStore });
    `);
    const res = await executor({ kvStore }).run(fn, request());
    expect(res.status, lines.join('\n')).to.equal(200);
    expect(await res.json()).to.deep.equal({ version: 'string', keys: ['item:1'], code: 'CONFLICT', count: 1, same: true });
  });

  it('round-trips a value object from the sandbox through set, get and list', async () => {
    const stores = [{ name: 'orbit', indexes: [], initialValues: [] }];
    const { kvStore } = await openLocalKv({ root: dir, org: 'acme', project: 'site', stores, memory: true });
    const fn = writeFn(`
      const id = 'acme-site-orbit';
      const value = { name: 'Launch', owner: { name: 'Ada', tags: ['a', 'b'] }, ...JSON.parse('{"__proto__": {"x": 1}}') };
      const result = await kvStore.set(id, 'item:1', value, { ifAbsent: true });
      const got = await kvStore.get(id, 'item:1');
      const page = await kvStore.list(id, { prefix: 'item:', includeValues: true });
      return Response.json({
        version: result.version, got: JSON.stringify(got), listed: JSON.stringify(page.items[0].value),
        protoKey: Object.keys(got).includes('__proto__')
      });
    `);
    const res = await executor({ kvStore }).run(fn, request());
    expect(res.status, lines.join('\n')).to.equal(200);
    const body = await res.json();
    const stored = '{"name":"Launch","owner":{"name":"Ada","tags":["a","b"]},"__proto__":{"x":1}}';
    expect(body.version).to.match(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(body.got).to.equal(stored);
    expect(body.listed).to.equal(stored);
    expect(body.protoKey).to.equal(true);
  });

  it('uses the socket address as client.address and lets --geo override the stub', async () => {
    const fn = writeFn('return Response.json({ client: event.client.address, city: event.geo.city, country: event.geo.country_code });');
    const res = await executor({ geo: { city: 'Auckland', country_code: 'NZ' } }).run(fn, request({ clientAddress: '192.0.2.4' }));
    expect(await res.json()).to.deep.equal({ client: '192.0.2.4', city: 'Auckland', country: 'NZ' });
  });

  it('hides Node globals and sets window to globalThis', async () => {
    const fn = writeFn(`
      return Response.json({
        process: typeof process, require: typeof require, module: typeof module, exports: typeof exports,
        dirname: typeof __dirname, filename: typeof __filename, sab: typeof SharedArrayBuffer, atomics: typeof Atomics,
        window: window === globalThis, fifo: isFifoExecution, uuid4: typeof uuidv4(), uuid7: uuidv7().charAt(14),
        web: [typeof fetch, typeof crypto.subtle, typeof TransformStream, typeof Buffer, typeof structuredClone]
      });
    `);
    const res = await executor().run(fn, request());
    expect(await res.json()).to.deep.equal({
      process: 'undefined', require: 'undefined', module: 'undefined', exports: 'undefined',
      dirname: 'undefined', filename: 'undefined', sab: 'undefined', atomics: 'undefined',
      window: true, fifo: false, uuid4: 'string', uuid7: '7',
      web: ['function', 'object', 'function', 'function', 'function']
    });
  });

  it('runs the body in strict mode', async () => {
    const fn = writeFn('return new Response(String((function () { return this; })()));');
    const res = await executor().run(fn, request());
    expect(await res.text()).to.equal('undefined');
  });

  describe('edge libraries', () => {
    it('lists every edge global once', () => {
      const names = EDGE_LIBRARIES.map((lib) => lib.global);
      expect(new Set(names).size).to.equal(names.length);
      expect(EDGE_LIBRARIES.find((lib) => lib.global === 'jwt').package).to.equal('jsonwebtoken');
      expect(EDGE_LIBRARIES.find((lib) => lib.global === 'QuantClient').package).to.equal(null);
    });

    it('takes jose from the project node_modules and stubs Stripe', async () => {
      const { globals, fromProject } = await loadProjectLibraries(LIB_ROOT);
      expect(fromProject).to.deep.equal(['jose']);
      expect(globals.jose.marker).to.equal(true);
      expect(() => new globals.Stripe('sk')).to.throw('Stripe is available on the Quant edge but not in quant serve');
      expect(() => globals.awsSes.send).to.throw('awsSes is available on the Quant edge but not in quant serve');
    });

    it('reports a project package that cannot be imported, and stubs it', async () => {
      const root = fs.mkdtempSync(path.join(dir, 'broken-'));
      fs.mkdirSync(path.join(root, 'node_modules', 'jose'), { recursive: true });
      fs.writeFileSync(path.join(root, 'node_modules', 'jose', 'package.json'), JSON.stringify({ name: 'jose', type: 'module', exports: './index.js' }));
      fs.writeFileSync(path.join(root, 'node_modules', 'jose', 'index.js'), "throw new Error('needs a newer node');");
      const { globals, fromProject, errors } = await loadProjectLibraries(root);
      expect(fromProject).to.deep.equal([]);
      expect(errors).to.deep.equal(['The project package jose could not be imported (needs a newer node). Functions get the jose stub.']);
      expect(() => globals.jose.SignJWT).to.throw('jose is available on the Quant edge but not in quant serve');
    });

    it('gives the function the project export and the stub', async () => {
      const ok = writeFn('return new Response(String(jose.marker));');
      expect(await (await executor().run(ok, request())).text()).to.equal('true');
      const stub = writeFn('const s = new Stripe("sk"); return new Response("no");');
      const res = await executor().run(stub, request());
      expect(res.status).to.equal(500);
      expect(lines.join('\n')).to.include('Stripe is available on the Quant edge but not in quant serve');
    });
  });

  describe('timers', () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    it('clears the timers of a function when its response is ready', async () => {
      const fn = writeFn("setInterval(() => quantLog('tick'), 10); setTimeout(() => quantLog('late'), 30); return new Response('ok');");
      const res = await executor().run(fn, request());
      expect(await res.text()).to.equal('ok');
      await sleep(80);
      expect(lines.filter((line) => line.includes('tick') || line.includes('late'))).to.deep.equal([]);
    });

    it('clears the timers of a function when its time budget ends', async () => {
      const fn = writeFn("setInterval(() => quantLog('tick'), 10); await new Promise(() => {});");
      const res = await executor({ timeoutMs: 50 }).run(fn, request());
      expect(res.status).to.equal(500);
      const ticks = lines.filter((line) => line.includes('tick')).length;
      await sleep(60);
      expect(lines.filter((line) => line.includes('tick')).length).to.equal(ticks);
    });

    it('keeps clearTimeout working inside a function', async () => {
      const fn = writeFn("const t = setTimeout(() => quantLog('never'), 5); clearTimeout(t); await new Promise((r) => setTimeout(r, 20)); return new Response('ok');");
      expect(await (await executor().run(fn, request())).text()).to.equal('ok');
      expect(lines).to.deep.equal([]);
    });
  });

  describe('realm', () => {
    it('gives a library from the project the values a function makes', async () => {
      const fn = writeFn(`
        const length = jose.keyLength(new Uint8Array(32));
        const checks = jose.realmChecks({
          arrayBuffer: new ArrayBuffer(8), dataView: new DataView(new ArrayBuffer(8)), float64: new Float64Array(2),
          bigInt64: new BigInt64Array(1), typeError: new TypeError('x'), encoded: new TextEncoder().encode('x')
        });
        return Response.json({ length, checks, fromLibrary: jose.hostBytes() instanceof Uint8Array });`);
      const res = await executor().run(fn, request());
      expect(lines).to.deep.equal([]);
      expect(await res.json()).to.deep.equal({
        length: 32,
        checks: { arrayBuffer: true, dataView: true, float64: true, bigInt64: true, typeError: true, encoded: true },
        fromLibrary: true
      });
    });
  });

  describe('errors', () => {
    it('answers a thrown error with the edge 500 and logs the message', async () => {
      const fn = writeFn('throw new Error("boom");');
      const res = await executor().run(fn, request());
      expect(res.status).to.equal(500);
      expect(await res.text()).to.equal('');
      expect(lines.join('\n')).to.include('boom');
    });

    it('times out a function that never settles', async () => {
      const exec = executor({ timeoutMs: 50 });
      const hung = writeFn('await new Promise(() => {}); return new Response("late");');
      const res = await exec.run(hung, request());
      expect(res.status).to.equal(500);
      expect(lines.join('\n')).to.include('Edge function exceeded its time budget');
      const next = writeFn('return new Response("ok");');
      const ok = await exec.run(next, request());
      expect(ok.status).to.equal(200);
      expect(await ok.text()).to.equal('ok');
    });

    it('logs a throw in a timer callback, keeps the process alive and serves the next run', async () => {
      const exec = executor();
      const fn = writeFn(`
        setTimeout(() => { throw new Error('late'); }, 5);
        setInterval(function tick() { clearInterval(this); throw new Error('tick'); }, 5);
        setTimeout(async () => { throw new Error('async late'); }, 5);
        queueMicrotask(() => { throw new Error('micro'); });
        await new Promise((resolve) => setTimeout(resolve, 30));
        return new Response('ok');
      `, 'timer-fn');
      const res = await exec.run(fn, request());
      expect(res.status).to.equal(200);
      expect(await res.text()).to.equal('ok');
      for (const message of ['late', 'tick', 'async late', 'micro']) {
        expect(lines).to.include(`Edge function timer-fn failed: ${message}`);
      }
      const next = await exec.run(writeFn('return new Response("next");'), request());
      expect(await next.text()).to.equal('next');
    });

    it('passes timer arguments and keeps clearTimeout working', async () => {
      const fn = writeFn(`
        const value = await new Promise((resolve) => setTimeout((a, b) => resolve(a + b), 1, 'x', 'y'));
        let fired = false;
        clearTimeout(setTimeout(() => { fired = true; }, 1));
        await new Promise((resolve) => setTimeout(resolve, 10));
        return new Response(value + String(fired));
      `);
      expect(await (await executor().run(fn, request())).text()).to.equal('xyfalse');
    });

    it('stops a synchronous loop', async () => {
      const fn = writeFn('while (true) {}');
      const res = await executor({ timeoutMs: 50 }).run(fn, request());
      expect(res.status).to.equal(500);
      expect(lines.join('\n')).to.include('Script execution timed out');
    });

    it('returns a non-Response value as a 200 body, as the edge does', async () => {
      const fn = writeFn('return "plain";');
      const res = await executor().run(fn, request());
      expect(res.status).to.equal(200);
      expect(await res.text()).to.equal('plain');
    });
  });

  describe('request body', () => {
    it('drops an over-cap body', async () => {
      const fn = writeFn('const t = await event.request.text(); return new Response(String(t.length));');
      const res = await executor().run(fn, request({ method: 'POST', body: Buffer.alloc(MAX_REQUEST_BODY_BYTES + 1, 97) }));
      expect(res.status).to.equal(200);
      expect(await res.text()).to.equal('0');
    });

    it('reads a stream up to the cap and gives null past it', async () => {
      async function* chunks(sizes) {
        for (const n of sizes) yield Buffer.alloc(n, 98);
      }
      expect((await readCappedBody(chunks([3, 4]))).byteLength).to.equal(7);
      expect(await readCappedBody(chunks([MAX_REQUEST_BODY_BYTES, 1]))).to.equal(null);
      expect(await readCappedBody(chunks([]))).to.equal(null);
    });
  });

  describe('response headers', () => {
    it('merges set-cookie as a group, keeps protected headers and defaults cache-control', async () => {
      const fn = writeFn(`
        const h = new Headers({ 'x-fn': 'f', 'quant-server': 'spoof' });
        h.append('set-cookie', 'a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT');
        h.append('set-cookie', 'b=2');
        return new Response('hi', { status: 202, headers: h });
      `);
      const base = new Headers({ 'quant-server': 'QuantCDN (quant serve)', 'x-base': 'b' });
      base.append('set-cookie', 'base=0');
      const res = await executor().run(fn, request({ baseHeaders: base }));
      expect(res.status).to.equal(202);
      expect(res.headers.getSetCookie()).to.deep.equal(['a=1; Expires=Wed, 21 Oct 2026 07:28:00 GMT', 'b=2']);
      expect(res.headers.get('quant-server')).to.equal('QuantCDN (quant serve)');
      expect(res.headers.get('x-base')).to.equal('b');
      expect(res.headers.get('x-fn')).to.equal('f');
      expect(res.headers.get('cache-control')).to.equal('private, max-age=0');
    });

    it('keeps a cache-control the function sets', async () => {
      const fn = writeFn('return new Response("hi", { headers: { "cache-control": "public, max-age=60" } });');
      const res = await executor().run(fn, request());
      expect(res.headers.get('cache-control')).to.equal('public, max-age=60');
    });
  });

  describe('auth mode', () => {
    it('lets a 201 continue with its headers but not content-type', async () => {
      const fn = writeFn(`
        const h = new Headers({ 'content-type': 'text/plain', 'x-user': 'ann' });
        h.append('set-cookie', 's=1');
        return new Response(null, { status: 201, headers: h });
      `);
      const res = await executor().run(fn, request({ mode: 'auth' }));
      expect(res.status).to.equal(201);
      const headers = authContinueHeaders(res);
      expect(headers.has('content-type')).to.equal(false);
      expect(headers.get('x-user')).to.equal('ann');
      expect(headers.getSetCookie()).to.deep.equal(['s=1']);
      expect(headers.get('cache-control')).to.equal('private, max-age=0');
    });

    it('gives the meta type edge_auth and the request URL as event.url', async () => {
      const fn = writeFn('return Response.json({ type: event.meta.type, path: event.url.pathname }, { status: 403 });');
      const res = await executor().run(fn, request({ mode: 'auth' }));
      expect(res.status).to.equal(403);
      expect(await res.json()).to.deep.equal({ type: 'edge_auth', path: '/api/thing' });
    });

    it('refuses a non-Response with the exact message', async () => {
      const fn = writeFn('return "yes";');
      const res = await executor().run(fn, request({ mode: 'auth' }));
      expect(res.status).to.equal(500);
      expect(lines.join('\n')).to.include(AUTH_MESSAGE);
    });
  });

  describe('filter mode', () => {
    const html = () => new Response('<p>example</p>', { headers: { 'content-type': 'text/html', 'content-length': '14' } });

    it('transforms the HTML body and the response headers', async () => {
      const fn = writeFn(`
        class contentFilter extends TransformStream {
          constructor(event, responseHeaders) {
            responseHeaders.set('x-filtered', event.request.method);
            super({ transform: (chunk, controller) => {
              controller.enqueue(new TextEncoder().encode(new TextDecoder().decode(chunk).replace('example', 'test case')));
            } });
          }
        }
      `);
      const res = await executor().run(fn, request({ mode: 'filter', response: html() }));
      expect(res.status).to.equal(200);
      expect(await res.text()).to.equal('<p>test case</p>');
      expect(res.headers.get('x-filtered')).to.equal('GET');
      expect(res.headers.has('content-length')).to.equal(false);
    });

    it('refuses a body without contentFilter with the exact message', async () => {
      const fn = writeFn('const x = 1;');
      const res = await executor().run(fn, request({ mode: 'filter', response: html() }));
      expect(res.status).to.equal(500);
      expect(lines.join('\n')).to.include(FILTER_MESSAGE);
    });
  });

  it('re-reads the body when its mtime changes', async () => {
    const fn = writeFn('return new Response("one");');
    const exec = executor();
    expect(await (await exec.run(fn, request())).text()).to.equal('one');
    fs.writeFileSync(fn.path, 'return new Response("two");');
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(fn.path, later, later);
    expect(await (await exec.run(fn, request())).text()).to.equal('two');
  });

  it('prints the private-address fetch warning once', async () => {
    const fetchStub = sinon.stub(globalThis, 'fetch').callsFake(async () => new Response('upstream'));
    sinon.stub(dns.promises, 'lookup').resolves([{ address: '10.0.0.5', family: 4 }]);
    const fn = writeFn(`
      await fetch('http://internal.test/a');
      await fetch(new Request('http://internal.test/b'));
      await fetch('http://[::1]:8080/c');
      return new Response('done');
    `);
    const res = await executor().run(fn, request());
    expect(await res.text()).to.equal('done');
    await executor().run(fn, request());
    expect(fetchStub.callCount).to.equal(6);
    expect(lines.filter((line) => line === FETCH_WARNING)).to.have.length(1);
  });

  it('prints no warning for a public address', async () => {
    sinon.stub(globalThis, 'fetch').callsFake(async () => new Response('upstream'));
    sinon.stub(dns.promises, 'lookup').resolves([{ address: '93.184.215.14', family: 4 }]);
    const fn = writeFn('await fetch("https://example.com/"); return new Response("done");');
    await executor().run(fn, request());
    expect(lines).to.not.include(FETCH_WARNING);
  });
});
