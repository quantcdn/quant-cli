import { expect } from 'chai';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  parseServeConfig, readServeConfig, withGlobalHeaders, basicAuthResponse, trailingSlashRedirect
} from '../../../src/serve/project-config.js';
import { startServer } from '../../../src/serve/server.js';

const FN = 'd4e5f6a7-0001-4000-8000-000000000001';
const GOOD = 'Basic dTpw';

function settings(document) {
  return parseServeConfig(document);
}

describe('serve project settings (quant/serve.json)', () => {
  describe('parseServeConfig', () => {
    it('gives the defaults for an empty document', () => {
      expect(settings({})).to.deep.equal({ globalHeaders: [], basicAuth: null, trailingSlash: 'none', warnings: [] });
    });

    it('reads every field', () => {
      const result = settings({ globalHeaders: { 'X-Frame-Options': 'DENY' }, basicAuth: { username: 'u', password: 'p' }, trailingSlash: 'redirect' });
      expect(result.globalHeaders).to.deep.equal([['x-frame-options', 'DENY']]);
      expect(result.basicAuth).to.equal(GOOD);
      expect(result.trailingSlash).to.equal('redirect');
    });

    it('skips the headers that a project cannot set, with a warning', () => {
      const result = settings({ globalHeaders: { 'quant-server': 'x', Age: '1', 'x-a': '1' } });
      expect(result.globalHeaders).to.deep.equal([['x-a', '1']]);
      expect(result.warnings).to.have.length(2);
      expect(result.warnings[0]).to.match(/globalHeaders\.quant-server is not applied/);
    });

    it('refuses a document with the wrong shape, with a clear message', () => {
      const cases = [
        [[], 'quant/serve.json must be a JSON object.'],
        [{ headers: {} }, 'quant/serve.json: headers is not supported (supported: globalHeaders, basicAuth, trailingSlash).'],
        [{ globalHeaders: [] }, 'quant/serve.json: globalHeaders must be an object of header names and values.'],
        [{ globalHeaders: { 'bad name': 'x' } }, 'quant/serve.json: globalHeaders: "bad name" is not a valid header name.'],
        [{ globalHeaders: { 'x-a': 1 } }, 'quant/serve.json: globalHeaders.x-a must be printable ASCII text on one line.'],
        [{ globalHeaders: { 'x-a': 'a\r\nb' } }, 'quant/serve.json: globalHeaders.x-a must be printable ASCII text on one line.'],
        [{ basicAuth: { username: 'u' } }, /basicAuth must be \{ "username": "\.\.\.", "password": "\.\.\." \}/],
        [{ basicAuth: { username: 'u', password: '' } }, /basicAuth must be/],
        [{ basicAuth: { username: 'u:v', password: 'p' } }, 'quant/serve.json: basicAuth.username cannot contain ":".'],
        [{ trailingSlash: 'preserve' }, 'quant/serve.json: trailingSlash must be "redirect" or "none".']
      ];
      for (const [document, message] of cases) expect(() => settings(document), JSON.stringify(document)).to.throw(message);
    });

    it('never puts the password in a message', () => {
      for (const document of [{ basicAuth: { username: 'u', password: 'secret-pw', extra: 1 } }, { basicAuth: { username: 'u:', password: 'secret-pw' } }]) {
        expect(() => settings(document)).to.throw().with.property('message').that.does.not.include('secret-pw');
      }
    });
  });

  describe('readServeConfig', () => {
    let tmp;
    beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-config-')); });
    afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

    it('gives the defaults when the file does not exist', () => {
      expect(readServeConfig(tmp).trailingSlash).to.equal('none');
    });

    it('does not quote a file that is not JSON', () => {
      fs.mkdirSync(path.join(tmp, 'quant'));
      fs.writeFileSync(path.join(tmp, 'quant', 'serve.json'), '{ "basicAuth": { "username": "u", "password": secret-pw } }');
      expect(() => readServeConfig(tmp)).to.throw('quant/serve.json is not valid JSON.');
      expect(() => readServeConfig(tmp)).to.throw().with.property('message').that.does.not.include('secret-pw');
    });
  });

  describe('responses', () => {
    const on = settings({ globalHeaders: { 'x-a': 'global', 'cache-control': 'public, max-age=60' }, basicAuth: { username: 'u', password: 'p' }, trailingSlash: 'redirect' });

    it('adds the global headers over the response headers, or under them with replace off', () => {
      const source = () => new Response('x', { status: 404, headers: { 'x-a': 'own', 'cache-control': 'no-store' } });
      const replaced = withGlobalHeaders(source(), on);
      expect(replaced.status).to.equal(404);
      expect(replaced.headers.get('x-a')).to.equal('global');
      expect(replaced.headers.get('cache-control')).to.equal('public, max-age=60');
      expect(withGlobalHeaders(source(), on, false).headers.get('x-a')).to.equal('own');
    });

    it('answers 401 unless the Authorization header is the exact expected value', async () => {
      expect(basicAuthResponse(on, GOOD)).to.equal(null);
      expect(basicAuthResponse(settings({}), undefined)).to.equal(null);
      for (const value of [undefined, 'basic dTpw', 'Basic  dTpw', 'Basic d3Jvbmc6eA==']) {
        const response = basicAuthResponse(on, value);
        expect(response.status, String(value)).to.equal(401);
      }
      const response = basicAuthResponse(on, undefined);
      expect(await response.text()).to.equal('Authentication required');
      expect(response.headers.get('www-authenticate')).to.equal('Basic realm=Authorization Required');
      expect(response.headers.get('content-type')).to.equal('text/html; charset=utf-8');
      expect(response.headers.get('cache-control')).to.equal('private');
      expect(response.headers.get('x-a')).to.equal('global');
    });

    it('redirects a path with trailing slashes to the path without them, with the query', () => {
      const redirect = trailingSlashRedirect(on, '/about//', '?a=1');
      expect(redirect.status).to.equal(301);
      expect(redirect.headers.get('location')).to.equal('/about?a=1');
      expect(redirect.headers.get('cache-control')).to.equal('public, max-age=300, s-maxage=86400');
      expect(trailingSlashRedirect(on, '/', '')).to.equal(null);
      expect(trailingSlashRedirect(on, '/about', '')).to.equal(null);
      expect(trailingSlashRedirect(on, '//x/', '')).to.equal(null);
      expect(trailingSlashRedirect(settings({}), '/about/', '')).to.equal(null);
    });
  });

  describe('in the server', () => {
    let tmp;
    let servers;
    let lines;

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-config-site-'));
      servers = [];
      lines = [];
    });

    afterEach(async () => {
      for (const server of servers) await server.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    function write(file, text) {
      fs.mkdirSync(path.dirname(path.join(tmp, file)), { recursive: true });
      fs.writeFileSync(path.join(tmp, file), text);
    }

    function project(config) {
      write('quant/fn/api.js', "return new Response('from function', { headers: { 'x-fn': '1' } });");
      write('quant/edge-functions.json', JSON.stringify([{ id: 'api', uuid: FN, type: 'function', path: 'quant/fn/api.js', description: 'api' }]));
      write('quant/edge-rules.json', JSON.stringify({ version: 1, namespace: 'test', rules: [{ id: 'api', type: 'function', urls: ['/api/*'], weight: 0, function_uuid: FN }] }));
      write('dist/index.html', '<h1>Home</h1>');
      write('dist/about/index.html', '<h1>About</h1>');
      if (config) write('quant/serve.json', JSON.stringify(config));
    }

    async function start(over = {}) {
      const server = await startServer({ root: tmp, dir: 'dist', port: 0, host: '127.0.0.1', log: (line) => lines.push(line), ...over });
      servers.push(server);
      return server;
    }

    it('applies basic authentication, rules, the redirect and static content in that order', async () => {
      project({ globalHeaders: { 'x-a': '1' }, basicAuth: { username: 'u', password: 'p' }, trailingSlash: 'redirect' });
      const server = await start();
      const get = (p, headers = {}) => fetch(`${server.url}${p}`, { headers, redirect: 'manual' });
      expect((await get('/about/')).status).to.equal(401);
      const redirect = await get('/about/', { authorization: GOOD });
      expect(redirect.status).to.equal(301);
      expect(redirect.headers.get('x-a')).to.equal(null);
      const fn = await get('/api/x/', { authorization: GOOD });
      expect(await fn.text()).to.equal('from function');
      expect(fn.headers.get('x-a')).to.equal('1');
      const page = await get('/about', { authorization: GOOD });
      expect(await page.text()).to.equal('<h1>About</h1>');
      expect(page.headers.get('x-a')).to.equal('1');
      expect(page.headers.get('quant-server')).to.equal('QuantCDN (quant serve)');
    });

    it('does not ask for credentials on the local control routes', async () => {
      project({ basicAuth: { username: 'u', password: 'p' } });
      const server = await start();
      const res = await fetch(`${server.url}/_quant_serve/info`, { headers: { 'x-quant-serve': '1' } });
      expect(res.status).to.equal(200);
    });

    it('refuses a WebSocket upgrade without credentials', async () => {
      project({ basicAuth: { username: 'u', password: 'p' } });
      const server = await start({ proxy: 'http://127.0.0.1:9' });
      const { port } = new URL(server.url);
      const status = await new Promise((resolve, reject) => {
        const req = http.request({ host: '127.0.0.1', port: Number(port), path: '/ws', headers: { connection: 'Upgrade', upgrade: 'websocket' } });
        req.on('response', (res) => resolve(res.statusCode));
        req.on('upgrade', () => resolve('upgraded'));
        req.on('error', reject);
        req.end();
      });
      expect(status).to.equal(401);
    });

    it('does not start with a serve.json that has the wrong shape', async () => {
      project({ trailingSlash: true });
      let error;
      try {
        await start();
      } catch (err) {
        error = err;
      }
      expect(error && error.message).to.equal('quant/serve.json: trailingSlash must be "redirect" or "none".');
    });

    it('keeps the last valid settings after an invalid edit with --watch, and never prints the password', async function () {
      this.timeout(5000);
      const password = 'SecretPw-4821';
      const credentials = `Basic ${Buffer.from(`u:${password}`).toString('base64')}`;
      project({ basicAuth: { username: 'u', password } });
      const server = await start({ watch: true });
      expect((await fetch(`${server.url}/`)).status).to.equal(401);
      write('quant/serve.json', `{ "basicAuth": { "username": "u", "password": ${password} } }`);
      const started = Date.now();
      while (!lines.some((line) => line.includes('not valid JSON')) && Date.now() - started < 4000) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(lines.join('\n')).to.include('quant/serve.json is not valid JSON.');
      expect((await fetch(`${server.url}/`)).status).to.equal(401);
      expect((await fetch(`${server.url}/`, { headers: { authorization: credentials } })).status).to.equal(200);
      const output = lines.join('\n');
      expect(output).to.not.include(password);
      expect(output).to.not.include(password.slice(0, 6));
    });

    it('reloads serve.json with --watch', async function () {
      this.timeout(5000);
      project({});
      const server = await start({ watch: true });
      expect((await fetch(`${server.url}/`)).status).to.equal(200);
      write('quant/serve.json', JSON.stringify({ basicAuth: { username: 'u', password: 'p' } }));
      const started = Date.now();
      let status = 200;
      while (status !== 401 && Date.now() - started < 4000) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        status = (await fetch(`${server.url}/`)).status;
      }
      expect(status).to.equal(401);
      expect(lines.join('\n')).to.not.include('"p"');
    });
  });
});
