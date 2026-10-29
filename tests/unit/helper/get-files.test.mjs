import { expect } from 'chai';
import fs from 'fs';
import os from 'os';
import path from 'path';
import getFiles from '../../../src/helper/getFiles.js';

describe('getFiles Helper', () => {
  let dir;

  const touch = (rel) => {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, 'x');
    return full;
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-getfiles-'));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('excludes every quant.json, not only the first one matched', async () => {
    touch('a/quant.json');
    touch('b/quant.json');
    touch('c/quant.json');
    const keep = touch('index.html');
    expect(await getFiles(dir)).to.deep.equal([keep]);
  });

  it('excludes quant.json at the top level and in subdirectories', async () => {
    touch('quant.json');
    touch('sub/deep/quant.json');
    const keep = touch('sub/page.html');
    expect(await getFiles(dir)).to.deep.equal([keep]);
  });

  it('excludes quant/serve.json, the local quant serve settings', async () => {
    touch('quant/serve.json');
    touch('site/QUANT/Serve.json');
    const keep = [touch('quant/meta.json'), touch('serve.json')];
    expect((await getFiles(dir)).sort()).to.deep.equal(keep.sort());
  });

  it('does not exclude a file whose name only resembles quant.json', async () => {
    const keep = touch('quantXjson');
    expect(await getFiles(dir)).to.deep.equal([keep]);
  });

  it('excludes QUANT.JSON case-insensitively', async () => {
    touch('QUANT.JSON');
    const keep = touch('ok.txt');
    expect(await getFiles(dir)).to.deep.equal([keep]);
  });

  it('excludes backup, editor and renamed copies of quant.json', async () => {
    [
      'quant.json.bak', 'sub/quant.json.orig', 'sub/Quant.JSON.old', '.quant.json.swp',
      'quant.json~', '#quant.json#', 'quant.json-old', 'quant.json_bak', 'myquant.json'
    ].forEach(touch);
    const keep = touch('ok.txt');
    expect(await getFiles(dir)).to.deep.equal([keep]);
  });

  it('returns a flat array and keeps siblings of an excluded file in a subdirectory', async () => {
    touch('sub/a.map');
    const keep = touch('sub/page.html');
    const keep2 = touch('other.html');
    const files = await getFiles(dir, ['a\\.map']);
    expect(files.every((f) => typeof f === 'string')).to.equal(true);
    expect([...files].sort()).to.deep.equal([keep2, keep].sort());
  });

  it('applies exclusions to consecutive matching paths (no shared lastIndex)', async () => {
    touch('quant.json');
    touch('one.map');
    touch('two.map');
    const keep = touch('keep.html');
    expect(await getFiles(dir, ['\\.map$'])).to.deep.equal([keep]);
  });
});
