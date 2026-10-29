import { expect } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readLedgerFile, LEDGERS_FILE } from '../../../src/serve/kv/ledgers.js';
import { openLocalKv } from '../../../src/serve/kv/wire.js';

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

    it('gives the backend error with the store and the entry number', async () => {
      const bad = { ...EVENTS, subjectMode: 'pseudonym' };
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
