import { expect } from 'chai';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../../src/serve/server.js';
import { controlRoutes, isControlPath } from '../../../src/serve/control.js';
import { loadProject } from '../../../src/serve/project.js';
import { MAX_REQUEST_BODY_BYTES } from '../../../src/serve/functions.js';
import { openLocalKv } from '../../../src/serve/kv/wire.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORBIT = path.join(HERE, '..', '..', 'fixtures', 'orbit');
const LIB_ROOT = path.join(HERE, '..', '..', 'fixtures', 'libs');
const ORBIT_FN = '43aec1f0-095b-4a76-a9c8-934bf3d49d59';
const AUTH_FN = 'b7a6f0c2-1d3e-4f5a-8b9c-0d1e2f3a4b5c';
const FILTER_FN = 'c8b7a1d3-2e4f-4a6b-9c0d-1e2f3a4b5c6d';
const MISSING_FN = 'd9c8b2e4-3f5a-4b7c-8d1e-2f3a4b5c6d7e';
const SETTINGS = { name: 'My workspace' };

let servers;
let lines;
let tmp;

// The Orbit store in memory, with the settings that the Orbit stub reads.
async function orbitKv() {
  const stores = loadProject({ root: ORBIT }).stores;
  const { kvStore } = await openLocalKv({ root: ORBIT, org: 'acme', project: 'site', stores, memory: true });
  await kvStore.set('acme-site-orbit', 'workspace:studio:settings', SETTINGS);
  return kvStore;
}

async function start(over = {}) {
  const server = await startServer({
    root: ORBIT, dir: 'dist', port: 0, host: '127.0.0.1', org: 'acme', project: 'site',
    kvStore: await orbitKv(),
    log: (line) => lines.push(line),
    ...over
  });
  servers.push(server);
  return server;
}

function expectQuantHeaders(res, org = 'acme', project = 'site') {
  expect(res.headers.get('quant-server')).to.equal('QuantCDN (quant serve)');
  expect(res.headers.get('x-quant-org')).to.equal(org);
  expect(res.headers.get('x-quant-project')).to.equal(project);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

// A project in a temporary directory with the given function bodies and rules.
function tempProject({ functions = [], rules = [], files = {} }) {
  const root = fs.mkdtempSync(path.join(tmp, 'project-'));
  const manifest = functions.map((fn) => {
    const file = `quant/edge-functions/${fn.id}.js`;
    fs.mkdirSync(path.join(root, 'quant', 'edge-functions'), { recursive: true });
    fs.writeFileSync(path.join(root, file), fn.body);
    return { id: fn.id, uuid: fn.uuid, type: fn.type || 'function', path: file, description: fn.id };
  });
  writeJson(path.join(root, 'quant', 'edge-functions.json'), manifest);
  writeJson(path.join(root, 'quant', 'edge-rules.json'), { version: 1, namespace: 'test', rules });
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, 'dist', name)), { recursive: true });
    fs.writeFileSync(path.join(root, 'dist', name), body);
  }
  return root;
}

function rule(id, type, urls, fnUuid, extra = {}) {
  return { id, name: id, type, urls, weight: 0, function_uuid: fnUuid, ...extra };
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.closeAllConnections?.();
    server.close(() => resolve());
  });
}

function waitFor(check, timeoutMs = 3000) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (await check()) return resolve();
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out'));
      setTimeout(tick, 50);
    };
    tick();
  });
}

// A GET with the path exactly as given (fetch and URL do not change it).
function rawGet(url, rawPath, headers = {}) {
  const { port } = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: Number(port), path: rawPath, method: 'GET', headers }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

function rawRequest(url, head) {
  const { port } = new URL(url);
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(port), '127.0.0.1', () => socket.write(head));
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk;
      if (data.includes('echo:hello')) {
        socket.destroy();
        resolve(data);
      }
    });
    socket.on('error', reject);
    socket.on('close', () => resolve(data));
  });
}

describe('serve server', () => {
  beforeEach(() => {
    servers = [];
    lines = [];
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-server-'));
  });

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('functions', () => {
    it('runs the Orbit-shaped function for a function rule', async () => {
      const server = await start();
      const res = await fetch(`${server.url}/api/workspace`, { headers: { 'quant-client-ip': '6.6.6.6' } });
      expect(res.status).to.equal(200);
      expect(res.headers.get('content-type')).to.equal('application/json');
      expectQuantHeaders(res);
      expect(await res.json()).to.deep.equal({
        store: 'acme-site-orbit',
        settings: SETTINGS,
        functionPath: `/fn/${ORBIT_FN}`,
        clientIp: '127.0.0.1'
      });
    });

    it('gives the function the --client-ip value as quant-client-ip', async () => {
      const server = await start({ clientIp: '203.0.113.7' });
      const res = await fetch(`${server.url}/api/workspace`);
      expect((await res.json()).clientIp).to.equal('203.0.113.7');
    });

    it('sets the quant headers after the function headers', async () => {
      const root = tempProject({
        functions: [{ id: 'spoof', uuid: ORBIT_FN, body: `return new Response('x', { headers: {
          'quant-server': 'spoof', 'x-quant-org': 'spoof', 'x-quant-project': 'spoof', 'x-own': 'kept' } });` }],
        rules: [rule('spoof', 'function', ['/spoof'], ORBIT_FN)]
      });
      const server = await start({ root });
      const res = await fetch(`${server.url}/spoof`);
      expectQuantHeaders(res);
      expect(res.headers.get('x-own')).to.equal('kept');
    });

    it('logs a floating rejection and keeps serving', async () => {
      const root = tempProject({
        functions: [{ id: 'floating', uuid: ORBIT_FN, body: 'Promise.reject(new Error(\'floating\')); return new Response(\'ok\');' }],
        rules: [rule('floating', 'function', ['/floating'], ORBIT_FN)]
      });
      const before = process.listenerCount('unhandledRejection');
      const server = await start({ root });
      const first = await fetch(`${server.url}/floating`);
      expect(first.status).to.equal(200);
      expect(await first.text()).to.equal('ok');
      await waitFor(() => lines.some((line) => line.includes('floating')));
      const second = await fetch(`${server.url}/floating`);
      expect(second.status).to.equal(200);
      await server.close();
      expect(process.listenerCount('unhandledRejection')).to.equal(before);
    });

    it('gives a function an empty body for a body over the cap, and keeps serving', async () => {
      const root = tempProject({
        functions: [{ id: 'echo', uuid: ORBIT_FN, body: 'const body = await event.request.text(); return Response.json({ length: body.length });' }],
        rules: [rule('echo', 'function', ['/echo'], ORBIT_FN)]
      });
      const server = await start({ root });
      const big = await fetch(`${server.url}/echo`, { method: 'POST', body: Buffer.alloc(MAX_REQUEST_BODY_BYTES + 1, 97) });
      expect(big.status).to.equal(200);
      expect(await big.json()).to.deep.equal({ length: 0 });
      const small = await fetch(`${server.url}/echo`, { method: 'POST', body: 'hello' });
      expect(await small.json()).to.deep.equal({ length: 5 });
    });

    it('lists the edge libraries that come from the project', async () => {
      const server = await start({ root: LIB_ROOT, dir: '.' });
      expect(server.summary.libraries).to.deep.equal(['jose']);
    });
  });

  describe('auth and filter rules', () => {
    it('continues after a 201 from an auth function and keeps its headers', async () => {
      const root = tempProject({
        functions: [{ id: 'gate', uuid: AUTH_FN, type: 'auth', body: 'return new Response(null, { status: 201, headers: { \'x-user\': \'ann\', \'content-type\': \'text/plain\' } });' }],
        rules: [rule('gate', 'auth', ['/*'], AUTH_FN)],
        files: { 'page.json': '{"a":1}' }
      });
      const server = await start({ root });
      const res = await fetch(`${server.url}/page.json`);
      expect(res.status).to.equal(200);
      expect(res.headers.get('x-user')).to.equal('ann');
      expect(res.headers.get('content-type')).to.equal('application/json');
      expect(res.headers.get('cache-control')).to.equal('private, max-age=0');
      expectQuantHeaders(res);
    });

    it('an auth rule covers each spelling of a path that the static lookup serves', async () => {
      const root = tempProject({
        functions: [{ id: 'gate', uuid: AUTH_FN, type: 'auth', body: 'return new Response(\'no\', { status: 401 });' }],
        rules: [rule('gate', 'auth', ['/admin/*'], AUTH_FN)],
        files: { 'admin/secret/index.html': 'secret' }
      });
      const server = await start({ root });
      const spellings = ['/admin/secret', '/%61dmin/secret', '/adm%69n/secret', '/%41DMIN/secret',
        '//admin/secret', '/admin//secret', '///admin///secret/', '/admin/secret/index.html'];
      for (const spelling of spellings) {
        const res = await rawGet(server.url, spelling);
        expect(res.status, spelling).to.equal(401);
      }
    });

    it('answers 400 for an encoded slash or backslash in the path', async () => {
      const root = tempProject({
        functions: [{ id: 'gate', uuid: AUTH_FN, type: 'auth', body: 'return new Response(\'no\', { status: 401 });' }],
        rules: [rule('gate', 'auth', ['/admin/*'], AUTH_FN)],
        files: { 'admin/secret/index.html': 'secret' }
      });
      const server = await start({ root });
      for (const spelling of ['/admin%2Fsecret', '/admin%2fsecret', '%2Fadmin/secret', '/admin%5Csecret', '/admin%5csecret']) {
        const res = await rawGet(server.url, spelling.startsWith('/') ? spelling : `/${spelling}`);
        expect(res.status, spelling).to.equal(400);
        expect(res.body).to.not.include('secret');
      }
    });

    it('keeps the query string as sent for a query-pattern rule', async () => {
      const root = tempProject({
        functions: [{ id: 'q', uuid: ORBIT_FN, body: 'return new Response(\'query rule\');' }],
        rules: [rule('q', 'function', ['/search?q=a%20b'], ORBIT_FN)],
        files: { 'index.html': 'home' }
      });
      const server = await start({ root });
      expect((await rawGet(server.url, '/search?q=a%20b')).body).to.equal('query rule');
    });

    it('returns 503 when an auth rule names a missing function', async () => {
      const root = tempProject({ rules: [rule('gate', 'auth', ['/*'], MISSING_FN)], files: { 'index.html': 'home' } });
      const server = await start({ root });
      const res = await fetch(`${server.url}/index.html`);
      expect(res.status).to.equal(503);
      expect(await res.text()).to.equal('Authentication for this page is not available.');
      expect(res.headers.get('cache-control')).to.equal('no-store');
      expectQuantHeaders(res);
    });

    it('runs a function rule after an auth 201, with the auth headers', async () => {
      const root = tempProject({
        functions: [
          { id: 'gate', uuid: AUTH_FN, type: 'auth', body: 'return new Response(null, { status: 201, headers: { \'x-user\': \'ann\' } });' },
          { id: 'api', uuid: ORBIT_FN, body: 'return new Response(\'from function\');' }
        ],
        rules: [rule('gate', 'auth', ['/api/*'], AUTH_FN, { weight: 1 }), rule('api', 'function', ['/api/*'], ORBIT_FN, { weight: 2 })]
      });
      const server = await start({ root });
      const res = await fetch(`${server.url}/api/thing`);
      expect(res.status).to.equal(200);
      expect(await res.text()).to.equal('from function');
      expect(res.headers.get('x-user')).to.equal('ann');
      expectQuantHeaders(res);
    });

    it('runs an auth chain in order and returns the response of an auth that denies', async () => {
      const second = 'e1d2c3b4-a596-4877-8695-a4b3c2d1e0f9';
      const root = tempProject({
        functions: [
          { id: 'first', uuid: AUTH_FN, type: 'auth', body: 'return new Response(null, { status: 201, headers: { \'x-first\': \'yes\' } });' },
          { id: 'second', uuid: second, type: 'auth', body: 'return new Response(\'denied\', { status: 403 });' },
          { id: 'api', uuid: ORBIT_FN, body: 'return new Response(\'from function\');' }
        ],
        rules: [
          rule('first', 'auth', ['/*'], AUTH_FN, { weight: 1 }),
          rule('second', 'auth', ['/*'], second, { weight: 2 }),
          rule('api', 'function', ['/*'], ORBIT_FN, { weight: 3 })
        ]
      });
      const server = await start({ root });
      const res = await fetch(`${server.url}/page`);
      expect(res.status).to.equal(403);
      expect(await res.text()).to.equal('denied');
      expect(res.headers.get('x-first')).to.equal('yes');
      expectQuantHeaders(res);
    });

    it('applies a filter rule to text/html responses only', async () => {
      const root = tempProject({
        functions: [{ id: 'shout', uuid: FILTER_FN, type: 'filter', body: `class contentFilter extends TransformStream {
          constructor() { super({ transform(chunk, c) { c.enqueue(new TextEncoder().encode(new TextDecoder().decode(chunk).toUpperCase())); } }); }
        }` }],
        rules: [rule('shout', 'filter', ['/*'], FILTER_FN)],
        files: { 'index.html': '<p>hello</p>', 'data.json': '{"a":"hello"}' }
      });
      const server = await start({ root });
      expect(await (await fetch(`${server.url}/index.html`)).text()).to.equal('<P>HELLO</P>');
      expect(await (await fetch(`${server.url}/data.json`)).text()).to.equal('{"a":"hello"}');
      const missing = await fetch(`${server.url}/nope`);
      expect(await missing.text()).to.include('404');
    });

    it('skips a filter rule with a missing function, with one warning', async () => {
      const root = tempProject({ rules: [rule('shout', 'filter', ['/*'], MISSING_FN)], files: { 'index.html': '<p>hello</p>' } });
      const server = await start({ root });
      expect(server.summary.warnings.filter((line) => line.includes(MISSING_FN))).to.have.length(1);
      expect(await (await fetch(`${server.url}/index.html`)).text()).to.equal('<p>hello</p>');
      expect(await (await fetch(`${server.url}/index.html`)).text()).to.equal('<p>hello</p>');
      expect(lines.filter((line) => line.includes(MISSING_FN))).to.have.length(0);
    });
  });

  describe('static and 404', () => {
    it('serves a static page with no-store and the quant headers', async () => {
      const server = await start();
      for (const pathname of ['/app', '/app/', '/APP']) {
        const res = await fetch(`${server.url}${pathname}`);
        expect(res.status).to.equal(200);
        expect(res.headers.get('content-type')).to.match(/^text\/html/);
        expect(res.headers.get('cache-control')).to.equal('no-store');
        expectQuantHeaders(res);
        expect(await res.text()).to.include('Orbit app');
      }
    });

    it('answers HEAD without a body', async () => {
      const server = await start();
      const res = await fetch(`${server.url}/app`, { method: 'HEAD' });
      expect(res.status).to.equal(200);
      expect(await res.text()).to.equal('');
    });

    it('serves _quant404 with status 404, no-store and the quant headers', async () => {
      const server = await start();
      const res = await fetch(`${server.url}/nope`);
      expect(res.status).to.equal(404);
      expect(res.headers.get('cache-control')).to.equal('no-store');
      expectQuantHeaders(res);
      expect(await res.text()).to.include('Orbit 404');
    });

    it('prints the _quant404 warning once per process', async () => {
      const root = tempProject({ files: { '404.html': 'missing' } });
      const server = await start({ root });
      await (await fetch(`${server.url}/a`)).text();
      await (await fetch(`${server.url}/b`)).text();
      const warning = 'Production serves /_quant404. Copy 404.html to _quant404/index.html in your deploy step.';
      expect(lines.filter((line) => line === warning)).to.have.length(1);
    });

    it('does not serve project files, dotfiles or node_modules when the site is the project root', async () => {
      const root = fs.mkdtempSync(path.join(tmp, 'root-'));
      const files = {
        'quant.json': '{"token":"secret"}',
        'quant/edge-functions/x.js': 'secret',
        '.env': 'SECRET=1',
        '.quant/kv/a.keys': 'secret',
        '.git/config': 'secret',
        'node_modules/p/index.js': 'secret',
        'index.html': '<p>home</p>'
      };
      for (const [name, body] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
        fs.writeFileSync(path.join(root, name), body);
      }
      const server = await start({ root, dir: '.' });
      for (const name of Object.keys(files).filter((name) => name !== 'index.html')) {
        const res = await fetch(`${server.url}/${name}`);
        expect(res.status, name).to.equal(404);
        expect(await res.text()).to.not.include('secret');
      }
      expect((await fetch(`${server.url}/index.html`)).status).to.equal(200);
      const warning = server.summary.warnings.find((line) => line.includes('quant serve does not serve'));
      expect(warning).to.include('quant.json');
      expect(warning).to.include('node_modules');
    });

    it('warns when the site directory contains the project root', async () => {
      const parent = fs.mkdtempSync(path.join(tmp, 'parent-'));
      const root = path.join(parent, 'site');
      fs.mkdirSync(root);
      fs.writeFileSync(path.join(root, 'quant.json'), '{}');
      const server = await start({ root, dir: '..' });
      expect((await fetch(`${server.url}/site/quant.json`)).status).to.equal(404);
      expect(server.summary.warnings.some((line) => line.includes('quant serve does not serve'))).to.equal(true);
    });

    it('does not warn for a site directory under the project root', async () => {
      const server = await start();
      expect(server.summary.warnings.some((line) => line.includes('quant serve does not serve'))).to.equal(false);
    });

    it('uses local and dev for the headers by default', async () => {
      const server = await start({ org: undefined, project: undefined });
      expectQuantHeaders(await fetch(`${server.url}/`), 'local', 'dev');
    });
  });

  describe('proxy', () => {
    let upstream;
    let upgraded = [];

    afterEach(async () => {
      for (const socket of upgraded) socket.destroy();
      upgraded = [];
      if (upstream) await closeServer(upstream);
      upstream = null;
    });

    it('forwards a request that no rule ends to the dev server', async () => {
      upstream = http.createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          res.writeHead(200, { 'content-type': 'text/plain', 'x-upstream': 'yes' });
          res.end(`${req.method} ${req.url} ${body}`);
        });
      });
      const port = await listen(upstream);
      const server = await start({ proxy: `http://127.0.0.1:${port}` });
      const res = await fetch(`${server.url}/src/main.ts?v=1`, { method: 'POST', body: 'data' });
      expect(res.status).to.equal(200);
      expect(res.headers.get('x-upstream')).to.equal('yes');
      expectQuantHeaders(res);
      expect(await res.text()).to.equal('POST /src/main.ts?v=1 data');
      const api = await fetch(`${server.url}/api/workspace`);
      expect((await api.json()).store).to.equal('acme-site-orbit');
    });

    it('streams a proxied POST body over the function cap to the dev server intact', async () => {
      upstream = http.createServer((req, res) => {
        const hash = crypto.createHash('sha256');
        let length = 0;
        req.on('data', (chunk) => { hash.update(chunk); length += chunk.length; });
        req.on('end', () => res.end(JSON.stringify({ length, sha256: hash.digest('hex') })));
      });
      const port = await listen(upstream);
      const server = await start({ proxy: `http://127.0.0.1:${port}` });
      const body = crypto.randomBytes(MAX_REQUEST_BODY_BYTES + 1024);
      const res = await fetch(`${server.url}/upload`, { method: 'POST', body });
      expect(await res.json()).to.deep.equal({
        length: body.length,
        sha256: crypto.createHash('sha256').update(body).digest('hex')
      });
    });

    it('returns 502 with the message when the dev server does not answer', async () => {
      const closed = http.createServer();
      const port = await listen(closed);
      await closeServer(closed);
      const target = `http://127.0.0.1:${port}`;
      const server = await start({ proxy: target });
      const res = await fetch(`${server.url}/anything`);
      expect(res.status).to.equal(502);
      expect(await res.text()).to.equal(`The dev server at ${target} did not answer.`);
      expectQuantHeaders(res);
    });

    it('sends a WebSocket upgrade to the dev server', async () => {
      upstream = http.createServer();
      upstream.on('upgrade', (req, socket, head) => {
        upgraded.push(socket);
        socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n');
        if (head.length > 0) socket.write(`echo:${head}`);
        socket.on('data', (chunk) => socket.write(`echo:${chunk}`));
      });
      const port = await listen(upstream);
      const server = await start({ proxy: `http://127.0.0.1:${port}` });
      const head = 'GET /hmr HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\nhello';
      const reply = await rawRequest(server.url, head);
      expect(reply).to.include('101 Switching Protocols');
      expect(reply).to.include('echo:hello');
    });

    it('answers the control route locally and never proxies it', async () => {
      upstream = http.createServer((_req, res) => res.end('upstream'));
      const port = await listen(upstream);
      const server = await start({ proxy: `http://127.0.0.1:${port}` });
      const res = await fetch(`${server.url}/_quant_serve/info`);
      expect(res.status).to.equal(200);
      const info = await res.json();
      expect(info.org).to.equal('acme');
      expect(info.project).to.equal('site');
      expectQuantHeaders(res);
    });
  });

  describe('start-up', () => {
    it('stops with the message when the port is in use', async () => {
      const busy = http.createServer();
      const port = await listen(busy);
      try {
        await start({ port });
        expect.fail('must fail');
      } catch (err) {
        expect(err.message).to.equal(`Port ${port} is in use. Use --port.`);
      } finally {
        await closeServer(busy);
      }
    });

    it('stops with the file name when a manifest is invalid', async () => {
      const root = tempProject({ rules: [{ id: 'Bad id', type: 'function', urls: ['/x'] }] });
      try {
        await start({ root });
        expect.fail('must fail');
      } catch (err) {
        expect(err.message).to.include('quant/edge-rules.json');
      }
    });

    it('summarises the stores and the rules', async () => {
      const server = await start();
      expect(server.summary.stores).to.deep.equal([{ name: 'orbit', id: 'acme-site-orbit' }]);
      expect(server.summary.rules).to.deep.equal([{ id: 'api', type: 'function', urls: ['/api/*'] }]);
    });
  });

  describe('--watch', function () {
    // fs.watch needs a short time to start before it reports changes.
    this.timeout(10000);
    const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

    it('keeps the last good manifest when an edit is invalid', async () => {
      const root = tempProject({
        functions: [{ id: 'hello', uuid: ORBIT_FN, body: 'return new Response(\'hello\');' }],
        rules: [rule('hello', 'function', ['/hello'], ORBIT_FN)]
      });
      const server = await start({ root, watch: true });
      await settle();
      const rulesFile = path.join(root, 'quant', 'edge-rules.json');
      fs.writeFileSync(rulesFile, '{ not json');
      await waitFor(() => lines.some((line) => line.includes('quant/edge-rules.json')), 8000);
      expect(await (await fetch(`${server.url}/hello`)).text()).to.equal('hello');
      writeJson(rulesFile, { version: 1, namespace: 'test', rules: [rule('hello', 'function', ['/hi'], ORBIT_FN)] });
      await waitFor(async () => (await (await fetch(`${server.url}/hi`)).text()) === 'hello', 8000);
      expect((await fetch(`${server.url}/hello`)).status).to.equal(404);
    });

    it('rebuilds the static index when the site changes', async () => {
      const root = tempProject({ files: { 'index.html': 'home' } });
      const server = await start({ root, watch: true });
      expect((await fetch(`${server.url}/new.html`)).status).to.equal(404);
      await settle();
      fs.writeFileSync(path.join(root, 'dist', 'new.html'), 'new');
      await waitFor(async () => (await fetch(`${server.url}/new.html`)).status === 200, 8000);
    });
  });
});

describe('serve control route', () => {
  const routes = controlRoutes({ info: () => ({ org: 'acme', project: 'site' }) });

  it('matches only the /_quant_serve path', () => {
    expect(isControlPath('/_quant_serve/info')).to.equal(true);
    expect(isControlPath('/_quant_serve')).to.equal(true);
    expect(isControlPath('/_quant_server')).to.equal(false);
    expect(isControlPath('/api/_quant_serve/info')).to.equal(false);
  });

  it('answers /_quant_serve/info for loopback addresses', async () => {
    for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1']) {
      const res = await routes({ method: 'GET', pathname: '/_quant_serve/info', remoteAddress });
      expect(res.status).to.equal(200);
      expect(await res.json()).to.include({ org: 'acme', project: 'site' });
    }
  });

  it('refuses a non-loopback address', async () => {
    const res = await routes({ method: 'GET', pathname: '/_quant_serve/info', remoteAddress: '192.168.1.20' });
    expect(res.status).to.equal(403);
  });

  it('gives 404 for the clock and archive routes in this release', async () => {
    for (const pathname of ['/_quant_serve/clock/advance', '/_quant_serve/ledger/archive-now']) {
      const res = await routes({ method: 'POST', pathname, remoteAddress: '127.0.0.1' });
      expect(res.status).to.equal(404);
    }
  });
});

describe('serve project', () => {
  it('loads the Orbit manifests in run order', () => {
    const project = loadProject({ root: ORBIT });
    expect(project.rules.map((r) => r.id)).to.deep.equal(['api']);
    expect(project.rules[0].fnUuid).to.equal(ORBIT_FN);
    expect(project.functions.get(ORBIT_FN).path).to.equal(path.join(ORBIT, 'quant', 'edge-functions', 'api.js'));
    expect(project.stores.map((s) => s.name)).to.deep.equal(['orbit']);
  });

  it('treats missing manifests and meta.json as empty', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-empty-'));
    try {
      const project = loadProject({ root });
      expect(project.rules).to.deep.equal([]);
      expect(project.functions.size).to.equal(0);
      expect(project.stores).to.deep.equal([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
