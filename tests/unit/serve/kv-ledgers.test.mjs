import { expect } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readLedgerFile, LEDGERS_FILE } from '../../../src/serve/kv/ledgers.js';
import { openLocalKv } from '../../../src/serve/kv/wire.js';
import { createVirtualClock, LIMITS } from '@quantcdn/edge-kv';

const STORES = [{ name: 'audit', indexes: [], initialValues: [] }, { name: 'other', indexes: [], initialValues: [] }];
const ID = 'acme-site-audit';
const EVENTS = { name: 'events', collection: 'events', chains: 1, retentionDays: 30 };

function failure(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  throw new Error('must fail');
}

async function asyncFailure(promise) {
  try {
    await promise;
  } catch (err) {
    return err;
  }
  throw new Error('must fail');
}

describe('quant serve local ledgers', () => {
  let tmp;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-kv-ledgers-'));
    fs.mkdirSync(path.join(tmp, 'quant'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function writeLedgers(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    fs.writeFileSync(path.join(tmp, LEDGERS_FILE), text);
  }

  const read = () => readLedgerFile({ root: tmp, stores: STORES });

  describe('the file', () => {
    it('is quant/kv-ledgers.json', () => {
      expect(LEDGERS_FILE).to.equal('quant/kv-ledgers.json');
    });

    it('declares no ledger when the file is absent', () => {
      expect(read()).to.deep.equal([]);
    });

    it('gives the ledger definitions of each store', () => {
      writeLedgers({ audit: [EVENTS] });
      expect(read()).to.deep.equal([{ store: 'audit', defs: [EVENTS] }]);
    });

    it('refuses invalid JSON with the file name', () => {
      writeLedgers('{');
      expect(failure(read).message).to.match(/^quant\/kv-ledgers\.json: /);
    });

    it('refuses a file that is not an object', () => {
      writeLedgers([EVENTS]);
      expect(failure(read).message).to.equal('quant/kv-ledgers.json must be a JSON object of store names to lists of ledger definitions.');
    });

    it('refuses a store that meta.json does not declare', () => {
      writeLedgers({ missing: [EVENTS] });
      expect(failure(read).message).to.equal('quant/kv-ledgers.json: the store missing is not in quant/meta.json.');
    });

    it('refuses a store value that is not a list', () => {
      writeLedgers({ audit: EVENTS });
      expect(failure(read).message).to.equal('quant/kv-ledgers.json audit: the value must be a list of ledger definitions.');
    });

    it('refuses an entry that is not an object', () => {
      writeLedgers({ audit: [EVENTS, 'events'] });
      expect(failure(read).message).to.equal('quant/kv-ledgers.json audit entry 2: the entry must be an object.');
    });
  });

  describe('declaration', () => {
    function open(over = {}) {
      return openLocalKv({ root: tmp, org: 'acme', project: 'site', stores: STORES, ledgers: [{ store: 'audit', defs: [EVENTS] }], ...over });
    }

    it('declares the ledgers ACTIVE at start', async () => {
      const { kvStore } = await open({ memory: true });
      const receipt = await kvStore.append(ID, 'events', { what: 'login' });
      expect(receipt.seq).to.equal(1);
      expect((await kvStore.ledgerStatus(ID, 'events')).state).to.equal('ACTIVE');
    });

    it('keeps a ledger PENDING on the manual clock until the activation time', async () => {
      const clock = createVirtualClock(Date.UTC(2026, 9, 1));
      const { kvStore, backend } = await open({ memory: true, clock, ledgerWait: false });
      const early = await asyncFailure(kvStore.append(ID, 'events', { what: 'login' }));
      expect(early.code).to.equal('LEDGER_NOT_READY');
      await backend.setClock(backend.now() + LIMITS.ledgerActivationMs);
      const receipt = await kvStore.append(ID, 'events', { what: 'login' });
      expect(receipt.seq).to.equal(1);
    });

    it('clears a stored clock offset before it declares a ledger on the real clock', async () => {
      const manual = await open({ clock: createVirtualClock(Date.now()), ledgerWait: false, ledgers: [] });
      await manual.backend.setClock(manual.backend.now() + 86400000);
      const more = { ...EVENTS, name: 'more', collection: 'more' };
      const real = await open({ realTime: true, ledgers: [{ store: 'audit', defs: [more] }] });
      expect(real.offsetCleared).to.equal(true);
      expect(Math.abs(real.backend.now() - Date.now())).to.be.below(1000);
      const status = await real.kvStore.ledgerStatus(ID, 'more');
      expect(status.state).to.equal('ACTIVE');
      // The test reads the snapshot layout of edge-kv 0.1.1: the definition keeps its createdAt.
      const store = real.backend.snapshot().stores.find((item) => item.id === ID);
      const declared = new Map(store.ledgers).get('more').definition;
      expect(Math.abs(Date.parse(declared.createdAt) - Date.now())).to.be.below(5000);
      expect(real.warnings).to.deep.equal([]);
    });

    it('does not clear the offset without realTime, and says when nothing was cleared', async () => {
      const first = await open({ clock: createVirtualClock(Date.now()), ledgerWait: false, ledgers: [] });
      await first.backend.setClock(first.backend.now() + 86400000);
      const again = await open({ clock: createVirtualClock(Date.now()), ledgerWait: false, ledgers: [] });
      expect(again.offsetCleared).to.equal(false);
      expect(again.backend.now() - Date.now()).to.be.above(86400000 - 5000);
      expect((await open({ realTime: true, ledgers: [] })).offsetCleared).to.equal(true);
      expect((await open({ realTime: true, ledgers: [] })).offsetCleared).to.equal(false);
    });

    it('warns on the real clock about a ledger that a manual session left PENDING', async () => {
      const manual = await open({ clock: createVirtualClock(Date.now()), ledgerWait: false });
      await manual.backend.setClock(manual.backend.now() + 86400000);
      await open({ clock: createVirtualClock(Date.now()), ledgerWait: false, ledgers: [{ store: 'audit', defs: [EVENTS, { ...EVENTS, name: 'more', collection: 'more' }] }] });
      const real = await open({ realTime: true, ledgers: [{ store: 'audit', defs: [EVENTS, { ...EVENTS, name: 'more', collection: 'more' }] }] });
      const text = real.warnings.join('\n');
      expect(text).to.include(`KV store ${ID}: ledger more is pending until `);
      expect(text).to.include('(declared with --clock manual). Run quant serve --reset to declare it again.');
      expect(text).not.to.include('ledger events is pending');
    });

    it('gives the backend error with the store and the entry number', async () => {
      const bad = { ...EVENTS, colour: 'blue' };
      const err = await asyncFailure(open({ memory: true, ledgers: [{ store: 'audit', defs: [EVENTS, bad] }] }));
      expect(err.message).to.equal('quant/kv-ledgers.json audit entry 2: unknown ledger property');
    });

    it('keeps the ledger and its entries after a restart', async () => {
      const first = await open();
      await first.kvStore.append(ID, 'events', { what: 'login' });
      const { kvStore } = await open();
      expect((await kvStore.ledgerStatus(ID, 'events')).shards[0].headSeq).to.equal(1);
    });

    it('warns when the file changes a ledger that the state already has', async () => {
      await open();
      const { warnings } = await open({ ledgers: [{ store: 'audit', defs: [{ ...EVENTS, retentionDays: 60 }] }] });
      expect(warnings.join('\n')).to.include('ledger events');
      expect(warnings.join('\n')).to.include('--reset');
    });

    it('declares the ledgers again after a reset', async () => {
      const first = await open();
      await first.kvStore.append(ID, 'events', { what: 'login' });
      const { kvStore } = await open({ reset: true });
      const status = await kvStore.ledgerStatus(ID, 'events');
      expect(status.state).to.equal('ACTIVE');
      expect(status.shards.every((shard) => shard.headSeq === 0)).to.equal(true);
    });
  });
});
