// The @quantcdn/edge-conformance rules, static and functions vectors,
// run in process against quant serve.

import { expect } from 'chai';
import { loadCases, run, SUITE_TAGS } from '@quantcdn/edge-conformance';
import { createAdapter } from './in-process-adapter.mjs';

// Documented behaviour that quant serve does not have yet. Each case must
// fail here; when quant serve gets the behaviour, remove the id.
// The auth middleware docs say that a 201 continues to the next rule. quant
// serve runs only the first matching rule, then serves static content.
// The 503 for an auth rule with a missing function has no
// cache-control: no-store in quant serve. The status is still checked by
// rules-auth-missing-function-503-message.
const KNOWN_GAPS = new Set([]);

const cases = await loadCases();

async function runOne(item) {
  const adapter = createAdapter();
  const result = await run({ adapter, cases: [item] });
  return { ...result.cases[0], logs: adapter.logs };
}

describe('edge conformance (in process)', function () {
  this.timeout(10000);

  for (const suite of SUITE_TAGS) {
    describe(suite, () => {
      for (const item of cases.filter((c) => c.suite === suite)) {
        const gap = KNOWN_GAPS.has(item.id);
        it(`${item.id}${gap ? ' (known gap: must fail)' : ''}`, async () => {
          const result = await runOne(item);
          if (gap) {
            expect(result.status, `${item.id} now passes: remove it from KNOWN_GAPS`).to.equal('failed');
          } else {
            expect(result.failures, [item.description, ...result.logs].join('\n')).to.deep.equal([]);
            expect(result.status).to.equal('passed');
          }
        });
      }
    });
  }

  it('runs every case', () => {
    expect(cases.length).to.be.at.least(45);
    for (const id of KNOWN_GAPS) expect(cases.some((c) => c.id === id), id).to.equal(true);
  });
});
