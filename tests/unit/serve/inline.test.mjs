import { expect } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inlineSetting, readInlineSetting, tokenUuids, applyInline } from '../../../src/serve/inline.js';
import { startServer } from '../../../src/serve/server.js';

const A = 'c3d4e5f6-0001-4000-8000-000000000001';
const B = 'c3d4e5f6-0002-4000-8000-000000000002';
const ON = { project_settings: { enable_inline_fn: true } };

function bytesPage(bytes, headers = {}) {
  return new Response(bytes, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=UTF-8', etag: '"1"', 'content-length': String(bytes.length), ...headers }
  });
}

const BOM = [0xef, 0xbb, 0xbf];

function page(body, headers = {}) {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=UTF-8', etag: '"1"', 'last-modified': 'x', 'content-length': String(body.length), ...headers }
  });
}

describe('serve inline functions', () => {
  describe('inlineSetting', () => {
    it('is on only when project_settings.enable_inline_fn is true', () => {
      expect(inlineSetting(ON)).to.equal(true);
      expect(inlineSetting({ project_settings: { enable_inline_fn: false } })).to.equal(false);
      expect(inlineSetting({})).to.equal(false);
      expect(inlineSetting([ON])).to.equal(true);
      expect(inlineSetting({ project_settings: [] })).to.equal(false);
    });

    it('refuses the shapes that the portal refuses, with the portal messages', () => {
      expect(() => inlineSetting({ project_settings: [1] })).to.throw('quant/meta.json: project_settings must be an object.');
      expect(() => inlineSetting({ project_settings: { headers: {} } }))
        .to.throw('quant/meta.json: project_settings.headers is not supported (supported: enable_inline_fn).');
      expect(() => inlineSetting({ project_settings: { enable_inline_fn: 'yes' } }))
        .to.throw('quant/meta.json: project_settings.enable_inline_fn must be true or false.');
    });
  });

  describe('readInlineSetting', () => {
    let tmp;
    beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-inline-')); });
    afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

    function write(text) {
      fs.mkdirSync(path.join(tmp, 'quant'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'quant', 'meta.json'), text);
    }

    it('is off when the file does not exist', () => {
      expect(readInlineSetting(tmp, 'quant/meta.json')).to.equal(false);
    });

    it('reads the setting from the file', () => {
      write(JSON.stringify(ON));
      expect(readInlineSetting(tmp, 'quant/meta.json')).to.equal(true);
    });

    it('ignores a file that is not JSON and does not name project_settings', () => {
      write('{ title: old template }');
      expect(readInlineSetting(tmp, 'quant/meta.json')).to.equal(false);
    });

    it('refuses a file that is not JSON and names project_settings', () => {
      write('{ "project_settings": { enable_inline_fn: true } }');
      expect(() => readInlineSetting(tmp, 'quant/meta.json')).to.throw(/^quant\/meta\.json: /);
    });
  });

  describe('tokenUuids', () => {
    it('lists each full UUID once, in document order, in lower case', () => {
      const body = `{{QUANT_FN:${B}}} {{quant_fn:${A}}} {{QUANT_FN:${B}}} {{QUANT_FN:not-a-uuid}}`;
      expect(tokenUuids(body)).to.deep.equal({ uuids: [B, A], hit: true });
      expect(tokenUuids(`{{QUANT_FN:${A.toUpperCase()}}}`).uuids).to.deep.equal([A]);
    });

    it('counts a token without a full UUID as a hit with no UUIDs', () => {
      expect(tokenUuids('{{QUANT_FN:x}}')).to.deep.equal({ uuids: [], hit: true });
      expect(tokenUuids('<p>plain</p>')).to.deep.equal({ uuids: [], hit: false });
    });
  });

  describe('applyInline', () => {
    const output = (text, headers) => async () => ({ text, headers: new Headers(headers) });

    it('replaces every copy of each token and runs each function once, in order', async () => {
      const calls = [];
      const run = async (uuid) => {
        calls.push(uuid);
        return { text: uuid === A ? 'first' : 'second', headers: new Headers({ 'cache-control': 'private, max-age=0' }) };
      };
      const response = await applyInline(page(`<p>{{QUANT_FN:${A}}}|{{QUANT_FN:${B}}}|{{QUANT_FN:${A}}}</p>`), run);
      expect(await response.text()).to.equal('<p>first|second|first</p>');
      expect(calls).to.deep.equal([A, B]);
    });

    it('inserts the output as text, with no replacement patterns', async () => {
      const response = await applyInline(page(`<p>{{QUANT_FN:${A}}}</p>`), output('$& $$ $` $\''));
      expect(await response.text()).to.equal('<p>$& $$ $` $\'</p>');
    });

    it('does not scan the output for tokens', async () => {
      const run = async (uuid) => ({ text: uuid === A ? `{{QUANT_FN:${B}}}` : 'inner', headers: new Headers() });
      const response = await applyInline(page(`<p>{{QUANT_FN:${A}}}</p>`), run);
      expect(await response.text()).to.equal(`<p>{{QUANT_FN:${B}}}</p>`);
    });

    it('gives a page with a token the function headers, the HTML type and no validators', async () => {
      const response = await applyInline(page(`<p>{{QUANT_FN:${A}}}</p>`, { 'x-page': '1' }),
        output('Hello', { 'cache-control': 'public, max-age=60', 'x-fn': '1', 'quant-server': 'x', age: '9' }));
      expect(response.status).to.equal(200);
      expect(response.headers.get('cache-control')).to.equal('public, max-age=60');
      expect(response.headers.get('x-fn')).to.equal('1');
      expect(response.headers.get('x-page')).to.equal('1');
      expect(response.headers.get('quant-server')).to.equal(null);
      expect(response.headers.get('age')).to.equal(null);
      expect(response.headers.get('content-type')).to.equal('text/html; charset=utf-8');
      expect(response.headers.get('etag')).to.equal(null);
      expect(response.headers.get('last-modified')).to.equal(null);
      expect(response.headers.get('content-length')).to.equal(String(Buffer.byteLength('<p>Hello</p>')));
    });

    it('makes a page private when no function ran', async () => {
      const response = await applyInline(page('<p>{{QUANT_FN:x}}</p>', { 'cache-control': 'public, max-age=60' }), output('unused'));
      expect(await response.text()).to.equal('<p>{{QUANT_FN:x}}</p>');
      expect(response.headers.get('cache-control')).to.equal('private, max-age=0');
    });

    it('sends a page with a BOM and no token byte for byte, with its headers', async () => {
      const bytes = new Uint8Array([...BOM, ...Buffer.from('<p>plain utf8 bom</p>')]);
      const response = await applyInline(bytesPage(bytes), output('unused'));
      expect(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(bytes))).to.equal(true);
      expect(response.headers.get('content-length')).to.equal(String(bytes.length));
      expect(response.headers.get('etag')).to.equal('"1"');
    });

    it('sends a page with bytes that are not UTF-8 and no token byte for byte', async () => {
      const bytes = new Uint8Array([...Buffer.from('<p>caf'), 0xe9, 0xff, ...Buffer.from('</p>')]);
      const response = await applyInline(bytesPage(bytes), output('unused'));
      expect(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(bytes))).to.equal(true);
      expect(response.headers.get('content-length')).to.equal(String(bytes.length));
    });

    it('keeps the BOM of a page with a token and gives the new content-length', async () => {
      const bytes = new Uint8Array([...BOM, ...Buffer.from(`<p>{{QUANT_FN:${A}}} é</p>`)]);
      const response = await applyInline(bytesPage(bytes), output('Hello ü'));
      const body = Buffer.from(await response.arrayBuffer());
      const expected = Buffer.from([...BOM, ...Buffer.from('<p>Hello ü é</p>')]);
      expect(body.equals(expected)).to.equal(true);
      expect(response.headers.get('content-length')).to.equal(String(expected.length));
      expect(response.headers.get('etag')).to.equal(null);
    });

    it('leaves a page without a token as it is', async () => {
      const response = await applyInline(page('<p>plain</p>'), output('unused'));
      expect(await response.text()).to.equal('<p>plain</p>');
      expect(response.headers.get('etag')).to.equal('"1"');
    });

    it('replaces set-cookie from the function as a group', async () => {
      const source = page(`{{QUANT_FN:${A}}}`, { 'set-cookie': 'page=1' });
      const headers = new Headers();
      headers.append('set-cookie', 'a=1');
      headers.append('set-cookie', 'b=2');
      const response = await applyInline(source, async () => ({ text: '', headers }));
      expect(response.headers.getSetCookie()).to.deep.equal(['a=1', 'b=2']);
    });
  });

  describe('in the server', () => {
    let tmp;
    let servers;
    let lines;

    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-inline-site-'));
      servers = [];
      lines = [];
    });

    afterEach(async () => {
      for (const server of servers) await server.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    function project({ files = {}, functions = [], rules = [], meta = ON }) {
      const write = (file, text) => {
        fs.mkdirSync(path.dirname(path.join(tmp, file)), { recursive: true });
        fs.writeFileSync(path.join(tmp, file), text);
      };
      const manifest = functions.map((fn) => ({ id: fn.id, uuid: fn.uuid, type: fn.type || 'function', path: `quant/fn/${fn.id}.js`, description: fn.id }));
      functions.forEach((fn, i) => write(manifest[i].path, fn.body));
      write('quant/edge-functions.json', JSON.stringify(manifest));
      write('quant/edge-rules.json', JSON.stringify({ version: 1, namespace: 'test', rules }));
      if (meta) write('quant/meta.json', JSON.stringify(meta));
      for (const [name, text] of Object.entries(files)) write(path.join('dist', name), text);
    }

    async function start(over = {}) {
      const server = await startServer({ root: tmp, dir: 'dist', port: 0, host: '127.0.0.1', log: (line) => lines.push(line), ...over });
      servers.push(server);
      return server;
    }

    const echo = { id: 'echo', uuid: A, body: "return new Response(event.url.pathname + event.url.search + ' ' + event.request.method + ' ' + event.request.headers.get('x-test'));" };

    it('gives the function the page request', async () => {
      project({ files: { 'about/index.html': `<div>{{QUANT_FN:${A}}}</div>` }, functions: [echo] });
      const server = await start();
      const res = await fetch(`${server.url}/about/?q=1`, { headers: { 'x-test': 'yes' } });
      expect(await res.text()).to.equal('<div>/about/?q=1 GET yes</div>');
      expect(res.headers.get('quant-server')).to.equal('QuantCDN (quant serve)');
    });

    it('sends a page with a BOM and no token whole, with its length', async () => {
      project({ functions: [echo] });
      fs.mkdirSync(path.join(tmp, 'dist', 'bom'), { recursive: true });
      const bytes = Buffer.from([...BOM, ...Buffer.from('<p>plain utf8 bom</p>')]);
      fs.writeFileSync(path.join(tmp, 'dist', 'bom', 'index.html'), bytes);
      const server = await start();
      const res = await fetch(`${server.url}/bom`);
      expect(res.headers.get('content-length')).to.equal(String(bytes.length));
      expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).to.equal(true);
    });

    it('answers a HEAD for a page with a token with the page headers and no body', async () => {
      project({ files: { 'index.html': `<div>{{QUANT_FN:${A}}}</div>` }, functions: [echo] });
      const server = await start();
      const res = await fetch(`${server.url}/`, { method: 'HEAD' });
      expect(res.status).to.equal(200);
      expect(res.headers.get('cache-control')).to.equal('private, max-age=0');
      expect(await res.text()).to.equal('');
    });

    it('sends the whole page for a range request on a page with inline functions on', async () => {
      project({ files: { 'index.html': `<div>{{QUANT_FN:${A}}}</div>` }, functions: [echo] });
      const server = await start();
      const res = await fetch(`${server.url}/`, { headers: { range: 'bytes=0-3' } });
      expect(res.status).to.equal(200);
      expect(await res.text()).to.match(/^<div>\/ GET/);
    });

    it('inserts the refusal text for a token of an auth or filter function', async () => {
      const auth = { id: 'gate', uuid: B, type: 'auth', body: "return new Response('ok', { status: 201 });" };
      project({ files: { 'index.html': `<p>{{QUANT_FN:${B}}}</p>` }, functions: [auth] });
      const server = await start();
      const res = await fetch(`${server.url}/`);
      expect(await res.text()).to.equal('<p>Direct execution of auth function is disallowed.</p>');
    });

    it('replaces tokens in a 200 HTML page from the dev server', async () => {
      project({ functions: [echo] });
      const http = await import('node:http');
      const dev = http.createServer((req, res) => {
        res.setHeader('content-type', req.url === '/data' ? 'application/json' : 'text/html');
        res.statusCode = req.url === '/gone' ? 404 : 200;
        res.end(`<p>{{QUANT_FN:${A}}}</p>`);
      });
      await new Promise((resolve) => dev.listen(0, '127.0.0.1', resolve));
      try {
        const server = await start({ proxy: `http://127.0.0.1:${dev.address().port}` });
        expect(await (await fetch(`${server.url}/page`)).text()).to.equal('<p>/page GET null</p>');
        expect(await (await fetch(`${server.url}/data`)).text()).to.equal(`<p>{{QUANT_FN:${A}}}</p>`);
        expect(await (await fetch(`${server.url}/gone`)).text()).to.equal(`<p>{{QUANT_FN:${A}}}</p>`);
      } finally {
        dev.closeAllConnections();
        await new Promise((resolve) => dev.close(resolve));
      }
    });

    it('does not start with a meta.json that the portal refuses', async () => {
      project({ meta: { project_settings: { enable_inline_fn: 1 } } });
      let error;
      try {
        await start();
      } catch (err) {
        error = err;
      }
      expect(error && error.message).to.equal('quant/meta.json: project_settings.enable_inline_fn must be true or false.');
    });
  });
});
