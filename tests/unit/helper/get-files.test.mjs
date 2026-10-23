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
    const files = (await getFiles(dir)).flat(Infinity);
    expect(files).to.deep.equal([keep]);
  });

  it('excludes quant.json at the top level and in subdirectories', async () => {
    touch('quant.json');
    touch('sub/deep/quant.json');
    const keep = touch('sub/page.html');
    const files = (await getFiles(dir)).flat(Infinity);
    expect(files).to.deep.equal([keep]);
  });

  it('does not exclude a file whose name only resembles quant.json', async () => {
    const keep = touch('quantXjson');
    const keep2 = touch('quant.json.bak');
    const files = (await getFiles(dir)).flat(Infinity).sort();
    expect(files).to.deep.equal([keep2, keep].sort());
  });

  it('excludes QUANT.JSON case-insensitively', async () => {
    touch('QUANT.JSON');
    const keep = touch('ok.txt');
    const files = (await getFiles(dir)).flat(Infinity);
    expect(files).to.deep.equal([keep]);
  });

  it('does not drop sibling files when a subdirectory holds a quant.json', async () => {
    touch('sub/quant.json');
    const keep = touch('sub/page.html');
    const keep2 = touch('other.html');
    const files = (await getFiles(dir)).flat(Infinity).sort();
    expect(files).to.deep.equal([keep2, keep].sort());
  });

  it('applies exclusions to consecutive matching paths (no shared lastIndex)', async () => {
    touch('quant.json');
    touch('one.map');
    touch('two.map');
    const keep = touch('keep.html');
    const files = (await getFiles(dir, ['\\.map$'])).flat(Infinity);
    expect(files).to.deep.equal([keep]);
  });
});
