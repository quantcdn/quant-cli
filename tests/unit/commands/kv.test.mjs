import { expect } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import yargs from 'yargs';
import { openLocalKv } from '../../../src/serve/kv/wire.js';
import { loadProject } from '../../../src/serve/project.js';
import kv, { runKv } from '../../../src/commands/kv.js';
import { runServe, resolveOptions } from '../../../src/commands/serve.js';
import { getCommand, getCommandOptions } from '../../../src/commandLoader.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ORBIT = path.join(HERE, '..', '..', 'fixtures', 'orbit');
const CLI = path.join(HERE, '..', '..', '..', 'cli.js');

function parse(argv) {
  let parsed = null;
  yargs(['kv', ...argv]).command(kv.command, kv.describe, kv.builder, (args) => { parsed = args; }).parseSync();
  return parsed;
}

describe('kv command', () => {
  let root;
  let out;
  let err;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'kv-cmd-'));
    fs.cpSync(ORBIT, root, { recursive: true, filter: (src) => !src.includes(`${path.sep}.quant`) });
    out = [];
    err = [];
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function run(argv) {
    const code = await runKv(parse(argv), { root, print: (line) => out.push(line), error: (line) => err.push(line) });
    return code;
  }

  const lastJson = () => JSON.parse(out[out.length - 1]);

  it('is registered with the menu label', async () => {
    expect(await getCommand('kv')).to.equal(kv);
    expect(getCommandOptions()).to.deep.include({ value: 'kv', label: 'Read and write the local KV store' });
  });

  it('refuses a run without --local', async () => {
    expect(await run(['get', 'orbit', 'a'])).to.equal(1);
    expect(err).to.deep.equal(['Remote KV commands are not available yet. Use --local.']);
    expect(out).to.deep.equal([]);
  });

  it('sets and gets a value with its version', async () => {
    expect(await run(['--local', 'set', 'orbit', 'note:1', '{"text":"hi"}'])).to.equal(0);
    expect(await run(['--local', 'get', 'orbit', 'note:1'])).to.equal(0);
    const entry = lastJson();
    expect(entry.key).to.equal('note:1');
    expect(entry.value).to.deep.equal({ text: 'hi' });
    expect(entry.version).to.match(/^[0-9A-Z]{26}$/);
  });

  it('prints null for a missing key', async () => {
    expect(await run(['--local', 'get', 'orbit', 'nope'])).to.equal(0);
    expect(lastJson()).to.equal(null);
  });

  it('refuses a value that is not JSON', async () => {
    expect(await run(['--local', 'set', 'orbit', 'a', '{oops'])).to.equal(1);
    expect(err[0]).to.match(/^The value is not valid JSON/);
  });

  it('refuses a stale --if-version with CONFLICT', async () => {
    await run(['--local', 'set', 'orbit', 'a', '1']);
    await run(['--local', 'get', 'orbit', 'a']);
    const { version } = lastJson();
    expect(await run(['--local', 'set', 'orbit', 'a', '2', '--if-version', version])).to.equal(0);
    err.length = 0;
    expect(await run(['--local', 'set', 'orbit', 'a', '3', '--if-version', version])).to.equal(1);
    expect(err[0]).to.match(/^CONFLICT: /);
  });

  it('deletes a key', async () => {
    await run(['--local', 'set', 'orbit', 'a', '1']);
    expect(await run(['--local', 'delete', 'orbit', 'a'])).to.equal(0);
    await run(['--local', 'get', 'orbit', 'a']);
    expect(lastJson()).to.equal(null);
  });

  it('lists by prefix and by index', async () => {
    const { stores } = loadProject({ root });
    await openLocalKv({ root, org: 'local', project: 'dev', stores, indexState: 'active' });
    await run(['--local', 'set', 'orbit', 'note:1', '{"n":1}']);
    await run(['--local', 'set', 'orbit', 'note:2', '{"n":2}']);
    await run(['--local', 'set', 'orbit', 'other', '{"n":3}']);
    expect(await run(['--local', 'list', 'orbit', '--prefix', 'note:'])).to.equal(0);
    expect(lastJson().map((item) => item.key).sort()).to.deep.equal(['note:1', 'note:2']);
    await run(['--local', 'set', 'orbit', 'workspace:w1:project:p1', '{"workspace":"w1","status":"active","updatedAt":1}']);
    await run(['--local', 'set', 'orbit', 'workspace:w1:project:p2', '{"workspace":"w1","status":"done","updatedAt":2}']);
    expect(await run(['--local', 'list', 'orbit', '--index', 'projectsByStatus', '--equals', 'workspace=w1', '--equals', 'status=active'])).to.equal(0);
    expect(lastJson().map((item) => item.key)).to.deep.equal(['workspace:w1:project:p1']);
  });

  it('refuses an undeclared store', async () => {
    expect(await run(['--local', 'get', 'ghost', 'a'])).to.equal(1);
    expect(err).to.deep.equal(['FORBIDDEN: Access to KV store local-dev-ghost is not allowed']);
  });

  it('uses the org and project of serve', async () => {
    expect(await run(['--local', '--org', 'acme', '--project', 'site', 'set', 'orbit', 'a', '1'])).to.equal(0);
    const state = JSON.parse(fs.readFileSync(path.join(root, '.quant', 'kv', 'state.json'), 'utf8'));
    expect(JSON.stringify(state)).to.include('acme-site-orbit');
  });

  it('leaves a BUILDING index BUILDING', async () => {
    const { stores } = loadProject({ root });
    const first = await openLocalKv({ root, org: 'local', project: 'dev', stores, indexState: 'BUILDING' });
    const before = first.backend.snapshot().stores[0].indexes.map(([, entry]) => entry.state);
    expect(before).to.include('BUILDING');
    expect(await run(['--local', 'set', 'orbit', 'a', '1'])).to.equal(0);
    const second = await openLocalKv({ root, org: 'local', project: 'dev', stores: [] });
    const after = second.backend.snapshot().stores[0].indexes.map(([, entry]) => entry.state);
    expect(after).to.deep.equal(before);
  });

  it('a write is seen by a running server', async () => {
    let stop;
    const stopped = new Promise((resolve) => { stop = resolve; });
    let url;
    const options = resolveOptions({ dir: 'dist', port: 0 }, { root, gitUserName: () => null });
    const running = runServe(options, { stop: stopped, print: () => {}, log: () => {}, onListening: (server) => { url = server.url; } });
    await new Promise((resolve) => {
      const check = () => (url ? resolve() : setTimeout(check, 20));
      check();
    });
    try {
      expect(await run(['--local', 'set', 'orbit', 'workspace:studio:settings', '{"name":"From the CLI"}'])).to.equal(0);
      const res = await fetch(`${url}/api/workspace`);
      expect((await res.json()).settings.name).to.equal('From the CLI');
    } finally {
      stop();
      await running;
    }
  });

  it('exits 1 from the CLI and prints the error code to stderr', () => {
    const result = spawnSync(process.execPath, [CLI, 'kv', '--local', 'get', 'ghost', 'a'], { cwd: root, encoding: 'utf8' });
    expect(result.status).to.equal(1);
    expect(result.stderr).to.include('FORBIDDEN: Access to KV store local-dev-ghost is not allowed');
    const set = spawnSync(process.execPath, [CLI, 'kv', '--local', 'set', 'orbit', 'a', '{"x":1}'], { cwd: root, encoding: 'utf8' });
    expect(set.status).to.equal(0);
    const get = spawnSync(process.execPath, [CLI, 'kv', '--local', 'get', 'orbit', 'a'], { cwd: root, encoding: 'utf8' });
    expect(JSON.parse(get.stdout).value).to.deep.equal({ x: 1 });
  });
});
