import { expect } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildIndex, lookup, serveStatic, notFound } from '../../../src/serve/static.js';

const WARNING = 'Production serves /_quant404. Copy 404.html to _quant404/index.html in your deploy step.';

function makeSite(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-static-'));
  for (const [name, body] of Object.entries(files)) {
    const full = path.join(dir, name);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return dir;
}

describe('serve static', () => {
  let dir;
  let index;

  beforeEach(() => {
    dir = makeSite({
      'app/index.html': '<h1>app</h1>',
      'index.html': '<h1>home</h1>',
      'assets/main.js': '0123456789abcdef',
      'Mixed/Page.html': 'mixed'
    });
    index = buildIndex(dir);
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  describe('lookup', () => {
    for (const p of ['/app', '/app/', '/APP', '/app/index.html']) {
      it(`maps ${p} to app/index.html`, () => {
        expect(path.relative(dir, lookup(index, p, '').path)).to.equal(path.join('app', 'index.html'));
      });
    }

    it('maps the root to index.html', () => {
      expect(path.relative(dir, lookup(index, '/', '').path)).to.equal('index.html');
    });

    it('falls back to the path without the query', () => {
      expect(lookup(index, '/app', '?v=2')).to.equal(lookup(index, '/app', ''));
    });

    it('returns null for an unknown path', () => {
      expect(lookup(index, '/nope', '')).to.equal(null);
    });

    it('refuses path traversal', () => {
      fs.writeFileSync(path.join(path.dirname(dir), 'serve-secret.txt'), 'secret');
      const attempts = ['/../serve-secret.txt', '/..%2fserve-secret.txt', '/%2e%2e/serve-secret.txt',
        '/%2e%2e%2fserve-secret.txt', '/assets/../../serve-secret.txt', '/app/%2e%2e/%2e%2e/serve-secret.txt', '/%00'];
      try {
        for (const attempt of attempts) {
          expect(lookup(index, attempt, ''), attempt).to.equal(null);
        }
      } finally {
        fs.rmSync(path.join(path.dirname(dir), 'serve-secret.txt'), { force: true });
      }
    });

    it('does not index a symlink that leaves the directory', function () {
      const outside = path.join(path.dirname(dir), 'serve-outside.txt');
      fs.writeFileSync(outside, 'outside');
      try {
        fs.symlinkSync(outside, path.join(dir, 'link.txt'));
      } catch {
        this.skip();
      }
      try {
        expect(lookup(buildIndex(dir), '/link.txt', '')).to.equal(null);
      } finally {
        fs.rmSync(outside, { force: true });
      }
    });

    it('does not throw on a malformed percent escape', () => {
      expect(lookup(index, '/%E0%A4%A', '')).to.equal(null);
    });
  });

  describe('serveStatic', () => {
    it('serves a .js file with its content type, etag and no-store', async () => {
      const res = await serveStatic(lookup(index, '/assets/main.js', ''), 'GET');
      expect(res.status).to.equal(200);
      expect(res.headers.get('content-type')).to.match(/javascript/);
      expect(res.headers.get('etag')).to.match(/^"[0-9a-f]{32}"$/);
      expect(res.headers.get('accept-ranges')).to.equal('bytes');
      expect(res.headers.get('cache-control')).to.equal('no-store');
      expect(await res.text()).to.equal('0123456789abcdef');
    });

    it('sends no body for HEAD but keeps content-length', async () => {
      const res = await serveStatic(lookup(index, '/assets/main.js', ''), 'HEAD');
      expect(res.status).to.equal(200);
      expect(res.headers.get('content-length')).to.equal('16');
      expect(await res.text()).to.equal('');
    });

    it('serves a single range as 206', async () => {
      const res = await serveStatic(lookup(index, '/assets/main.js', ''), 'GET', 'bytes=0-9');
      expect(res.status).to.equal(206);
      expect(res.headers.get('content-range')).to.equal('bytes 0-9/16');
      expect((await res.text())).to.equal('0123456789');
    });

    it('serves a suffix range', async () => {
      const res = await serveStatic(lookup(index, '/assets/main.js', ''), 'GET', 'bytes=-4');
      expect(res.status).to.equal(206);
      expect(await res.text()).to.equal('cdef');
    });

    it('returns 416 for an unsatisfiable range', async () => {
      const res = await serveStatic(lookup(index, '/assets/main.js', ''), 'GET', 'bytes=999999-');
      expect(res.status).to.equal(416);
      expect(res.headers.get('content-range')).to.equal('bytes */16');
    });

    it('ignores a multi-range request', async () => {
      const res = await serveStatic(lookup(index, '/assets/main.js', ''), 'GET', 'bytes=0-1,4-5');
      expect(res.status).to.equal(200);
    });
  });

  describe('notFound', () => {
    it('uses _quant404 when present', async () => {
      const d = makeSite({ '_quant404/index.html': '<p>custom</p>', '404.html': 'old' });
      try {
        const out = notFound(d, buildIndex(d));
        const res = await out.response;
        expect(res.status).to.equal(404);
        expect(res.headers.get('cache-control')).to.equal('no-store');
        expect(await res.text()).to.equal('<p>custom</p>');
        expect(out.warning).to.equal(null);
      } finally {
        fs.rmSync(d, { recursive: true, force: true });
      }
    });

    it('serves the built-in page and the warning when only 404.html exists', async () => {
      const d = makeSite({ '404.html': 'old' });
      try {
        const out = notFound(d, buildIndex(d));
        const res = await out.response;
        expect(res.status).to.equal(404);
        expect(res.headers.get('content-type')).to.match(/text\/html/);
        expect(res.headers.get('cache-control')).to.equal('no-store');
        expect(await res.text()).to.not.equal('old');
        expect(out.warning).to.equal(WARNING);
      } finally {
        fs.rmSync(d, { recursive: true, force: true });
      }
    });

    it('serves the built-in page without a warning when no 404 file exists', async () => {
      const out = notFound(dir, index);
      expect((await out.response).status).to.equal(404);
      expect(out.warning).to.equal(null);
    });
  });
});
