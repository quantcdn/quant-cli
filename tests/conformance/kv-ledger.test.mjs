// The @quantcdn/kv-ledger-conformance ledger and proof-timing cases, run
// against the KV that quant serve wires. The runner gives the adapter a
// virtual clock, as --clock manual does.

import assert from 'node:assert/strict';
import { run, cases, SUITE_VERSION } from '@quantcdn/kv-ledger-conformance';
import * as adapter from './kv-adapter.mjs';

const TAGS = ['ledger', 'proof-timing'];
const selected = cases.filter((c) => c.tags.some((tag) => TAGS.includes(tag)));

describe(`kv conformance ledger and proof-timing (suite ${SUITE_VERSION})`, function () {
  this.timeout(600000);
  let report;

  before(async () => {
    report = await run({ adapter, tags: TAGS });
  });

  for (const c of selected) {
    it(c.name, function () {
      const results = report.results.filter((r) => r.name === c.name);
      if (results.every((r) => r.status === 'skip')) this.skip();
      const bad = results.filter((r) => r.status === 'fail' || r.status === 'error');
      assert.deepEqual(bad, []);
    });
  }

  it('runs the ledger and proof-timing cases', () => {
    for (const tag of TAGS) assert.ok(selected.some((c) => c.tags.includes(tag)), `no ${tag} case`);
    assert.equal(report.results.filter((r) => r.status === 'pass').length > 0, true);
  });
});
