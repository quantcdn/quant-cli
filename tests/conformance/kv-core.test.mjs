// The @quantcdn/kv-ledger-conformance core cases, run against the KV that
// quant serve wires.

import assert from 'node:assert/strict';
import { run, cases, SUITE_VERSION } from '@quantcdn/kv-ledger-conformance';
import * as adapter from './kv-adapter.mjs';

const core = cases.filter((c) => c.tags.includes('core'));

describe(`kv conformance core (suite ${SUITE_VERSION})`, function () {
  this.timeout(600000);
  let report;

  before(async () => {
    report = await run({ adapter, tags: ['core'] });
  });

  for (const c of core) {
    it(c.name, function () {
      const results = report.results.filter((r) => r.name === c.name);
      if (results.every((r) => r.status === 'skip')) this.skip();
      const bad = results.filter((r) => r.status === 'fail' || r.status === 'error');
      assert.deepEqual(bad, []);
    });
  }

  it('runs the core cases', () => {
    assert.ok(core.length > 0);
    assert.equal(report.results.filter((r) => r.status === 'pass').length > 0, true);
  });
});
