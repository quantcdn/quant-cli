import { expect } from 'chai';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loadCommands, getCommand } from '../../src/commandLoader.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', '..', 'cli.js');
const BLOCK = path.join(HERE, '..', 'fixtures', 'block-edge-kv', 'register.mjs');

// Run cli.js in a process where an import of @quantcdn/edge-kv fails with
// BLOCKED_EDGE_KV. A command that does not load edge-kv runs as usual.
function cliWithoutEdgeKv(args) {
  return spawnSync(process.execPath, ['--import', BLOCK, CLI, ...args], { encoding: 'utf8', timeout: 20000 });
}

describe('command loader', () => {
  it('lists every command without loading @quantcdn/edge-kv', () => {
    const result = cliWithoutEdgeKv(['--help']);
    expect(result.stderr).to.not.include('BLOCKED_EDGE_KV');
    expect(result.status).to.equal(0);
    expect(result.stdout).to.include('serve [dir]');
    expect(result.stdout).to.include('kv <action>');
    expect(result.stdout).to.include('deploy');
  });

  it('runs another command without loading @quantcdn/edge-kv', () => {
    const result = cliWithoutEdgeKv(['deploy', '--help']);
    expect(result.stderr).to.not.include('BLOCKED_EDGE_KV');
    expect(result.status).to.equal(0);
  });

  it('loads @quantcdn/edge-kv for serve (the check above can fail)', () => {
    const result = cliWithoutEdgeKv(['serve', '--version-info']);
    expect(result.status).to.not.equal(0);
    expect(result.stderr).to.include('BLOCKED_EDGE_KV');
  });

  it('gives the full serve and kv commands to the command that runs', async () => {
    for (const name of ['serve', 'kv']) {
      const full = (await import(`../../src/commands/${name}.js`)).default;
      const listed = (await loadCommands())[name];
      expect(listed.command).to.equal(full.command);
      expect(listed.describe).to.equal(full.describe);
      expect((await loadCommands([name]))[name]).to.equal(full);
      expect(await getCommand(name)).to.equal(full);
    }
  });
});
