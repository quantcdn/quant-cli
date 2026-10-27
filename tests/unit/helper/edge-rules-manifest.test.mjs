import { expect } from 'chai';
import fs from 'node:fs';
import { resolveRules, ruleErrors, toRuntimeRule } from '../../../src/helper/edge-rules-manifest.js';
import { resolveRules as reExported } from '../../../src/commands/rules.js';

const orbit = name => JSON.parse(fs.readFileSync(new URL(`../../fixtures/orbit/quant/${name}`, import.meta.url), 'utf8'));
const UUID = '43aec1f0-095b-4a76-a9c8-934bf3d49d59';
const manifest = (over = {}) => ({ version: 1, namespace: 'orbit', rules: [{ id: 'api', type: 'function', urls: ['/api/*'], weight: 10, function_uuid: UUID, ...over }] });

describe('Edge rules manifest helpers', () => {
  it('keeps resolveRules available from the rules command', () => {
    expect(reExported).to.equal(resolveRules);
  });

  it('accepts a valid rule, mixed-case domains and any', () => {
    expect(ruleErrors(manifest())).to.deep.equal([]);
    expect(ruleErrors(manifest({ domains: ['Example.com', 'any'] }))).to.deep.equal([]);
  });

  it('refuses a wildcard domain', () => {
    expect(ruleErrors(manifest({ domains: ['*.example.com'] }))).to.deep.equal(['Invalid domain matcher.']);
  });

  it('refuses an unknown method', () => {
    expect(ruleErrors(manifest({ methods: ['FETCH'] }))).to.deep.equal(['Invalid HTTP method.']);
  });

  it('refuses a url without a leading slash', () => {
    expect(ruleErrors(manifest({ urls: ['api/*'] }))).to.deep.equal(['Rule URLs must begin with /.']);
  });

  it('refuses an empty urls list', () => {
    expect(ruleErrors(manifest({ urls: [] }))).to.deep.equal(['Invalid urls list.']);
  });

  it('refuses a missing or non-integer weight', () => {
    const message = 'Each rule needs an explicit weight between -100000 and 100000.';
    expect(ruleErrors(manifest({ weight: undefined }))).to.deep.equal([message]);
    expect(ruleErrors(manifest({ weight: 1.5 }))).to.deep.equal([message]);
    expect(ruleErrors(manifest({ weight: 100001 }))).to.deep.equal([message]);
  });

  it('refuses an unknown rule field such as a domain typo', () => {
    expect(ruleErrors(manifest({ domain: ['a.com'] }))).to.deep.equal(['Unknown rules manifest fields.']);
  });

  it('refuses an unknown top-level key', () => {
    expect(ruleErrors({ ...manifest(), extra: 1 })).to.deep.equal(['Unknown rules manifest fields.']);
  });

  it('refuses a disabled value that is not boolean', () => {
    expect(ruleErrors(manifest({ disabled: 'true' }))).to.deep.equal(['disabled must be boolean.']);
  });

  it('refuses a rule name with a control character or over 200 characters', () => {
    expect(ruleErrors(manifest({ name: 'a\nb' }))).to.deep.equal(['Invalid rule name.']);
    expect(ruleErrors(manifest({ name: 'a'.repeat(201) }))).to.deep.equal(['Invalid rule name.']);
    expect(ruleErrors(manifest({ name: 'Orbit API' }))).to.deep.equal([]);
  });

  it('lowercases domain matchers for the runtime', () => {
    expect(toRuntimeRule(manifest({ domains: ['Example.com', 'Any'] }).rules[0]).domain).to.deep.equal(['example.com', 'any']);
  });

  it('converts the Orbit api rule for the runtime', () => {
    const functions = orbit('edge-functions.json');
    const [rule] = resolveRules(orbit('edge-rules.json'), functions).rules;
    const runtime = toRuntimeRule(rule);
    expect(runtime).to.include({ id: 'api', type: 'function', weight: 10, disabled: false });
    expect(runtime.domain).to.deep.equal(['any']);
    expect(runtime.methods).to.equal(null);
    expect(runtime.url).to.deep.equal(['/api/*']);
    expect(runtime.fnUuid).to.equal(functions.find(fn => fn.id === 'orbit-api-v1').uuid.toLowerCase());
  });

  it('lowercases the function uuid and keeps explicit matchers', () => {
    const rule = toRuntimeRule({ ...manifest({ methods: ['GET'], domains: ['a.com'], disabled: true, function_uuid: UUID.toUpperCase() }).rules[0] });
    expect(rule).to.include({ fnUuid: UUID, disabled: true });
    expect(rule.methods).to.deep.equal(['GET']);
    expect(rule.domain).to.deep.equal(['a.com']);
  });
});
