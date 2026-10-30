// The @quantcdn/kv-ledger-conformance subject-v1 cases (ledger subject
// contract, version 1), run against the KV that quant serve wires.

import assert from 'node:assert/strict';
import { run, cases, SUITE_VERSION } from '@quantcdn/kv-ledger-conformance';
import * as adapter from './kv-adapter.mjs';

const TAGS = ['subject-v1'];
const selected = cases.filter((c) => c.tags.includes('subject-v1'));

describe(`kv conformance subject-v1 (suite ${SUITE_VERSION})`, function () {
  this.timeout(600000);
  let report;

  before(async () => {
    report = await run({ adapter, tags: TAGS, enable: ['subject-v1'] });
  });

  for (const c of selected) {
    it(c.name, function () {
      const results = report.results.filter((r) => r.name === c.name);
      assert.ok(results.length > 0, `no result for ${c.name}`);
      const bad = results.filter((r) => r.status !== 'pass');
      assert.deepEqual(bad, []);
    });
  }

  it('runs the subject-v1 cases', () => {
    assert.ok(selected.length > 0);
  });
});
