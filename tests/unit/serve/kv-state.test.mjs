import { expect } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { spawnSync } from 'node:child_process';
import { statePaths, ensureQuantDir, withLock, fileStorage, resetState, removeLockIf, writeAtomic, renameWithRetry } from '../../../src/serve/kv/state.js';
import { openLocalKv } from '../../../src/serve/kv/wire.js';

const STORES = [{
  name: 'orbit',
  indexes: [
    { name: 'byStatus', collection: 'workspace:*:project', fields: ['status'], count: true },
    { name: 'byOwner', collection: 'workspace:*:project', fields: ['owner'] }
  ],
  initialValues: []
}];
const ID = 'acme-site-orbit';

const modeOf = (file) => fs.statSync(file).mode & 0o777;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function codeOf(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('must fail');
}

describe('quant serve KV state', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-kv-state-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function open(over = {}) {
    return openLocalKv({ root: tmp, org: 'acme', project: 'site', stores: STORES, ...over });
  }

  describe('files', () => {
    it('keeps one state document, its lock, the backend keys and the revealed keys under .quant/kv', () => {
      const paths = statePaths(tmp);
      const dir = path.join(tmp, '.quant', 'kv');
      expect(paths.dir).to.equal(dir);
      expect(paths.file).to.equal(path.join(dir, 'state.json'));
      expect(paths.lock).to.equal(path.join(dir, 'state.lock'));
      expect(paths.backendKeys).to.equal(path.join(dir, 'backend-keys.json'));
      expect(paths.revealKeys(ID)).to.equal(path.join(dir, `${ID}.keys`));
    });

    it('creates .quant with a .gitignore that ignores everything', () => {
      ensureQuantDir(tmp);
      expect(fs.readFileSync(path.join(tmp, '.quant', '.gitignore'), 'utf8')).to.equal('*\n');
      expect(fs.statSync(path.join(tmp, '.quant', 'kv')).isDirectory()).to.equal(true);
    });

    it('writes the state and the backend keys with mode 0600', async () => {
      const { kvStore } = await open();
      await kvStore.set(ID, 'workspace:a:project:1', { status: 'active' });
      const paths = statePaths(tmp);
      expect(modeOf(paths.file)).to.equal(0o600);
      expect(modeOf(paths.backendKeys)).to.equal(0o600);
      expect(fs.existsSync(paths.lock)).to.equal(false);
    });

    it('keeps the data after a restart', async () => {
      const first = await open();
      await first.kvStore.set(ID, 'settings', { name: 'Orbit' });
      const second = await open();
      expect(await second.kvStore.get(ID, 'settings')).to.deep.equal({ name: 'Orbit' });
    });

    it('writes no files with memory', async () => {
      const { kvStore } = await open({ memory: true });
      await kvStore.set(ID, 'settings', { name: 'Orbit' });
      expect(await kvStore.get(ID, 'settings')).to.deep.equal({ name: 'Orbit' });
      expect(fs.existsSync(path.join(tmp, '.quant'))).to.equal(false);
    });

    it('refuses a corrupt state file', async () => {
      const paths = statePaths(tmp);
      ensureQuantDir(tmp);
      fs.writeFileSync(paths.file, '{ not json');
      const err = await codeOf(open());
      expect(err.message).to.equal(`${paths.file} is not valid JSON. Fix it or run quant serve --reset.`);
      expect(fs.readFileSync(paths.file, 'utf8')).to.equal('{ not json');
    });

    it('deletes the state, the backend keys and the revealed keys on reset', async () => {
      const { kvStore } = await open();
      await kvStore.set(ID, 'settings', { name: 'Orbit' });
      const paths = statePaths(tmp);
      fs.writeFileSync(paths.revealKeys(ID), 'key\n');
      await resetState(paths);
      for (const file of [paths.file, paths.backendKeys, paths.revealKeys(ID)]) expect(fs.existsSync(file)).to.equal(false);
      const again = await open();
      expect(await again.kvStore.get(ID, 'settings')).to.equal(null);
    });
  });

  describe('lock', () => {
    it('runs one holder at a time', async () => {
      ensureQuantDir(tmp);
      const lock = statePaths(tmp).lock;
      const order = [];
      const holder = (name) => withLock(lock, async () => {
        order.push(`${name} in`);
        await sleep(30);
        order.push(`${name} out`);
      });
      await Promise.all([holder('a'), holder('b')]);
      expect(order).to.deep.equal(['a in', 'a out', 'b in', 'b out']);
      expect(fs.existsSync(lock)).to.equal(false);
    });

    it('stops after the time limit when another process holds the lock', async () => {
      ensureQuantDir(tmp);
      const lock = statePaths(tmp).lock;
      fs.writeFileSync(lock, '1');
      const err = await codeOf(withLock(lock, async () => {}, { timeoutMs: 100 }));
      expect(err.message).to.include(lock);
    });

    it('takes over a stale lock', async () => {
      ensureQuantDir(tmp);
      const lock = statePaths(tmp).lock;
      fs.writeFileSync(lock, '1');
      const old = new Date(Date.now() - 31000);
      fs.utimesSync(lock, old, old);
      expect(await withLock(lock, async () => 'ran')).to.equal('ran');
    });

    it('takes over at once a lock whose process has ended on this host', async () => {
      ensureQuantDir(tmp);
      const lock = statePaths(tmp).lock;
      const ended = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
      fs.writeFileSync(lock, `${ended.stdout}@${os.hostname()}:0123456789abcdef`);
      expect(await withLock(lock, async () => 'ran', { timeoutMs: 200 })).to.equal('ran');
    });

    it('waits for a lock of an ended process on another host', async () => {
      ensureQuantDir(tmp);
      const lock = statePaths(tmp).lock;
      const ended = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))'], { encoding: 'utf8' });
      fs.writeFileSync(lock, `${ended.stdout}@other-host.example:0123456789abcdef`);
      const err = await codeOf(withLock(lock, async () => {}, { timeoutMs: 100 }));
      expect(err.message).to.include(lock);
    });

    it('waits for a lock of a running process on this host', async () => {
      ensureQuantDir(tmp);
      const lock = statePaths(tmp).lock;
      fs.writeFileSync(lock, `${process.pid}@${os.hostname()}:0123456789abcdef`);
      const err = await codeOf(withLock(lock, async () => {}, { timeoutMs: 100 }));
      expect(err.message).to.include(lock);
    });

    it('writes an owner token of pid and random bytes into the lock', async () => {
      ensureQuantDir(tmp);
      const lock = statePaths(tmp).lock;
      const token = await withLock(lock, async () => fs.readFileSync(lock, 'utf8'));
      expect(token).to.equal(`${process.pid}@${os.hostname()}:${token.split(':').pop()}`);
      expect(token.split(':').pop()).to.match(/^[0-9a-f]{16}$/);
    });

    it('does not remove a lock that a later holder took over', async () => {
      ensureQuantDir(tmp);
      const lock = statePaths(tmp).lock;
      await withLock(lock, async () => {
        fs.writeFileSync(lock, 'other:holder');
      });
      expect(fs.readFileSync(lock, 'utf8')).to.equal('other:holder');
    });

    it('removes a stale lock only when it still holds the token judged stale', () => {
      ensureQuantDir(tmp);
      const lock = statePaths(tmp).lock;
      fs.writeFileSync(lock, 'new:holder');
      expect(removeLockIf(lock, 'old:holder')).to.equal(false);
      expect(fs.existsSync(lock)).to.equal(true);
      expect(removeLockIf(lock, 'new:holder')).to.equal(true);
      expect(fs.existsSync(lock)).to.equal(false);
    });

    it('releases the lock when the work throws', async () => {
      ensureQuantDir(tmp);
      const lock = statePaths(tmp).lock;
      const err = await codeOf(withLock(lock, async () => { throw new Error('boom'); }));
      expect(err.message).to.equal('boom');
      expect(fs.existsSync(lock)).to.equal(false);
    });
  });

  describe('atomic write', () => {
    it('flushes the temporary file to disk before the rename', () => {
      ensureQuantDir(tmp);
      const calls = [];
      const { fsyncSync, renameSync } = fs;
      fs.fsyncSync = (fd) => { calls.push('fsync'); return fsyncSync(fd); };
      fs.renameSync = (from, to) => { calls.push('rename'); return renameSync(from, to); };
      try {
        writeAtomic(statePaths(tmp).file, '{}');
      } finally {
        Object.assign(fs, { fsyncSync, renameSync });
      }
      expect(calls).to.deep.equal(['fsync', 'rename']);
      expect(fs.readFileSync(statePaths(tmp).file, 'utf8')).to.equal('{}');
    });

    it('retries a rename that Windows refuses for a short time', () => {
      const { renameSync } = fs;
      let tries = 0;
      fs.renameSync = () => {
        tries += 1;
        if (tries < 3) throw Object.assign(new Error('busy'), { code: tries === 1 ? 'EPERM' : 'EBUSY' });
      };
      try {
        renameWithRetry('a', 'b', 'win32');
      } finally {
        fs.renameSync = renameSync;
      }
      expect(tries).to.equal(3);
    });

    it('does not retry a rename on other systems', () => {
      const { renameSync } = fs;
      let tries = 0;
      fs.renameSync = () => {
        tries += 1;
        throw Object.assign(new Error('denied'), { code: 'EPERM' });
      };
      try {
        expect(() => renameWithRetry('a', 'b', 'linux')).to.throw('denied');
      } finally {
        fs.renameSync = renameSync;
      }
      expect(tries).to.equal(1);
    });
  });

  describe('storage hook', () => {
    it('sees a write that lands while load reads the file', async () => {
      const paths = statePaths(tmp);
      ensureQuantDir(tmp);
      await fileStorage(paths).transaction(async () => ({ v: 1, stores: [], offsetMs: 1 }));
      const reader = fileStorage(paths);
      const { readFileSync } = fs;
      fs.readFileSync = (file, ...rest) => {
        const text = readFileSync(file, ...rest);
        if (file === paths.file) {
          fs.readFileSync = readFileSync;
          writeAtomic(paths.file, JSON.stringify({ v: 1, stores: [], offsetMs: 2 }));
        }
        return text;
      };
      try {
        expect(reader.load().offsetMs).to.equal(1);
      } finally {
        fs.readFileSync = readFileSync;
      }
      expect(reader.changed()).to.equal(true);
    });


    it('loads null when there is no state file', () => {
      ensureQuantDir(tmp);
      expect(fileStorage(statePaths(tmp)).load()).to.equal(null);
    });

    it('sees a same-size write in the same mtime tick (the inode changes)', async () => {
      const paths = statePaths(tmp);
      ensureQuantDir(tmp);
      const tick = new Date(Date.parse('2026-10-28T00:00:00.000Z'));
      const reader = fileStorage(paths);
      await reader.transaction(async () => ({ v: 1, stores: [], offsetMs: 1 }));
      fs.utimesSync(paths.file, tick, tick);
      reader.load();
      expect(reader.changed()).to.equal(false);
      const size = fs.statSync(paths.file).size;
      await fileStorage(paths).transaction(async (fresh) => ({ ...fresh, offsetMs: 2 }));
      fs.utimesSync(paths.file, tick, tick);
      expect(fs.statSync(paths.file).size).to.equal(size);
      expect(reader.changed()).to.equal(true);
    });

    it('sees a change from another writer', async () => {
      const paths = statePaths(tmp);
      ensureQuantDir(tmp);
      const storage = fileStorage(paths);
      expect(storage.changed()).to.equal(false);
      await storage.transaction(async () => ({ v: 1, stores: [] }));
      expect(storage.changed()).to.equal(false);
      await fileStorage(paths).transaction(async (fresh) => ({ ...fresh, offsetMs: 5 }));
      expect(storage.changed()).to.equal(true);
      expect(storage.load().offsetMs).to.equal(5);
    });
  });

  describe('two writers', () => {
    it('two processes write the same store without a lost update', async function () {
      this.timeout(30000);
      const a = await open();
      const b = await open();
      const bump = (kv) => Array.from({ length: 50 }, () => kv.kvStore.increment(ID, 'hits', 1));
      await Promise.all([...bump(a), ...bump(b)]);
      expect(await a.kvStore.get(ID, 'hits')).to.equal(100);
      expect(await b.kvStore.get(ID, 'hits')).to.equal(100);
    });

    it('loses no write when a child process writes at the same time', async function () {
      this.timeout(30000);
      const wire = new URL('../../../src/serve/kv/wire.js', import.meta.url).href;
      const script = `
        const { openLocalKv } = await import(${JSON.stringify(wire)});
        const kv = await openLocalKv({ root: ${JSON.stringify(tmp)}, org: 'acme', project: 'site', stores: ${JSON.stringify(STORES)} });
        await Promise.all(Array.from({ length: 50 }, () => kv.kvStore.increment(${JSON.stringify(ID)}, 'hits', 1)));
      `;
      const a = await open();
      const child = spawn(process.execPath, ['--input-type=module', '-e', script], { stdio: 'inherit' });
      const exited = new Promise((resolve) => child.on('exit', resolve));
      await Promise.all(Array.from({ length: 50 }, () => a.kvStore.increment(ID, 'hits', 1)));
      expect(await exited).to.equal(0);
      expect(await a.kvStore.get(ID, 'hits')).to.equal(100);
    });

    it('reads a write of the other process', async () => {
      const a = await open();
      const b = await open();
      await a.kvStore.set(ID, 'settings', { name: 'A' });
      expect(await b.kvStore.get(ID, 'settings')).to.deep.equal({ name: 'A' });
    });
  });

  describe('stores and indexes', () => {
    it('refuses a store that meta.json does not declare', async () => {
      const { kvStore } = await open({ memory: true });
      const err = await codeOf(kvStore.get('acme-site-other', 'k'));
      expect(err.code).to.equal('FORBIDDEN');
      expect(err.message).to.equal('Access to KV store acme-site-other is not allowed');
    });

    it('declares the indexes ACTIVE by default', async () => {
      const { kvStore } = await open({ memory: true });
      await kvStore.set(ID, 'workspace:a:project:1', { status: 'active', owner: 'ada' });
      expect(await kvStore.count(ID, { index: 'byStatus', equals: { status: 'active' } })).to.equal(1);
    });

    it('keeps the indexes BUILDING with --indexes building', async () => {
      const { kvStore } = await open({ memory: true, indexState: 'building' });
      const err = await codeOf(kvStore.count(ID, { index: 'byStatus', equals: { status: 'active' } }));
      expect(err.code).to.equal('INDEX_NOT_READY');
    });

    it('makes held BUILDING indexes ACTIVE again on the next default start', async () => {
      await open({ indexState: 'building' });
      const { kvStore } = await open({ indexState: 'active' });
      expect(await kvStore.count(ID, { index: 'byStatus', equals: { status: 'active' } })).to.equal(0);
    });

    it('delays index lists by --kv-lag', async () => {
      const { kvStore } = await open({ memory: true, lagMs: 150 });
      await kvStore.set(ID, 'workspace:a:project:1', { status: 'active', owner: 'ada' });
      const keys = async () => (await kvStore.list(ID, { index: 'byOwner', equals: { owner: 'ada' } })).items.map((i) => i.key);
      expect(await keys()).to.deep.equal([]);
      await sleep(200);
      expect(await keys()).to.deep.equal(['workspace:a:project:1']);
    });

    it('warns when meta.json changes an index that the state already has', async () => {
      await open();
      const changed = [{ ...STORES[0], indexes: [{ ...STORES[0].indexes[0], fields: ['owner'] }, STORES[0].indexes[1]] }];
      const { warnings } = await open({ stores: changed });
      expect(warnings.join('\n')).to.include('byStatus');
      expect(warnings.join('\n')).to.include('--reset');
    });
  });
});
