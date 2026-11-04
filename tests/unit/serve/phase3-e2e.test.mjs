import { expect } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startFakePortal, loadFixtures } from '../../fixtures/fake-portal.mjs';

const CLI = new URL('../../../cli.js', import.meta.url).pathname;
const TOKEN = 'test-e2e-token';
const BASIC_PASSWORD = 'basic-auth-secret-e2e';
const INJECT_SECRET = 'inject-secret-e2e';
const LOCAL_WRITE = 'local-write-e2e';
const PORTAL_VALUE = 'hello from the portal';
const FN = 'aaaa0000-0000-4000-8000-0000000000e2';

const FUNCTION = `
const url = new URL(event.request.url);
const store = kvStore.open('acme-site-cache');
if (url.searchParams.get('op') === 'roundtrip') {
  const before = await store.get('greeting');
  await store.set('written', url.searchParams.get('value'));
  return new Response(JSON.stringify({ before, after: await store.get('written') }));
}
return new Response('local-function');
`;

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function localRule(id, urls, weight) {
  return { id, name: id, type: 'function', urls, weight, function_uuid: FN };
}

function writeProject(root) {
  const write = (name, text) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  };
  write('dist/index.html', 'home');
  write('dist/page.html', 'a page');
  write('dist/private/index.html', 'private page');
  write('quant/edge-functions/kv.js', FUNCTION);
  writeJson(path.join(root, 'quant', 'edge-functions.json'), [{ id: 'kv', uuid: FN, type: 'function', path: 'quant/edge-functions/kv.js', description: 'kv' }]);
  writeJson(path.join(root, 'quant', 'edge-rules.json'), { version: 1, namespace: 'e2e', rules: [
    localRule('kv', ['/kv'], 500),
    localRule('early', ['/early'], 50),
    localRule('order', ['/order'], 200),
    localRule('late', ['/late'], 200)
  ] });
  writeJson(path.join(root, 'quant', 'meta.json'), { kv_stores: [{ name: 'cache' }] });
}

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

// Run `quant serve` as the CLI does. Resolves with { url, output(), stop() } once the URL is printed.
function startCli(root, portal) {
  const args = [CLI, 'serve', 'dist', '--port', '0', '--org', 'acme', '--project', 'site', '--pull-rules', '--kv-remote', 'cache'];
  const env = { ...process.env, QUANT_API_TOKEN: TOKEN, QUANT_BASE_URL: portal.base };
  const child = spawn(process.execPath, args, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let text = '';
  child.stdout.on('data', (chunk) => { text += chunk; });
  child.stderr.on('data', (chunk) => { text += chunk; });
  const exited = new Promise((resolve) => child.on('exit', resolve));
  const ready = new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const found = /quant serve is running at (\S+)/.exec(text);
      if (found) { clearInterval(timer); resolve(found[1]); }
      if (child.exitCode !== null) { clearInterval(timer); reject(new Error(`quant serve exited:\n${text}`)); }
    }, 50);
  });
  return ready.then((url) => ({
    url,
    output: () => text,
    stop: async () => { child.kill('SIGTERM'); await exited; }
  }));
}

describe('quant serve phase 3 end to end', function () {
  this.timeout(30000);
  let root;
  let portal;
  let site;

  before(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-phase3-e2e-'));
    writeProject(root);
    portal = await startFakePortal(loadFixtures());
    site = await startCli(root, portal);
  });

  after(async () => {
    if (site) await site.stop();
    if (portal) await portal.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const get = (route, init = {}) => fetch(`${site.url}${route}`, { redirect: 'manual', ...init });

  it('runs a pulled redirect with the $1 substitution', async () => {
    const res = await get('/old/thing');
    expect(res.status).to.equal(301);
    expect(res.headers.get('location')).to.match(/\/new\/thing$/);
  });

  it('runs a pulled header rule on a static file, and the pulled global header', async () => {
    const res = await get('/page.html');
    expect(res.status).to.equal(200);
    expect(await res.text()).to.equal('a page');
    expect(res.headers.get('x-pulled-rule')).to.equal('applied');
    expect(res.headers.get('x-global')).to.equal('from-portal');
  });

  it('places a local rule among the pulled rules by weight', async () => {
    const order = await get('/order');
    expect(await order.text()).to.equal('local-function');
    expect(order.headers.get('x-before-local')).to.equal('yes');
    expect(await (await get('/early')).text()).to.equal('local-function');
    expect(await (await get('/late')).text()).to.equal('pulled-150');
  });

  it('runs the cookie rule only with the cookie', async () => {
    expect((await get('/cookie')).status).to.equal(404);
    const res = await get('/cookie', { headers: { cookie: 'preview=1' } });
    expect(await res.text()).to.equal('cookie-rule');
  });

  it('keeps pulled secrets out of the responses', async () => {
    const denied = await get('/private/index.html');
    expect(denied.status).to.equal(401);
    const basic = Buffer.from(`editor:${BASIC_PASSWORD}`).toString('base64');
    const allowed = await get('/private/index.html', { headers: { authorization: `Basic ${basic}` } });
    expect(await allowed.text()).to.equal('private page');
    const failed = await get('/backend/x');
    const body = await failed.text();
    expect(failed.status).to.equal(502);
    expect(body).to.not.include(INJECT_SECRET);
    expect([...failed.headers.values()].join('\n')).to.not.include(INJECT_SECRET);
  });

  it('reads a remote key, writes a new key and reads it back', async () => {
    const res = await get(`/kv?op=roundtrip&value=${LOCAL_WRITE}`);
    expect(await res.json()).to.deep.equal({ before: PORTAL_VALUE, after: LOCAL_WRITE });
  });

  it('reads the portal with GET and batch-get only, each with the bearer token', () => {
    const methodPaths = portal.requests.map((request) => `${request.method} ${request.path.split('/').pop()}`);
    expect(methodPaths.filter((entry) => entry.startsWith('POST'))).to.deep.equal(['POST batch-get']);
    expect(portal.requests.every((request) => request.method === 'GET' || request.path.endsWith('/batch-get'))).to.equal(true);
    expect(portal.requests.length).to.be.greaterThan(4);
    for (const request of portal.requests) expect(request.auth).to.equal(`Bearer ${TOKEN}`);
  });

  it('prints no token or secret, and writes no snapshot value or token to the project', async () => {
    const printed = site.output();
    expect(printed).to.include('Pulled 9 portal rules (4 from quant/edge-rules.json).');
    expect(printed).to.include('KV store cache: copied 1 keys from the portal');
    for (const secret of [TOKEN, BASIC_PASSWORD, INJECT_SECRET, PORTAL_VALUE, LOCAL_WRITE]) expect(printed).to.not.include(secret);
    await site.stop();
    expect(fs.existsSync(path.join(root, '.quant'))).to.equal(true);
    for (const file of filesUnder(root)) {
      const text = fs.readFileSync(file, 'latin1');
      for (const secret of [TOKEN, PORTAL_VALUE, LOCAL_WRITE, BASIC_PASSWORD, INJECT_SECRET]) expect(text, `${secret} in ${file}`).to.not.include(secret);
    }
    site = null;
  });
});
