import { expect } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPortalClient, PortalError } from '../../../src/serve/portal/client.js';
import {
  fromPortalRule, mergeRules, pullGlobalHeaders, pullProject, pullRules,
  HEADERS_READ_WARNING, HEADERS_SCOPE_WARNING, PARTIAL_WARNING
} from '../../../src/serve/portal/pull-rules.js';
import { loadProject } from '../../../src/serve/project.js';
import { resolveOptions, runServe } from '../../../src/commands/serve.js';

const IDS = { customer: 'acme', project: 'site' };
const TOKEN = 'portal-token-never-printed';
const BASE = new URL('http://127.0.0.1:8080/api/v2');

const reply = (status, body) => ({ status, headers: { get: () => null }, json: async () => body });

// A portal client on a fake fetch. `routes` maps a path suffix to a reply.
function fakePortal(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    const found = Object.entries(routes).find(([suffix]) => new URL(url).pathname.endsWith(suffix));
    return found ? found[1] : reply(404);
  };
  return { calls, client: createPortalClient({ base: BASE, token: TOKEN, fetchImpl, sleep: async () => {} }) };
}

// A portal list item in the shape of the per-type lists.
function item(position, action, actionConfig = {}, over = {}) {
  return {
    uuid: `rule-${position}`, rule_id: `rule-${position}`, name: `Rule ${position}`, action, action_config: actionConfig,
    url: ['/a/*'], domain: ['any'], disabled: false, weight: 0, position, managed: false,
    country: 'any', method: 'any', ip: 'any', asn: 'any', ua: 'any', traffic_source: 'any',
    ...over
  };
}

// A runtime rule with an id and weight, for the merge tests.
const runtime = (id, weight, managed = false) => ({ id, weight, managed, url: ['/'], domain: ['any'], action: 'redirect', config: {} });
// A pulled rule that a rules deploy owns: the namespace and the id of its manifest rule.
const deployed = (id, weight, namespace, ruleId) => ({ ...runtime(id, weight, true), deployment: { namespace, id: ruleId } });
// A rule of quant/edge-rules.json with the namespace of the file.
const local = (id, weight, namespace = 'site') => ({ ...runtime(id, weight), namespace });

async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

describe('serve --pull-rules', () => {
  describe('pullRules', () => {
    it('reads the rules list one time, with the rules:read scope', async () => {
      const list = [item(0, 'redirect'), item(1, 'headers')];
      const { calls, client } = fakePortal({ '/organizations/acme/projects/site/rules': reply(200, list) });
      const pulled = await pullRules(client, IDS);
      expect(calls).to.have.length(1);
      expect(pulled.rules).to.deep.equal(list);
      expect(pulled.partial).to.equal(false);
    });

    it('marks a list with gaps in its positions as partial', async () => {
      const { client } = fakePortal({ '/rules': reply(200, [item(0, 'redirect'), item(2, 'headers')]) });
      expect((await pullRules(client, IDS)).partial).to.equal(true);
    });

    it('refuses a response that is not a list of rules with positions', async () => {
      for (const body of [{}, [null], [{ action: 'redirect' }], [{ position: -1 }]]) {
        const { client } = fakePortal({ '/rules': reply(200, body) });
        const error = await failure(pullRules(client, IDS));
        expect(error.message).to.equal('The portal sent a rules list that is not valid.');
      }
    });

    it('names the rules:read scope when the portal answers 403', async () => {
      const { client } = fakePortal({ '/rules': reply(403, { message: 'no' }) });
      const error = await failure(pullRules(client, IDS));
      expect(error).to.be.instanceOf(PortalError);
      expect(error.message).to.equal('QUANT_API_TOKEN lacks the rules:read scope for portal rules.');
    });

    it('names the project when the portal answers 404', async () => {
      const { client } = fakePortal({});
      const error = await failure(pullRules(client, IDS));
      expect(error.message).to.include('site').and.to.include('acme').and.to.include('404');
    });
  });

  describe('fromPortalRule', () => {
    const cases = {
      redirect: { to: '/new', status_code: '302' },
      headers: { headers: { 'x-one': '1' } },
      custom_response: { custom_response_status_code: '200', custom_response_body: 'ok' },
      auth: { auth_user: 'user', auth_pass: 'pass' },
      error_page: { error_page_path: '/404.html', status_codes: ['404'] },
      proxy: { to: 'https://origin.test', only_proxy_404: false },
      edge_fn: { fn_uuid: 'AAAA0000-0000-4000-8000-000000000001' },
      edge_auth: { fn_uuid: 'aaaa0000-0000-4000-8000-000000000002' },
      edge_filter: { fn_uuid: 'aaaa0000-0000-4000-8000-000000000003' },
      robot_challenge: { robot_challenge_type: 'invisible' },
      serve_static_path: { static_file_path: '/a.html' }
    };

    for (const [action, config] of Object.entries(cases)) {
      it(`maps a ${action} rule to the runtime shape`, () => {
        const rule = fromPortalRule(item(3, action, config, { weight: 25 }));
        expect(rule).to.include({ id: 'rule-3', name: 'Rule 3', action, type: action, weight: 25, disabled: false, managed: false });
        expect(rule.url).to.deep.equal(['/a/*']);
        expect(rule.domain).to.deep.equal(['any']);
        expect(rule.methods).to.equal(null);
        expect(rule.config).to.deep.include(action === 'edge_fn' ? {} : config);
      });
    }

    it('takes the function uuid of a function rule, in lowercase', () => {
      expect(fromPortalRule(item(0, 'edge_fn', cases.edge_fn)).fnUuid).to.equal('aaaa0000-0000-4000-8000-000000000001');
      expect(fromPortalRule(item(0, 'redirect', cases.redirect)).fnUuid).to.equal(null);
    });

    it('makes the url and domain lists, and the domains lowercase', () => {
      const rule = fromPortalRule(item(0, 'redirect', {}, { url: '/one', domain: ['Example.COM'] }));
      expect(rule.url).to.deep.equal(['/one']);
      expect(rule.domain).to.deep.equal(['example.com']);
      expect(fromPortalRule(item(0, 'redirect', {}, { domain: [] })).domain).to.deep.equal(['any']);
    });

    it('takes the effective weight of the portal order', () => {
      const weightOf = (weight) => fromPortalRule(item(0, 'redirect', {}, { weight })).weight;
      expect(weightOf(25)).to.equal(25);
      expect(weightOf(-7)).to.equal(-7);
      expect(weightOf('42')).to.equal(42);
      expect(weightOf('-3')).to.equal(-3);
      expect(weightOf('1.0')).to.equal(1);
      expect(weightOf('1e3')).to.equal(1000);
      for (const value of [1.5, '1.5', true, false, 'abc', '', null, undefined, [], {}, Infinity]) {
        expect(weightOf(value), String(value)).to.equal(0);
      }
    });

    it('reads the cookie condition', () => {
      expect(fromPortalRule(item(0, 'redirect', {}, { only_with_cookie: 'session' })).cookie).to.equal('session');
      for (const value of ['', null, undefined, 5]) {
        expect(fromPortalRule(item(0, 'redirect', {}, { only_with_cookie: value })).cookie).to.equal(null);
      }
    });

    it('takes an empty method list as all methods', () => {
      const only = fromPortalRule(item(0, 'redirect', {}, { method: 'method_is', method_is: [] }));
      expect(only.methods).to.equal(null);
      const not = fromPortalRule(item(0, 'redirect', {}, { method: 'method_is_not', method_is_not: [] }));
      expect(not.methodsNot).to.equal(null);
      expect(fromPortalRule(item(0, 'redirect', {}, { method: 'ANY', method_is: ['GET'] })).methods).to.equal(null);
    });

    it('reads the method condition', () => {
      const only = fromPortalRule(item(0, 'redirect', {}, { method: 'method_is', method_is: ['get', 'POST'] }));
      expect(only.methods).to.deep.equal(['GET', 'POST']);
      const not = fromPortalRule(item(0, 'redirect', {}, { method: 'method_is_not', method_is_not: ['DELETE'] }));
      expect(not.methods).to.equal(null);
      expect(not.methodsNot).to.deep.equal(['DELETE']);
    });

    it('skips a rule with a condition that quant serve does not check', () => {
      const rule = fromPortalRule(item(0, 'redirect', {}, { country: 'country_is', country_is: ['AU'] }));
      expect(rule.disabled).to.equal(true);
      expect(rule.unchecked).to.deep.equal(['country']);
      expect(fromPortalRule(item(0, 'redirect')).unchecked).to.deep.equal([]);
    });

    it('takes an empty, any or empty-list condition as no condition', () => {
      for (const over of [{ country: '' }, { country: null }, { country: undefined }, { country: 'ANY' }, { country: 'Any' },
        { country: 'country_is', country_is: [] }, { ip: 'ip_is_not', ip_is_not: [] }, { asn: 'asn_is' }]) {
        const rule = fromPortalRule(item(0, 'redirect', {}, over));
        expect(rule.unchecked, JSON.stringify(over)).to.deep.equal([]);
        expect(rule.disabled).to.equal(false);
      }
      expect(fromPortalRule(item(0, 'redirect', {}, { ua: 'ua_is_not', ua_is_not: ['bot'] })).unchecked).to.deep.equal(['ua']);
    });

    it('makes booleans of boolean settings sent as text', () => {
      const rule = fromPortalRule(item(0, 'proxy', {
        only_proxy_404: 'true', static_error_page: 'false', waf_enabled: '0', disable_ssl_verify: '1', failover_mode: 'false'
      }, { disabled: 'true' }));
      expect(rule.disabled).to.equal(true);
      expect(rule.config).to.include({
        only_proxy_404: true, static_error_page: true, waf_enabled: false, disable_ssl_verify: true, failover_mode: false
      });
      expect(fromPortalRule(item(0, 'redirect', {}, { disabled: '0' })).disabled).to.equal(false);
    });

    it('turns static error pages on for any value that is not empty', () => {
      const staticPages = (value) => fromPortalRule(item(0, 'proxy', { static_error_page: value })).config.static_error_page;
      for (const value of ['yes', 'true', '1', '0', 'off', true]) expect(staticPages(value), String(value)).to.equal(true);
      for (const value of ['', false, null]) expect(staticPages(value), String(value)).to.equal(false);
      expect(fromPortalRule(item(0, 'proxy', {})).config).to.not.have.property('static_error_page');
    });

    it('makes status_codes a list', () => {
      expect(fromPortalRule(item(0, 'error_page', { status_codes: '404' })).config.status_codes).to.deep.equal(['404']);
      expect(fromPortalRule(item(0, 'error_page', { status_codes: 500 })).config.status_codes).to.deep.equal([500]);
      expect(fromPortalRule(item(0, 'error_page', { status_codes: { a: 1 } })).config.status_codes).to.deep.equal([]);
      expect(fromPortalRule(item(0, 'error_page', { status_codes: null })).config.status_codes).to.deep.equal([]);
    });

    it('marks a rule that a template deploy owns', () => {
      expect(fromPortalRule(item(0, 'edge_fn', {}, { managed: true })).managed).to.equal(true);
    });

    it('keeps the deploy namespace and id of a managed rule only', () => {
      const marker = { namespace: 'site', id: 'api', hash: 'sha256:x' };
      expect(fromPortalRule(item(0, 'edge_fn', {}, { managed: true, deployment: marker })).deployment).to.deep.equal({ namespace: 'site', id: 'api' });
      expect(fromPortalRule(item(0, 'edge_fn', {}, { managed: false, deployment: marker })).deployment).to.equal(null);
      expect(fromPortalRule(item(0, 'edge_fn', {}, { managed: true })).deployment).to.equal(null);
      expect(fromPortalRule(item(0, 'edge_fn', {}, { managed: true, deployment: { namespace: 'site', id: 7 } })).deployment).to.equal(null);
    });
  });

  describe('mergeRules', () => {
    const ids = (rules) => rules.map((rule) => rule.id);
    const pulled = [runtime('A', 0), runtime('B', 100), runtime('C', 200)];

    it('puts a local rule before the first pulled rule with a higher weight', () => {
      expect(ids(mergeRules(pulled, [runtime('M', 150)]))).to.deep.equal(['A', 'B', 'M', 'C']);
    });

    it('keeps a pulled rule of the same weight first', () => {
      expect(ids(mergeRules(pulled, [runtime('M', 100)]))).to.deep.equal(['A', 'B', 'M', 'C']);
    });

    it('puts a local rule with a negative weight first', () => {
      expect(ids(mergeRules(pulled, [runtime('M', -5)]))).to.deep.equal(['M', 'A', 'B', 'C']);
    });

    it('puts a local rule with a weight higher than all last', () => {
      expect(ids(mergeRules(pulled, [runtime('M', 500)]))).to.deep.equal(['A', 'B', 'C', 'M']);
    });

    it('keeps the pulled order and puts the local rules in weight order', () => {
      const unsorted = [runtime('A', 300), runtime('B', 100)];
      expect(ids(mergeRules(unsorted, [runtime('N', 200), runtime('M', 50)]))).to.deep.equal(['M', 'N', 'A', 'B']);
      expect(ids(mergeRules(unsorted, [runtime('M', 50), runtime('N', 50)]))).to.deep.equal(['M', 'N', 'A', 'B']);
    });

    it('keeps every pulled managed rule when there is no local rule', () => {
      const withManaged = [runtime('A', 0), deployed('old', 150, 'site', 'api'), runtime('C', 200), deployed('late', 50, 'site', 'web')];
      expect(ids(mergeRules(withManaged, []))).to.deep.equal(['A', 'old', 'C', 'late']);
    });

    it('keeps a managed rule that the local file no longer lists', () => {
      const withManaged = [runtime('A', 0), deployed('gone', 150, 'site', 'gone'), runtime('C', 200)];
      expect(ids(mergeRules(withManaged, [local('api', 100)]))).to.deep.equal(['A', 'api', 'gone', 'C']);
    });

    it('keeps the managed rules of another namespace', () => {
      const withManaged = [runtime('A', 0), deployed('other', 150, 'shop', 'api'), runtime('C', 200)];
      expect(ids(mergeRules(withManaged, [local('api', 150)]))).to.deep.equal(['A', 'other', 'api', 'C']);
    });

    it('replaces the pulled copy of a local rule at its local weight', () => {
      const withManaged = [runtime('A', 0), deployed('old-api', 150, 'site', 'api'), runtime('C', 200)];
      expect(ids(mergeRules(withManaged, [local('api', 250)]))).to.deep.equal(['A', 'C', 'api']);
      expect(ids(mergeRules(withManaged, [local('api', 150)]))).to.deep.equal(['A', 'api', 'C']);
    });

    it('keeps a managed rule with no deployment marker', () => {
      const withManaged = [runtime('A', 0), runtime('old', 150, true)];
      expect(ids(mergeRules(withManaged, [local('old', 150)]))).to.deep.equal(['A', 'old', 'old']);
    });

  });

  describe('pullGlobalHeaders', () => {
    it('reads the project headers with the projects:read scope', async () => {
      const { calls, client } = fakePortal({ '/organizations/acme/projects/site/custom-headers': reply(200, { 'X-Frame-Options': 'DENY' }) });
      expect(await pullGlobalHeaders(client, IDS)).to.deep.equal({ 'X-Frame-Options': 'DENY' });
      expect(calls).to.have.length(1);
    });

    it('warns and gives null when the token lacks projects:read', async () => {
      const warnings = [];
      const { client } = fakePortal({ '/custom-headers': reply(403, {}) });
      expect(await pullGlobalHeaders(client, { ...IDS, warn: (line) => warnings.push(line) })).to.equal(null);
      expect(warnings).to.deep.equal([HEADERS_SCOPE_WARNING]);
      expect(HEADERS_SCOPE_WARNING).to.equal('QUANT_API_TOKEN cannot read project headers (projects:read), so the portal\'s global headers are not used.');
    });

    it('warns and gives null when the portal fails or does not answer', async () => {
      expect(HEADERS_READ_WARNING).to.equal('The portal\'s global headers could not be read, so they are not used.');
      for (const status of [500, 502, 503]) {
        const warnings = [];
        const { client } = fakePortal({ '/custom-headers': reply(status, { message: 'down' }) });
        expect(await pullGlobalHeaders(client, { ...IDS, warn: (line) => warnings.push(line) }), String(status)).to.equal(null);
        expect(warnings).to.deep.equal([HEADERS_READ_WARNING]);
      }
      const warnings = [];
      const down = createPortalClient({ base: BASE, token: TOKEN, fetchImpl: async () => { throw new Error('offline'); } });
      expect(await pullGlobalHeaders(down, { ...IDS, warn: (line) => warnings.push(line) })).to.equal(null);
      expect(warnings).to.deep.equal([HEADERS_READ_WARNING]);
    });

    it('still stops on a refused token or a body that is not valid', async () => {
      const refused = await failure(pullGlobalHeaders(fakePortal({ '/custom-headers': reply(401, {}) }).client, IDS));
      expect(refused.status).to.equal(401);
      const invalid = await failure(pullGlobalHeaders(fakePortal({ '/custom-headers': reply(200, 'x') }).client, IDS));
      expect(invalid.message).to.equal('The portal sent project headers that are not valid.');
    });

    it('takes an empty list as no headers', async () => {
      const { client } = fakePortal({ '/custom-headers': reply(200, []) });
      expect(await pullGlobalHeaders(client, IDS)).to.deep.equal({});
    });
  });

  describe('pullProject', () => {
    it('gives the runtime rules, the counts, the headers and one partial warning', async () => {
      const list = [item(0, 'redirect'), item(2, 'edge_fn', {}, { managed: true }), item(4, 'headers', {}, { ip: 'ip_is', ip_is: ['1.2.3.4'] })];
      const { calls, client } = fakePortal({ '/rules': reply(200, list), '/custom-headers': reply(200, { 'x-a': '1' }) });
      const pulled = await pullProject(client, IDS);
      expect(calls).to.have.length(2);
      expect(pulled.count).to.equal(3);
      expect(pulled.headers).to.deep.equal({ 'x-a': '1' });
      expect(pulled.rules.map((rule) => rule.id)).to.deep.equal(['rule-0', 'rule-2', 'rule-4']);
      expect(pulled.warnings.filter((line) => line === PARTIAL_WARNING)).to.have.length(1);
      expect(PARTIAL_WARNING).to.equal('Some rule types are not in the portal response for this organisation, so they do not run locally.');
      expect(pulled.warnings).to.include('Rule Rule 4: the ip condition is not checked in quant serve, so the rule is skipped.');
    });
  });

  describe('local rules over a pull', () => {
    const FN_UUID = 'bbbb0000-0000-4000-8000-0000000000bb';
    let tmp;
    beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-pull-local-')); });
    afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

    const pulled = () => [
      fromPortalRule(item(0, 'redirect', {}, { uuid: 'a', weight: 0 })),
      fromPortalRule(item(1, 'edge_fn', { fn_uuid: FN_UUID }, { uuid: 'm1', weight: 100, managed: true, deployment: { namespace: 'site', id: 'api', hash: 'h' } })),
      fromPortalRule(item(2, 'edge_fn', { fn_uuid: FN_UUID }, { uuid: 'm2', weight: 150, managed: true, deployment: { namespace: 'site', id: 'gone', hash: 'h' } })),
      fromPortalRule(item(3, 'redirect', {}, { uuid: 'c', weight: 200 }))
    ];

    it('runs the pulled list unchanged when there is no local rules file', () => {
      const project = loadProject({ root: tmp, pulledRules: pulled() });
      expect(project.rules.map((rule) => rule.id)).to.deep.equal(['a', 'm1', 'm2', 'c']);
      expect(project.localRules).to.equal(0);
    });

    it('replaces only the pulled rule of the same namespace and id', () => {
      fs.mkdirSync(path.join(tmp, 'quant', 'edge-functions'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'quant', 'edge-functions', 'api.js'), 'return new Response(\'api\');');
      fs.writeFileSync(path.join(tmp, 'quant', 'edge-functions.json'), JSON.stringify([{ id: 'api', uuid: FN_UUID, type: 'function', path: 'quant/edge-functions/api.js', description: 'api' }]));
      fs.writeFileSync(path.join(tmp, 'quant', 'edge-rules.json'), JSON.stringify({ version: 1, namespace: 'site', rules: [
        { id: 'api', type: 'function', urls: ['/api/*'], weight: 175, function_uuid: FN_UUID }
      ] }));
      const project = loadProject({ root: tmp, pulledRules: pulled() });
      expect(project.rules.map((rule) => rule.id)).to.deep.equal(['a', 'm2', 'api', 'c']);
      expect(project.rules[2].namespace).to.equal('site');
      expect(project.localRules).to.equal(1);
    });
  });

  describe('global headers from a pull', () => {
    let tmp;
    beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-pull-headers-')); });
    afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

    it('uses the pulled headers as the base and lets quant/serve.json override them', () => {
      fs.mkdirSync(path.join(tmp, 'quant'));
      fs.writeFileSync(path.join(tmp, 'quant', 'serve.json'), JSON.stringify({ globalHeaders: { 'X-Shared': 'local' } }));
      const project = loadProject({ root: tmp, pulledHeaders: { 'x-shared': 'pv-shared', 'X-Portal': 'pv-portal', age: '9' } });
      expect(new Map(project.settings.globalHeaders)).to.deep.equal(new Map([['x-portal', 'pv-portal'], ['x-shared', 'local']]));
      expect(project.warnings).to.include('quant/serve.json globalHeaders.x-shared replaces the portal global header of the same name.');
      expect(project.warnings.join('\n')).not.to.include('pv-');
    });

    it('keeps the local headers only when there is no pull', () => {
      const project = loadProject({ root: tmp });
      expect(project.settings.globalHeaders).to.deep.equal([]);
    });
  });

  describe('runServe', function () {
    this.timeout(15000);
    const PASSWORD = 'pulled-password-never-printed';
    const SECRET = 'pulled-secret-never-printed';
    const HEADER_SECRET = 'pulled-header-never-printed';
    const FN = 'aaaa0000-0000-4000-8000-0000000000aa';
    let tmp;

    beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-pull-serve-')); });
    afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

    function writeJson(file, value) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(value, null, 2));
    }

    function localRules(url) {
      return { version: 1, namespace: 'test', rules: [
        { id: 'local-m', name: 'Local M', type: 'function', urls: [url], weight: 150, function_uuid: FN },
        { id: 'local-z', name: 'Local Z', type: 'function', urls: ['/z'], weight: 900, function_uuid: FN }
      ] };
    }

    function projectRoot() {
      const root = path.join(tmp, 'site');
      fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(root, 'dist', 'index.html'), 'home');
      fs.mkdirSync(path.join(root, 'quant', 'edge-functions'), { recursive: true });
      fs.writeFileSync(path.join(root, 'quant', 'edge-functions', 'm.js'), 'return new Response(\'local M\');');
      writeJson(path.join(root, 'quant', 'edge-functions.json'), [{ id: 'm', uuid: FN, type: 'function', path: 'quant/edge-functions/m.js', description: 'm' }]);
      writeJson(path.join(root, 'quant', 'edge-rules.json'), localRules('/m'));
      return root;
    }

    const LIST = [
      item(0, 'redirect', { to: '/moved', status_code: '302' }, { uuid: 'a', name: 'A', url: ['/a'], weight: 0 }),
      item(1, 'auth', { auth_user: 'ada', auth_pass: PASSWORD }, { uuid: 'b', name: 'B', url: ['/staff'], weight: 100 }),
      item(2, 'edge_fn', { fn_uuid: FN }, { uuid: 'old', name: 'Old', url: ['/m'], weight: 150, managed: true, deployment: { namespace: 'test', id: 'local-m', hash: 'h' } }),
      item(4, 'proxy', { to: 'http://127.0.0.1:1$*', inject_headers: { 'x-shared': SECRET }, disable_ssl_verify: 'true' }, { uuid: 'p', name: 'P', url: ['/api/*'], weight: 160 }),
      item(5, 'custom_response', { custom_response_status_code: '200', custom_response_body: 'pulled C' }, { uuid: 'c', name: 'C', url: ['/m', '/n'], weight: 200 }),
      item(6, 'custom_response', { custom_response_status_code: '200', custom_response_body: 'with cookie' }, { uuid: 'k', name: 'K', url: ['/cookie'], weight: 300, only_with_cookie: 'preview' })
    ];

    function portalFetch(calls) {
      return async (url, init) => {
        calls.push({ url: String(url), auth: init.headers.Authorization });
        const { pathname } = new URL(url);
        if (pathname.endsWith('/organizations/acme/projects/site/rules')) return reply(200, LIST);
        if (pathname.endsWith('/organizations/acme/projects/site/custom-headers')) return reply(200, { 'x-portal': HEADER_SECRET });
        return reply(404);
      };
    }

    function filesUnder(dir) {
      return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? filesUnder(full) : [full];
      });
    }

    async function until(check, timeoutMs = 8000) {
      const started = Date.now();
      while (!(await check())) {
        if (Date.now() - started > timeoutMs) throw new Error('timed out');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    it('runs the pulled rules in edge order with the local rules, and keeps them in memory only', async () => {
      const root = projectRoot();
      const calls = [];
      const output = [];
      let stop;
      const stopped = new Promise((resolve) => { stop = resolve; });
      let url;
      const opts = resolveOptions({ dir: 'dist', port: 0, 'pull-rules': true, org: 'acme', project: 'site', watch: true }, { root, gitUserName: () => null });
      const running = runServe(opts, {
        stop: stopped,
        print: (line) => output.push(line),
        log: (line) => output.push(line),
        env: { QUANT_API_TOKEN: TOKEN, QUANT_BASE_URL: 'http://127.0.0.1:8080/api/v2' },
        fetchImpl: portalFetch(calls),
        onListening: (server) => { url = server.url; }
      });
      await until(() => url);
      try {
        expect(calls).to.have.length(2);
        expect(output).to.include('Pulled 6 portal rules (2 from quant/edge-rules.json).');
        expect(output.filter((line) => line.includes(PARTIAL_WARNING))).to.have.length(1);
        expect(output.join('\n')).to.include('Rule P: failover and TLS verification settings work differently in quant serve.');
        expect((await fetch(`${url}/a`, { redirect: 'manual' })).headers.get('location')).to.equal('/moved');
        expect((await fetch(`${url}/staff`)).status).to.equal(401);
        expect(await (await fetch(`${url}/m`)).text()).to.equal('local M');
        expect(await (await fetch(`${url}/n`)).text()).to.equal('pulled C');
        expect((await fetch(`${url}/`)).headers.get('x-portal')).to.equal(HEADER_SECRET);
        expect((await fetch(`${url}/cookie`)).status).to.equal(404);
        expect(await (await fetch(`${url}/cookie`, { headers: { cookie: 'preview=1' } })).text()).to.equal('with cookie');
        expect((await fetch(`${url}/cookie`, { headers: { cookie: 'preview_mode=1' } })).status).to.equal(404);

        // --watch: a change to quant/edge-rules.json merges again, with no new pull.
        await new Promise((resolve) => setTimeout(resolve, 300));
        writeJson(path.join(root, 'quant', 'edge-rules.json'), localRules('/n'));
        await until(async () => (await (await fetch(`${url}/n`)).text()) === 'local M');
        expect(await (await fetch(`${url}/m`)).text()).to.equal('pulled C');
        expect(calls).to.have.length(2);
      } finally {
        stop();
        await running;
      }
      const printed = output.join('\n');
      for (const secret of [TOKEN, PASSWORD, SECRET, HEADER_SECRET]) {
        expect(printed, secret).to.not.include(secret);
        for (const file of filesUnder(root)) expect(fs.readFileSync(file, 'latin1'), `${secret} in ${file}`).to.not.include(secret);
      }
      expect(fs.existsSync(path.join(root, '.quant'))).to.equal(true);
    });

    it('needs a named organisation and project', () => {
      const root = projectRoot();
      expect(() => resolveOptions({ 'pull-rules': true }, { root, gitUserName: () => null }))
        .to.throw('--pull-rules needs the portal organisation and project');
      expect(resolveOptions({ 'pull-rules': true, org: 'acme', project: 'site' }, { root, gitUserName: () => null }).pullRules).to.equal(true);
    });
  });
});
