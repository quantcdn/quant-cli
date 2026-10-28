import { expect } from 'chai';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const cli = path.join(root, 'cli.js');
const own = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;

describe('quant --version', () => {
  it('prints the CLI version, not the version of a package.json in the working directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-version-'));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'site', version: '9.9.9' }));
    const out = execFileSync(process.execPath, [cli, '--version'], { cwd: dir, encoding: 'utf8' }).trim();
    fs.rmSync(dir, { recursive: true, force: true });
    expect(out).to.equal(own);
  });
});
