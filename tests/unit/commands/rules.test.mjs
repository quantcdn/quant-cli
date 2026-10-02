import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'node:fs';
import axios from 'axios';
import rules, { resolveRules, rulesOptions } from '../../../src/commands/rules.js';
import { functionUuid } from '../../../src/helper/function-identity.js';
const manifest = () => ({ version: 1, namespace: 'orbit', rules: [{ id: 'api', type: 'function', urls: ['/api/*'], weight: 0, function_ref: 'orbit-api-v1' }] });
const functions = [{ id: 'orbit-api-v1', type: 'function', path: 'api.js' }];
describe('Rules deployment', () => {
  afterEach(() => sinon.restore());
  it('resolves stable per-project function references', () => {
    const result = resolveRules(manifest(), functions, 'org', 'site');
    expect(result.rules[0].function_uuid).to.equal(functionUuid('org', 'site', 'orbit-api-v1'));
    expect(result.rules[0]).not.to.have.property('function_ref');
    expect(result.rules[0].function_uuid).not.to.equal(functionUuid('org', 'other', 'orbit-api-v1'));
  });
  it('rejects unknown references, duplicate ids and auth/function mismatches', () => {
    expect(() => resolveRules(manifest(), [], 'org', 'site')).to.throw('Unknown');
    const m = manifest(); m.rules.push(m.rules[0]);
    expect(() => resolveRules(m, functions, 'org', 'site')).to.throw('unique');
    const a = manifest(); a.rules[0].type = 'auth';
    expect(() => resolveRules(a, functions, 'org', 'site')).to.throw('does not match');
  });
  it('never falls back to a content token or upload endpoint', () => {
    sinon.stub(fs, 'readFileSync').returns(JSON.stringify({ token: 'saved-content', endpoint: 'https://upload.test/v1' }));
    expect(() => rulesOptions({ c: 'org', p: 'site', t: 'content-token' }, { QUANT_TOKEN: 'env-content', QUANT_ENDPOINT: 'https://upload.test/v1' })).to.throw('QUANT_API_TOKEN');
    expect(() => rulesOptions({ c: 'org', p: 'site', 'api-token': 'scoped', 'api-base-url': 'https://upload.test/v1' }, {})).to.throw('portal');
  });
  it('posts only the scoped bearer token to the explicit portal and disables redirects', async () => {
    sinon.stub(fs, 'readFileSync').callsFake(path => path === 'rules.json' ? JSON.stringify(manifest()) : path === 'functions.json' ? JSON.stringify(functions) : '{}');
    const post = sinon.stub(axios, 'post').resolves({ data: { namespace: 'orbit', rules: [{ id: 'api', status: 'created' }] } });
    sinon.stub(console, 'log');
    await rules.handler({ file: 'rules.json', functions: 'functions.json', c: 'org', p: 'site', 'api-token': 'scoped-secret', 'api-base-url': 'https://portal.test/api/v2', 'dry-run': true, token: 'content-secret' });
    expect(post.firstCall.args[0]).to.equal('https://portal.test/api/v2/organizations/org/projects/site/rules/deploy');
    expect(post.firstCall.args[2].headers).to.deep.equal({ Authorization: 'Bearer scoped-secret', Accept: 'application/json' });
    expect(post.firstCall.args[2].params).to.deep.equal({ dry_run: 1 });
    expect(post.firstCall.args[2].maxRedirects).to.equal(0);
  });
  it('does not print tokens from upstream errors', async () => {
    sinon.stub(fs, 'readFileSync').callsFake(path => path === 'rules.json' ? JSON.stringify(manifest()) : path === 'functions.json' ? JSON.stringify(functions) : '{}');
    sinon.stub(axios, 'post').rejects({ response: { status: 403, data: 'scoped-secret' }, message: 'scoped-secret' });
    try { await rules.handler({ file: 'rules.json', functions: 'functions.json', c: 'org', p: 'site', 'api-token': 'scoped-secret', 'api-base-url': 'https://portal.test/api/v2' }); expect.fail('must fail'); }
    catch (error) { expect(error.message).to.include('403').and.not.to.include('scoped-secret'); }
  });
  const run = (extra = {}) => rules.handler({ file: 'rules.json', functions: 'functions.json', c: 'org', p: 'site', 'api-token': 'scoped-secret', 'api-base-url': 'https://portal.test/api/v2', ...extra });
  const files = () => sinon.stub(fs, 'readFileSync').callsFake(path => path === 'rules.json' ? JSON.stringify(manifest()) : path === 'functions.json' ? JSON.stringify(functions) : '{}');
  it('sends force only when asked and accepts a forced overwrite', async () => {
    files();
    const post = sinon.stub(axios, 'post').resolves({ data: { namespace: 'orbit', rules: [{ id: 'api', status: 'forced' }] } });
    const log = sinon.stub(console, 'log');
    expect(await run({ force: true })).to.equal('Rules deployed successfully');
    expect(post.firstCall.args[2].params).to.deep.equal({ force: 1 });
    expect(log.calledWith('api: forced')).to.equal(true);
    await run();
    expect(post.secondCall.args[2].params).to.deep.equal({});
  });
  it('explains drift without printing values that could hold credentials', async () => {
    files();
    const diff = { url: { live: ['/changed/*'], code: ['/api/*'] }, action_config: { live: { password: 'proxy-secret' }, code: { fn_uuid: 'x' } } };
    sinon.stub(axios, 'post').rejects({ response: { status: 409, data: { message: 'Some managed rules changed outside code.', rules: [{ id: 'api', status: 'drift', diff }] } } });
    const log = sinon.stub(console, 'log');
    try { await run(); expect.fail('must fail'); } catch (error) {
      expect(error.message).to.include('--force').and.not.to.include('check portal URL');
      const printed = log.args.flat().join('\n');
      expect(printed).to.include('api: drift').and.include('url').and.include('/changed/*').and.include('action_config');
      expect(printed + error.message).not.to.include('proxy-secret');
    }
  });
  it('reports a collision as never overwritable, and a busy lock as retryable', async () => {
    files();
    const post = sinon.stub(axios, 'post');
    post.onFirstCall().rejects({ response: { status: 409, data: { message: 'x', rules: [{ id: 'api', status: 'collision' }] } } });
    post.onSecondCall().rejects({ response: { status: 409, data: { error: true, message: 'Rules are being modified. Retry shortly.' } } });
    sinon.stub(console, 'log');
    try { await run({ force: true }); expect.fail('must fail'); } catch (error) { expect(error.message).to.include('does not own'); }
    try { await run(); expect.fail('must fail'); } catch (error) { expect(error.message).to.include('Retry'); }
  });
});
