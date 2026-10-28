import { expect } from 'chai';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { seedStore, resolveDates } from '../../../src/serve/seed.js';
import { openLocalKv } from '../../../src/serve/kv/wire.js';

const ID = 'acme-site-orbit';
const NOW = Date.parse('2026-10-28T00:00:00.000Z');
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const REVEAL = {
  key: 'auth:{sha256}',
  generate: { bytes: 32, reveal: 'once', label: 'Owner access key' },
  value: { name: '{user_name}', role: 'owner', tags: ['{user_name} owns it'] }
};
const NAME_INDEX = { name: 'projectNames', collection: 'workspace:*:project', fields: ['nameKey'], unique: true };

function memoryMarker() {
  const marker = { seeded: false, async mark() { marker.seeded = true; } };
  return marker;
}

describe('quant serve seeding', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-seed-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  async function storeWith(definition) {
    const { kvStore } = await openLocalKv({ root: tmp, org: 'acme', project: 'site', stores: [definition], memory: true });
    return kvStore.open(ID);
  }

  function definition(initialValues = [], indexes = []) {
    return { name: 'orbit', indexes, initialValues };
  }

  function seed(store, def, over = {}) {
    return seedStore(store, {
      definition: def,
      fixturesFile: path.join(tmp, 'kv-fixtures', 'orbit.json'),
      userName: 'Ada',
      keysPath: path.join(tmp, 'orbit.keys'),
      now: () => NOW,
      marker: memoryMarker(),
      ...over
    });
  }

  function writeFixtures(entries) {
    fs.mkdirSync(path.join(tmp, 'kv-fixtures'), { recursive: true });
    const file = path.join(tmp, 'kv-fixtures', 'orbit.json');
    fs.writeFileSync(file, JSON.stringify(entries));
    return file;
  }

  async function failure(promise) {
    try {
      await promise;
    } catch (err) {
      return err;
    }
    throw new Error('must fail');
  }

  it('writes initial values only when absent', async () => {
    const def = definition([{ key: 'workspace:studio:settings', value: { name: 'My workspace' } }]);
    const store = await storeWith(def);
    await store.set('workspace:studio:settings', { name: 'Kept' });
    await seed(store, def);
    expect(await store.get('workspace:studio:settings')).to.deep.equal({ name: 'Kept' });
    await store.delete('workspace:studio:settings');
    await seed(store, def);
    expect(await store.get('workspace:studio:settings')).to.deep.equal({ name: 'My workspace' });
  });

  it('reveals a generated key once and stores its hash key', async () => {
    const def = definition([REVEAL]);
    const store = await storeWith(def);
    const keysPath = path.join(tmp, 'orbit.keys');
    const { revealed } = await seed(store, def, { keysPath });
    expect(revealed).to.have.length(1);
    expect(revealed[0].label).to.equal('Owner access key');
    expect(revealed[0].value).to.match(/^[0-9a-f]{64}$/);
    expect(await store.get(`auth:${sha(revealed[0].value)}`)).to.deep.equal({ name: 'Ada', role: 'owner', tags: ['Ada owns it'] });
    expect(fs.readFileSync(keysPath, 'utf8')).to.include(revealed[0].value);
    expect(fs.statSync(keysPath).mode & 0o777).to.equal(0o600);
  });

  it('stores a generated secret that is not revealed as its random value', async () => {
    const def = definition([{ key: 'cookie-secret', generate: { bytes: 16 } }]);
    const store = await storeWith(def);
    const { revealed } = await seed(store, def);
    expect(revealed).to.deep.equal([]);
    expect(await store.get('cookie-secret')).to.match(/^[0-9a-f]{32}$/);
  });

  it('uses --seed-key for the first reveal', async () => {
    const second = { ...REVEAL, key: 'viewer:{sha256}', generate: { ...REVEAL.generate, label: 'Viewer' } };
    const def = definition([REVEAL, second]);
    const store = await storeWith(def);
    const seedKey = 'ab'.repeat(32);
    const { revealed } = await seed(store, def, { seedKey });
    expect(revealed[0].value).to.equal(seedKey);
    expect(revealed[1].value).to.not.equal(seedKey);
    expect(await store.get(`auth:${sha(seedKey)}`)).to.not.equal(null);
  });

  it('refuses a seed key of the wrong length', async () => {
    const def = definition([REVEAL]);
    const store = await storeWith(def);
    const err = await failure(seed(store, def, { seedKey: 'abcd' }));
    expect(err.message).to.equal('--seed-key must be 64 hex characters');
  });

  it('refuses a seed key that is not hex', async () => {
    const def = definition([REVEAL]);
    const store = await storeWith(def);
    const err = await failure(seed(store, def, { seedKey: 'zz'.repeat(32) }));
    expect(err.message).to.equal('--seed-key must be 64 hex characters');
  });

  it('replaces {user_name} deep in the value', async () => {
    const def = definition([{ key: 'team', value: { lead: { name: '{user_name}', notes: ['hi {user_name}', 3] } } }]);
    const store = await storeWith(def);
    await seed(store, def);
    expect(await store.get('team')).to.deep.equal({ lead: { name: 'Ada', notes: ['hi Ada', 3] } });
  });

  it('resolves $date tokens', () => {
    const value = {
      created: { $date: '-14d' },
      due: { $date: '+6h' },
      at: { $date: 'now' },
      day: { $date: '+6d', format: 'date' },
      list: [{ $date: '-30m' }],
      plain: 'x'
    };
    expect(resolveDates(value, NOW)).to.deep.equal({
      created: '2026-10-14T00:00:00.000Z',
      due: '2026-10-28T06:00:00.000Z',
      at: '2026-10-28T00:00:00.000Z',
      day: '2026-11-03',
      list: ['2026-10-27T23:30:00.000Z'],
      plain: 'x'
    });
  });

  it('refuses a $date offset it does not know', () => {
    expect(() => resolveDates({ a: { $date: 'tomorrow' } }, NOW)).to.throw('$date');
  });

  it('writes fixtures after the initial values, with dates', async () => {
    const def = definition([{ key: 'workspace:studio:settings', value: { name: 'My workspace' } }]);
    writeFixtures([
      { key: 'workspace:studio:settings', value: { name: 'Fixture' } },
      { key: 'workspace:studio:project:1', value: { name: 'One', due: { $date: '+1d', format: 'date' }, owner: '{user_name}' } }
    ]);
    const store = await storeWith(def);
    const result = await seed(store, def);
    expect(result.fixtures).to.equal(2);
    expect(await store.get('workspace:studio:settings')).to.deep.equal({ name: 'My workspace' });
    expect(await store.get('workspace:studio:project:1')).to.deep.equal({ name: 'One', due: '2026-10-29', owner: 'Ada' });
  });

  it('does not seed twice', async () => {
    const def = definition([REVEAL]);
    const store = await storeWith(def);
    const marker = memoryMarker();
    const first = await seed(store, def, { marker });
    expect(marker.seeded).to.equal(true);
    const second = await seed(store, def, { marker });
    expect(first.revealed).to.have.length(1);
    expect(second.revealed).to.deep.equal([]);
  });

  it('names the fixture entry that breaks a unique index', async () => {
    const def = definition([], [NAME_INDEX]);
    const file = writeFixtures([
      { key: 'workspace:a:project:1', value: { nameKey: 'one' } },
      { key: 'workspace:a:project:2', value: { nameKey: 'one' } }
    ]);
    const store = await storeWith(def);
    const err = await failure(seed(store, def));
    expect(err.message).to.match(new RegExp(`^${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} entry 2 \\(workspace:a:project:2\\): `));
  });

  it('refuses a fixture file over 5,000 entries', async () => {
    const def = definition();
    const file = writeFixtures(Array.from({ length: 5001 }, (_v, n) => ({ key: `k${n}`, value: n })));
    const store = await storeWith(def);
    const err = await failure(seed(store, def));
    expect(err.message).to.equal(`${file} has more than 5,000 entries.`);
  });

  it('refuses a fixture file over 1 MiB', async () => {
    const def = definition();
    const file = writeFixtures([{ key: 'big', value: 'x'.repeat(1024 * 1024) }]);
    const store = await storeWith(def);
    const err = await failure(seed(store, def));
    expect(err.message).to.equal(`${file} is larger than 1 MiB.`);
  });

  it('seeds once across restarts and again after reset', async () => {
    const stores = [definition([REVEAL])];
    const opts = { root: tmp, org: 'acme', project: 'site', stores };
    const seedOpts = { fixtures: path.join(tmp, 'kv-fixtures'), userName: 'Ada' };
    const first = await (await openLocalKv(opts)).seed(seedOpts);
    expect(first.revealed).to.have.length(1);
    expect(first.revealed[0].storeId).to.equal(ID);
    const keysFile = path.join(tmp, '.quant', 'kv', `${ID}.keys`);
    expect(fs.readFileSync(keysFile, 'utf8')).to.include(first.revealed[0].value);
    const second = await (await openLocalKv(opts)).seed(seedOpts);
    expect(second.revealed).to.deep.equal([]);
    const third = await (await openLocalKv({ ...opts, reset: true })).seed(seedOpts);
    expect(third.revealed).to.have.length(1);
  });
  it('seeds 5,000 fixture entries on file storage in under 5 s, with one state write', async function () {
    this.timeout(20000);
    const fixtures = path.join(tmp, 'kv-fixtures');
    fs.mkdirSync(fixtures, { recursive: true });
    const entries = Array.from({ length: 5000 }, (_v, n) => ({ key: `item:${n}`, value: { n } }));
    fs.writeFileSync(path.join(fixtures, 'orbit.json'), JSON.stringify(entries));
    const kv = await openLocalKv({ root: tmp, org: 'acme', project: 'site', stores: [definition()] });
    const stateFile = path.join(tmp, '.quant', 'kv', 'state.json');
    const renames = [];
    const rename = fs.renameSync;
    fs.renameSync = (from, to) => { renames.push(to); return rename(from, to); };
    const started = Date.now();
    let result;
    try {
      result = await kv.seed({ fixtures, userName: 'Ada' });
    } finally {
      fs.renameSync = rename;
    }
    const elapsed = Date.now() - started;
    expect(result.fixtures).to.equal(5000);
    expect(elapsed).to.be.below(5000);
    expect(renames.filter((file) => file === stateFile)).to.have.length(1);
    expect(await kv.kvStore.get(ID, 'item:0')).to.deep.equal({ n: 0 });
    const reopened = await openLocalKv({ root: tmp, org: 'acme', project: 'site', stores: [definition()] });
    expect(await reopened.kvStore.get(ID, 'item:4999')).to.deep.equal({ n: 4999 });
    expect((await reopened.seed({ fixtures, userName: 'Ada' })).fixtures).to.equal(0);
  });
  it('uses --seed-key for the first reveal-once entry overall, not once per store', async () => {
    const second = { name: 'billing', indexes: [], initialValues: [REVEAL] };
    const kv = await openLocalKv({ root: tmp, org: 'acme', project: 'site', stores: [definition([REVEAL]), second] });
    const seedKey = 'cd'.repeat(32);
    const { revealed } = await kv.seed({ userName: 'Ada', seedKey });
    expect(revealed.map((key) => key.storeId)).to.deep.equal([ID, 'acme-site-billing']);
    expect(revealed[0].value).to.equal(seedKey);
    expect(revealed[1].value).to.not.equal(seedKey);
  });

  it('checks every fixture file before the first write, so a bad fixture reveals no key', async () => {
    const fixtures = path.join(tmp, 'kv-fixtures');
    fs.mkdirSync(fixtures, { recursive: true });
    const second = { name: 'billing', indexes: [], initialValues: [] };
    fs.writeFileSync(path.join(fixtures, 'billing.json'), JSON.stringify([{ key: 'a', value: { at: { $date: 'soon' } } }]));
    const stores = [definition([REVEAL]), second];
    const opts = { root: tmp, org: 'acme', project: 'site', stores };
    const err = await failure((await openLocalKv(opts)).seed({ fixtures, userName: 'Ada' }));
    expect(err.message).to.include('billing.json entry 1 (a): $date must be');
    expect(err.revealed).to.deep.equal([]);
    expect(fs.existsSync(path.join(tmp, '.quant', 'kv', `${ID}.keys`))).to.equal(false);
    const state = JSON.parse(fs.readFileSync(path.join(tmp, '.quant', 'kv', 'state.json'), 'utf8'));
    expect(JSON.stringify(state)).to.not.include('auth:');
    expect(state.seeded ?? {}).to.deep.equal({});
    fs.writeFileSync(path.join(fixtures, 'billing.json'), JSON.stringify([{ key: 'a', value: { at: { $date: 'now' } } }]));
    const ok = await (await openLocalKv(opts)).seed({ fixtures, userName: 'Ada' });
    expect(ok.revealed).to.have.length(1);
    expect(fs.readFileSync(path.join(tmp, '.quant', 'kv', `${ID}.keys`), 'utf8').trim().split('\n')).to.have.length(1);
  });

  it('checks the size limits of the fixtures before the first write', async () => {
    const fixtures = path.join(tmp, 'kv-fixtures');
    fs.mkdirSync(fixtures, { recursive: true });
    fs.writeFileSync(path.join(fixtures, 'orbit.json'), JSON.stringify([{ key: 'k'.repeat(2100), value: 1 }]));
    const err = await failure((await openLocalKv({ root: tmp, org: 'acme', project: 'site', stores: [definition([REVEAL])] })).seed({ fixtures, userName: 'Ada' }));
    expect(err.message).to.include('orbit.json entry 1');
    expect(err.revealed).to.deep.equal([]);
    expect(fs.existsSync(path.join(tmp, '.quant', 'kv', `${ID}.keys`))).to.equal(false);
  });
});
