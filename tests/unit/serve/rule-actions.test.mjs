import { expect } from 'chai';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../../src/serve/server.js';
import { actionWarnings } from '../../../src/serve/rule-actions.js';

const PASSWORD = 'pa55-never-printed';
const SECRET = 'origin-secret-never-printed';

let servers;
let upstreams;
let lines;
let tmp;

// A runtime rule as the rule stage reads it.
function rule(action, url, config = {}, over = {}) {
  return { id: `${action}-rule`, name: `${action} rule`, action, config, url, domain: ['any'], methods: null, weight: 0, disabled: false, ...over };
}

function project(files = {}) {
  const root = fs.mkdtempSync(path.join(tmp, 'project-'));
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, 'dist', name)), { recursive: true });
    fs.writeFileSync(path.join(root, 'dist', name), body);
  }
  return root;
}

async function start(pulledRules, files = {}) {
  const server = await startServer({
    root: project(files), dir: 'dist', port: 0, host: '127.0.0.1', org: 'acme', project: 'site',
    pulledRules, log: (line) => lines.push(line)
  });
  servers.push(server);
  return server;
}

function get(server, pathAndQuery, headers = {}) {
  return fetch(`${server.url}${pathAndQuery}`, { headers, redirect: 'manual' });
}

function basic(user, pass) {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;
}

// A local origin that records each request and answers with handler(req).
async function origin(handler) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers, method: req.method });
    handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  upstreams.push(server);
  return { url: `http://127.0.0.1:${server.address().port}`, seen };
}

function echo(req, res) {
  if (req.url.startsWith('/moved')) {
    res.writeHead(302, { location: '/elsewhere' });
    res.end();
    return;
  }
  res.writeHead(201, { 'content-type': 'text/plain', 'x-origin': 'yes', 'x-internal': 'drop-me', connection: 'close' });
  res.end(`origin saw ${req.url}`);
}

describe('serve rule actions', () => {
  beforeEach(() => {
    servers = [];
    upstreams = [];
    lines = [];
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-serve-actions-'));
  });

  afterEach(async () => {
    await Promise.all(servers.map((server) => server.close()));
    await Promise.all(upstreams.map((server) => new Promise((resolve) => {
      server.closeAllConnections();
      server.close(resolve);
    })));
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('redirect', () => {
    it('substitutes $1 from the URL pattern and adds the query string', async () => {
      const server = await start([rule('redirect', ['/blog/*'], { to: '/news/$1', status_code: 302 })]);
      const res = await get(server, '/blog/2026/first-post?page=2');
      expect(res.status).to.equal(302);
      expect(res.headers.get('location')).to.equal('/news/2026/first-post?page=2');
    });

    it('substitutes each * in order', async () => {
      const server = await start([rule('redirect', ['/blogs/*/category/*'], { to: '/categories/$2/$1' })]);
      const res = await get(server, '/blogs/ada/category/maths');
      expect(res.headers.get('location')).to.equal('/categories/maths/ada');
    });

    it('defaults to 301 and substitutes $* with the whole path', async () => {
      const server = await start([rule('redirect', ['/old'], { to: 'https://www.example.com$*' })], { 'old/index.html': 'old' });
      const res = await get(server, '/old');
      expect(res.status).to.equal(301);
      expect(res.headers.get('location')).to.equal('https://www.example.com/old');
    });

    it('keeps $1 as literal text when the pattern has no *', async () => {
      const server = await start([rule('redirect', ['/promo'], { to: '/news/$1', status_code: '308' })]);
      const res = await get(server, '/promo');
      expect(res.status).to.equal(308);
      expect(res.headers.get('location')).to.equal('/news/$1');
    });

    it('does not add the query string when the pattern contains ?', async () => {
      const server = await start([rule('redirect', ['/search?q=*'], { to: '/find/$1' })]);
      const res = await get(server, '/search?q=cats');
      expect(res.headers.get('location')).to.equal('/find/cats');
    });
  });

  describe('headers', () => {
    it('adds the headers of two rules to the static file, the later rule replacing a header', async () => {
      const server = await start([
        rule('headers', ['*'], { headers: { 'x-first': 'one', 'x-shared': 'first', 'set-cookie': 'a=1' } }, { id: 'h1' }),
        rule('headers', ['/about*'], { headers: { 'x-second': 'two', 'x-shared': 'second', 'set-cookie': 'b=2' } }, { id: 'h2', weight: 1 })
      ], { 'about/index.html': '<h1>About</h1>' });
      const res = await get(server, '/about/');
      expect(res.status).to.equal(200);
      expect(await res.text()).to.equal('<h1>About</h1>');
      expect(res.headers.get('x-first')).to.equal('one');
      expect(res.headers.get('x-second')).to.equal('two');
      expect(res.headers.get('x-shared')).to.equal('second');
      expect(res.headers.getSetCookie()).to.deep.equal(['a=1', 'b=2']);
    });

    it('cannot set the quant-server header', async () => {
      const server = await start([rule('headers', ['*'], { headers: { 'quant-server': 'other', age: '9' } })], { 'index.html': 'home' });
      const res = await get(server, '/');
      expect(res.headers.get('quant-server')).to.equal('QuantCDN (quant serve)');
      expect(res.headers.get('age')).to.equal(null);
    });

    it('adds the headers to a response of a rule below it', async () => {
      const server = await start([
        rule('headers', ['*'], { headers: { 'x-policy': 'strict' } }),
        rule('redirect', ['/old'], { to: '/new' }, { weight: 1 })
      ]);
      const res = await get(server, '/old');
      expect(res.status).to.equal(301);
      expect(res.headers.get('x-policy')).to.equal('strict');
    });
  });

  describe('custom response', () => {
    it('answers with the status and body, as text/html', async () => {
      const server = await start([rule('custom_response', ['/gone'], { custom_response_status_code: 410, custom_response_body: '<p>Gone</p>' })]);
      const res = await get(server, '/gone');
      expect(res.status).to.equal(410);
      expect(res.headers.get('content-type')).to.equal('text/html; charset=utf-8');
      expect(await res.text()).to.equal('<p>Gone</p>');
    });

    it('takes the content type from a headers rule above it', async () => {
      const server = await start([
        rule('headers', ['/health'], { headers: { 'content-type': 'application/json' } }),
        rule('custom_response', ['/health'], { custom_response_status_code: '200', custom_response_body: '{"ok":true}' }, { weight: 1 })
      ]);
      const res = await get(server, '/health');
      expect(res.status).to.equal(200);
      expect(res.headers.get('content-type')).to.equal('application/json');
      expect(await res.json()).to.deep.equal({ ok: true });
    });
  });

  describe('basic auth', () => {
    const files = { 'staff/index.html': '<h1>Staff</h1>' };
    const auth = () => rule('auth', ['/staff*'], { auth_user: 'ada', auth_pass: PASSWORD });

    it('answers 401 with a Basic challenge when the credentials are missing', async () => {
      const server = await start([auth()], files);
      const res = await get(server, '/staff/');
      expect(res.status).to.equal(401);
      expect(res.headers.get('www-authenticate')).to.match(/^Basic realm=/);
      expect(await res.text()).to.not.include('Staff');
    });

    it('answers 401 when the credentials are wrong', async () => {
      const server = await start([auth()], files);
      const res = await get(server, '/staff/', { authorization: basic('ada', 'wrong') });
      expect(res.status).to.equal(401);
    });

    it('continues to the static file when the credentials are right', async () => {
      const server = await start([auth()], files);
      const res = await get(server, '/staff/', { authorization: basic('ada', PASSWORD) });
      expect(res.status).to.equal(200);
      expect(await res.text()).to.equal('<h1>Staff</h1>');
    });
  });

  describe('error page', () => {
    it('serves the configured page with the 404 status for a missing static path', async () => {
      const server = await start([
        rule('error_page', ['/fr/*'], { status_codes: ['404'], error_page_path: '/fr/_quant404' })
      ], { 'fr/_quant404/index.html': '<h1>Introuvable</h1>', '_quant404/index.html': '<h1>Not found</h1>' });
      const res = await get(server, '/fr/missing');
      expect(res.status).to.equal(404);
      expect(await res.text()).to.equal('<h1>Introuvable</h1>');
    });

    it('is not run in the rule stage', async () => {
      const server = await start([rule('error_page', ['*'], { status_codes: ['404'], error_page_path: '/oops' })], { 'index.html': 'home', 'oops/index.html': 'oops' });
      const res = await get(server, '/');
      expect(res.status).to.equal(200);
      expect(await res.text()).to.equal('home');
    });

    it('uses /_quant404 for a rule of another status or a page that is not published', async () => {
      const server = await start([
        rule('error_page', ['*'], { status_codes: ['500'], error_page_path: '/oops' }, { id: 'e1' }),
        rule('error_page', ['/b/*'], { status_codes: ['404'], error_page_path: '/not-published' }, { id: 'e2', weight: 1 })
      ], { 'oops/index.html': 'oops', '_quant404/index.html': '<h1>Not found</h1>' });
      expect(await (await get(server, '/a/x')).text()).to.equal('<h1>Not found</h1>');
      const res = await get(server, '/b/x');
      expect(res.status).to.equal(404);
      expect(await res.text()).to.equal('<h1>Not found</h1>');
    });
  });

  describe('proxy', () => {
    it('forwards the path and query to the origin and returns its status, body and headers', async () => {
      const up = await origin(echo);
      const server = await start([rule('proxy', ['/api/*'], { to: `${up.url}$*` })]);
      const res = await get(server, '/api/v1/users?page=2');
      expect(res.status).to.equal(201);
      expect(await res.text()).to.equal('origin saw /api/v1/users?page=2');
      expect(res.headers.get('x-origin')).to.equal('yes');
      expect(res.headers.get('connection')).to.not.equal('close');
      expect(up.seen[0].headers.host).to.equal(new URL(up.url).host);
    });

    it('sends every request to the origin / when to has no placeholder', async () => {
      const up = await origin(echo);
      const server = await start([rule('proxy', ['/api/*'], { to: up.url })]);
      expect(await (await get(server, '/api/x?y=1')).text()).to.equal('origin saw /?y=1');
    });

    it('does not follow an origin redirect', async () => {
      const up = await origin(echo);
      const server = await start([rule('proxy', ['*'], { to: `${up.url}$*` })]);
      const res = await get(server, '/moved');
      expect(res.status).to.equal(302);
      expect(res.headers.get('location')).to.equal('/elsewhere');
      expect(up.seen).to.have.length(1);
    });

    it('sends injected headers and origin credentials, and strips headers', async () => {
      const up = await origin(echo);
      const server = await start([rule('proxy', ['*'], {
        to: `${up.url}$*`,
        auth_user: 'svc',
        auth_pass: PASSWORD,
        inject_headers: { 'x-shared-secret': SECRET },
        proxy_strip_request_headers: ['x-drop'],
        proxy_strip_headers: ['x-internal']
      })]);
      const res = await get(server, '/p', { 'x-drop': '1', 'x-keep': '1' });
      expect(res.headers.get('x-internal')).to.equal(null);
      const seen = up.seen[0].headers;
      expect(seen['x-shared-secret']).to.equal(SECRET);
      expect(seen.authorization).to.equal(basic('svc', PASSWORD));
      expect(seen['x-drop']).to.equal(undefined);
      expect(seen['x-keep']).to.equal('1');
    });

    it('does not inject hop-by-hop or length headers', async () => {
      const up = await origin(echo);
      const inject = {
        'content-length': '999', 'transfer-encoding': 'chunked', connection: 'x-keep', 'keep-alive': '5',
        upgrade: 'websocket', te: 'trailers', trailer: 'x-t', host: 'evil.test', 'x-ok': 'yes'
      };
      const server = await start([rule('proxy', ['*'], { to: `${up.url}$*`, inject_headers: inject })]);
      const res = await get(server, '/p');
      expect(res.status).to.equal(201);
      const seen = up.seen[0].headers;
      expect(seen['x-ok']).to.equal('yes');
      expect(seen.host).to.equal(new URL(up.url).host);
      for (const name of ['transfer-encoding', 'keep-alive', 'upgrade', 'te', 'trailer']) expect(seen[name], name).to.equal(undefined);
      expect(seen['content-length']).to.not.equal('999');
    });

    it('sets cache-control from cache_lifetime', async () => {
      const up = await origin(echo);
      const server = await start([
        rule('proxy', ['/none'], { to: `${up.url}$*`, cache_lifetime: '0' }, { id: 'p0' }),
        rule('proxy', ['/ten'], { to: `${up.url}$*`, cache_lifetime: '600' }, { id: 'p1' })
      ]);
      expect((await get(server, '/none')).headers.get('cache-control')).to.equal('no-store');
      expect((await get(server, '/ten')).headers.get('cache-control')).to.equal('public, max-age=600');
    });

    it('answers the 502 Proxy Error page when the origin does not answer', async () => {
      const up = await origin(echo);
      const dead = up.url;
      await new Promise((resolve) => upstreams.pop().close(resolve));
      const server = await start([rule('proxy', ['*'], { to: `${dead}$*` })]);
      const res = await get(server, '/x');
      expect(res.status).to.equal(502);
      expect(await res.text()).to.include('Proxy Error');
    });

    it('serves /_quant502 when the rule uses static error pages', async () => {
      const up = await origin((req, res) => { res.writeHead(503); res.end('origin down'); });
      const server = await start([rule('proxy', ['/app/*'], {
        to: `${up.url}$*`, static_error_page: 'on', static_error_page_status_codes: ['503']
      })], { '_quant503/index.html': '<h1>Back soon</h1>' });
      const res = await get(server, '/app/x');
      expect(res.status).to.equal(503);
      expect(await res.text()).to.equal('<h1>Back soon</h1>');
    });

    it('never sends the request to a host other than the configured origin', async () => {
      const up = await origin(echo);
      const other = await origin(echo);
      const otherHost = new URL(other.url).host;
      const server = await start([rule('proxy', ['/p/*'], { to: `${up.url}$1` })]);
      const res = await get(server, `/p/@${otherHost}/x`);
      expect(res.status).to.equal(502);
      expect(up.seen).to.have.length(0);
      expect(other.seen).to.have.length(0);
    });

    it('serves the static file for an only_proxy_404 rule when the path exists, else proxies', async () => {
      const up = await origin(echo);
      const server = await start([rule('proxy', ['*'], { to: `${up.url}$*`, only_proxy_404: true })], { 'here/index.html': 'static here' });
      expect(await (await get(server, '/here/')).text()).to.equal('static here');
      const res = await get(server, '/gone');
      expect(await res.text()).to.equal('origin saw /gone');
      expect(res.headers.get('quant-404-proxied')).to.equal('true');
    });
  });

  describe('rules that quant serve does not run', () => {
    it('skips the rule with one warning per rule, and warns once about WAF settings', async () => {
      const up = await origin(echo);
      const rules = [
        rule('bot_challenge', ['*'], {}, { id: 'bc', name: 'Challenge' }),
        rule('serve_static', ['*'], {}, { id: 'ss', name: null }),
        rule('proxy', ['/api/*'], { to: `${up.url}$*`, waf_enabled: true, waf_config: { mode: 'block' } }, { id: 'px', name: 'API' })
      ];
      const server = await start(rules, { 'index.html': 'home' });
      const warnings = server.summary.warnings;
      expect(warnings.filter((w) => w === 'Rule Challenge (bot_challenge) is not available in quant serve and is skipped.')).to.have.length(1);
      expect(warnings.filter((w) => w === 'Rule ss (serve_static) is not available in quant serve and is skipped.')).to.have.length(1);
      expect(warnings.filter((w) => w === 'Rule API: WAF settings are ignored in quant serve.')).to.have.length(1);
      expect(await (await get(server, '/')).text()).to.equal('home');
      expect((await get(server, '/api/x')).status).to.equal(201);
    });

    it('warns that the host setting of a proxy rule is not used', async () => {
      const up = await origin(echo);
      const server = await start([rule('proxy', ['*'], { to: `${up.url}$*`, host: 'origin.example.com' }, { id: 'px', name: 'API' })]);
      expect(server.summary.warnings).to.include('Rule API: the host setting is ignored in quant serve. The origin gets the host of the to URL.');
      expect(server.summary.warnings.join('\n')).to.not.include('origin.example.com');
      await get(server, '/x');
      expect(up.seen[0].headers.host).to.equal(new URL(up.url).host);
    });

    it('warns once, with no value, about failover and TLS verification settings', () => {
      const text = 'Rule API: failover and TLS verification settings work differently in quant serve.';
      const tls = rule('proxy', ['*'], { to: 'https://o.test', disable_ssl_verify: true }, { id: 'a', name: 'API' });
      const failover = rule('proxy', ['*'], { to: 'https://o.test', failover_mode: true }, { id: 'b', name: 'API' });
      const quiet = rule('proxy', ['*'], {
        to: 'https://o.test', disable_ssl_verify: false, failover_mode: false, failover_lifetime: null, failover_origin_status_codes: [],
        notify_config: { slack_webhook: 'https://hooks.test/x' }, proxy_alert_enabled: true, application_proxy: true, application_name: 'app'
      }, { id: 'c', name: 'Quiet' });
      expect(actionWarnings([tls])).to.deep.equal([text]);
      expect(actionWarnings([failover])).to.deep.equal([text]);
      expect(actionWarnings([quiet])).to.deep.equal([]);
      const portalDefault = rule('proxy', ['*'], {
        to: 'https://o.test', failover_mode: false, failover_lifetime: '300', failover_origin_ttfb: '5000', disable_ssl_verify: false
      }, { id: 'd', name: 'Default' });
      expect(actionWarnings([portalDefault])).to.deep.equal([]);
    });

    it('gives one warning for each rule id', () => {
      const twice = rule('bot_challenge', ['*'], {}, { id: 'bc' });
      expect(actionWarnings([twice, twice])).to.deep.equal(['Rule bot_challenge rule (bot_challenge) is not available in quant serve and is skipped.']);
    });
  });

  describe('credentials', () => {
    it('never prints a basic-auth password or a proxy header value', async () => {
      const rules = [
        rule('auth', ['/staff*'], { auth_user: 'ada', auth_pass: PASSWORD }),
        rule('proxy', ['/api/*'], { to: 'http://127.0.0.1:1$*', auth_pass: PASSWORD, inject_headers: { 'x-shared-secret': SECRET, 'x-bad': `bad\n${SECRET}` }, waf_enabled: true }, { id: 'px' }),
        rule('headers', ['/h'], { headers: { 'x-bad': `bad\n${SECRET}` } }, { id: 'hb' }),
        rule('redirect', ['/r'], { to: `/x\n${SECRET}` }, { id: 'rb' }),
        rule('mystery', ['*'], { secret: SECRET }, { id: 'my' })
      ];
      const server = await start(rules);
      await get(server, '/staff', { authorization: basic('ada', 'wrong') });
      await get(server, '/api/x');
      await get(server, '/h');
      await get(server, '/r');
      const printed = [...lines, ...server.summary.warnings].join('\n');
      expect(printed).to.not.include(PASSWORD);
      expect(printed).to.not.include(SECRET);
    });
  });
});
