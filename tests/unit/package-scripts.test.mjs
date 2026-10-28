import { expect } from 'chai';
import fs from 'node:fs';
import { globSync } from 'glob';

const pkg = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const filesOf = (script) => globSync(/'([^']+)'/.exec(pkg.scripts[script])[1], { posix: true });

// CI runs the conformance suites in their own step, so npm test leaves them out.
describe('package scripts', () => {
  it('npm test runs the unit and integration tests but not the conformance suites', () => {
    const files = filesOf('test');
    expect(files).to.include('tests/unit/serve/server.test.mjs');
    expect(files).to.include('tests/unit/command-loader.test.mjs');
    expect(files).to.include('tests/integration/serve-orbit.test.mjs');
    expect(files.filter((file) => file.startsWith('tests/conformance/'))).to.deep.equal([]);
  });

  it('npm run test:conformance runs the conformance suites', () => {
    expect(filesOf('test:conformance')).to.include('tests/conformance/edge.test.mjs');
  });
});
