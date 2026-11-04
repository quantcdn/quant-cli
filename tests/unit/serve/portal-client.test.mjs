import { inspect } from 'node:util';
import { expect } from 'chai';
import { rulesOptions } from '../../../src/commands/rules.js';
import { portalOptions, createPortalClient, PortalError } from '../../../src/serve/portal/client.js';

const TOKEN = 'test-token';
const BASE = new URL('http://127.0.0.1:8080/api/v2');

const reply = (status, body, headers = {}) => ({
  status,
  headers: { get: name => headers[name.toLowerCase()] ?? null },
  json: async () => {
    if (body === undefined) throw new Error('no body');
    return body;
  }
});

function setup(responses) {
  const calls = [];
  const waits = [];
  const queue = [...responses];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  const sleep = async ms => { waits.push(ms); };
  return { calls, waits, client: createPortalClient({ base: BASE, token: TOKEN, fetchImpl, sleep }) };
}

async function failure(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error('expected a rejection');
}

describe('portal client', () => {
  describe('portalOptions', () => {
    const args = { c: 'org', p: 'site' };
    const env = { QUANT_API_TOKEN: TOKEN, QUANT_BASE_URL: 'http://127.0.0.1:8080/api/v2/' };

    it('returns the base as a URL with the token, customer and project', () => {
      const options = portalOptions(args, env);
      expect(options.base).to.be.instanceOf(URL);
      expect(options.base.hostname).to.equal('127.0.0.1');
      expect(options).to.include({ token: TOKEN, customer: 'org', project: 'site' });
    });

    it('ignores the token and base flags', () => {
      const flags = { ...args, 'api-token': 'flag-token', 'api-base-url': 'https://other.test/api/v2' };
      const options = portalOptions(flags, env);
      expect(options.token).to.equal(TOKEN);
      expect(options.base.hostname).to.equal('127.0.0.1');
      expect(() => portalOptions(flags, {})).to.throw('QUANT_API_TOKEN');
    });

    it('keeps the flags and the old base string in rulesOptions', () => {
      const flags = { ...args, 'api-token': 'flag-token', 'api-base-url': 'https://example.test/api/v2/' };
      expect(rulesOptions(flags, {})).to.deep.equal({ customer: 'org', project: 'site', token: 'flag-token', base: 'https://example.test/api/v2' });
    });

    it('asks for the missing values', () => {
      expect(() => portalOptions(args, {})).to.throw('QUANT_API_TOKEN');
    });

    it('refuses plain HTTP to a remote host', () => {
      expect(() => portalOptions(args, { ...env, QUANT_BASE_URL: 'http://example.com/api/v2' })).to.throw('HTTPS');
    });
  });

  describe('get', () => {
    it('sends the bearer token and JSON accept header without following redirects', async () => {
      const { client, calls } = setup([reply(200, { ok: true })]);
      const result = await client.get('/organizations/org/rules', { page: 2 });
      expect(result).to.deep.equal({ status: 200, body: { ok: true } });
      expect(calls[0].url).to.equal('http://127.0.0.1:8080/api/v2/organizations/org/rules?page=2');
      expect(calls[0].init.headers.Authorization).to.equal(`Bearer ${TOKEN}`);
      expect(calls[0].init.headers.Accept).to.equal('application/json');
      expect(calls[0].init.redirect).to.equal('manual');
      expect(calls[0].init.signal).to.be.instanceOf(AbortSignal);
    });

    it('waits for Retry-After on 429 and then retries', async () => {
      const { client, waits, calls } = setup([reply(429, {}, { 'retry-after': '3' }), reply(200, { ok: 1 })]);
      const result = await client.get('/x');
      expect(result.status).to.equal(200);
      expect(waits).to.deep.equal([3000]);
      expect(calls).to.have.length(2);
    });

    it('waits 2 seconds on 429 without Retry-After', async () => {
      const { client, waits } = setup([reply(429, {}), reply(200, {})]);
      await client.get('/x');
      expect(waits).to.deep.equal([2000]);
    });

    it('throws a 429 error when the waits pass 30 seconds in total', async () => {
      const { client, waits } = setup([
        reply(429, {}, { 'retry-after': '20' }), reply(429, {}, { 'retry-after': '20' })
      ]);
      const error = await failure(client.get('/x'));
      expect(error).to.be.instanceOf(PortalError);
      expect(error.status).to.equal(429);
      expect(waits).to.deep.equal([20000]);
    });

    it('stops after a bounded number of 429 answers with Retry-After 0', async () => {
      const { client, calls } = setup(Array.from({ length: 500 }, () => reply(429, {}, { 'retry-after': '0' })));
      const error = await failure(client.get('/x'));
      expect(error.status).to.equal(429);
      expect(calls.length).to.be.at.most(125);
    });

    it('uses the default delay for a Retry-After that is not whole seconds', async () => {
      for (const value of ['Wed, 21 Oct 2026 07:28:00 GMT', '1e1', '0x10', '-1']) {
        const { client, waits } = setup([reply(429, {}, { 'retry-after': value }), reply(200, {})]);
        await client.get('/x');
        expect(waits).to.deep.equal([2000]);
      }
    });

    it('throws when a 2xx body is not JSON', async () => {
      const { client } = setup([reply(200, undefined)]);
      const error = await failure(client.get('/x'));
      expect(error).to.be.instanceOf(PortalError);
      expect(error.status).to.equal(200);
      expect(error.message).to.equal('The portal sent a response that is not JSON.');
    });

    it('accepts a 204 without a body', async () => {
      const { client } = setup([reply(204, undefined)]);
      expect(await client.get('/x')).to.deep.equal({ status: 204, body: null });
    });

    it('redacts the token before it cuts the message', async () => {
      const message = `${'a'.repeat(292)}${TOKEN}${'b'.repeat(50)}`;
      const { client } = setup([reply(500, { message })]);
      const error = await failure(client.get('/x'));
      expect(error.message).to.include('[red');
      for (let i = 0; i + 4 <= TOKEN.length; i++) {
        for (let j = i + 4; j <= TOKEN.length; j++) expect(error.message).to.not.include(TOKEN.slice(i, j));
      }
      expect(error.message).to.not.include('test-tok');
    });

    it('does not follow a redirect', async () => {
      const { client, calls } = setup([reply(302, {}, { location: 'http://127.0.0.1:9/' })]);
      const error = await failure(client.get('/x'));
      expect(error.status).to.equal(302);
      expect(calls).to.have.length(1);
      expect(calls[0].init.redirect).to.equal('manual');
    });

    it('turns a timeout into a PortalError without the token', async () => {
      const abort = Object.assign(new Error(`aborted ${TOKEN}`), { name: 'TimeoutError' });
      const { client } = setup([abort]);
      const error = await failure(client.get('/x'));
      expect(error).to.be.instanceOf(PortalError);
      expect(error.message).to.not.include(TOKEN);
    });

    it('stops on 401 and names the token', async () => {
      const { client } = setup([reply(401, { message: 'nope' })]);
      const error = await failure(client.get('/x'));
      expect(error.status).to.equal(401);
      expect(error.message).to.equal('The portal refused QUANT_API_TOKEN (401).');
    });

    it('stops on 403 and names the scope', async () => {
      const { client } = setup([reply(403, {})]);
      const error = await failure(client.get('/x', undefined, { scope: 'rules:read', what: 'the rule list' }));
      expect(error.status).to.equal(403);
      expect(error.message).to.equal('QUANT_API_TOKEN lacks the rules:read scope for the rule list.');
    });

    it('returns the status for 404', async () => {
      const { client } = setup([reply(404, { message: 'gone' })]);
      expect(await client.get('/x')).to.deep.equal({ status: 404 });
    });

    it('throws the status and a cleaned server message for other errors', async () => {
      const long = `bad\u0000\n${'x'.repeat(400)}`;
      const { client } = setup([reply(500, { message: long })]);
      const error = await failure(client.get('/x'));
      expect(error).to.be.instanceOf(PortalError);
      expect(error.status).to.equal(500);
      expect(error.message).to.match(/: bad x+\.\.\.$/);
      expect(error.message.length).to.be.at.most(330);
      expect(error.message).to.not.match(/[\u0000-\u001f]/);
    });

    it('throws with the status alone when the body has no message', async () => {
      const { client } = setup([reply(502, undefined)]);
      const error = await failure(client.get('/x'));
      expect(error.status).to.equal(502);
      expect(error.message).to.include('502');
    });

    it('turns a network failure into a PortalError without status', async () => {
      const { client } = setup([new Error(`connect failed with ${TOKEN}`)]);
      const error = await failure(client.get('/x'));
      expect(error).to.be.instanceOf(PortalError);
      expect(error.status).to.equal(undefined);
    });

    it('never puts the token in an error message or its inspected form', async () => {
      const cases = [
        [reply(401, { message: TOKEN })],
        [reply(403, { message: TOKEN })],
        [reply(500, { message: `echo ${TOKEN}` })],
        [new Error(`connect failed with ${TOKEN}`)]
      ];
      for (const responses of cases) {
        const { client } = setup(responses);
        const error = await failure(client.get('/x'));
        expect(error.message).to.not.include(TOKEN);
        expect(inspect(error, { depth: 6 })).to.not.include(TOKEN);
      }
    });
  });

  describe('post', () => {
    it('sends a JSON body with the bearer token', async () => {
      const { calls, client } = setup([reply(200, { items: [] })]);
      const result = await client.post('/x/batch-get', { keys: ['a'] }, { scope: 'kv:read', what: 'KV' });
      expect(result).to.deep.equal({ status: 200, body: { items: [] } });
      expect(calls[0].init.method).to.equal('POST');
      expect(calls[0].init.body).to.equal('{"keys":["a"]}');
      expect(calls[0].init.headers['Content-Type']).to.equal('application/json');
      expect(calls[0].init.headers.Authorization).to.equal(`Bearer ${TOKEN}`);
      expect(calls[0].init.redirect).to.equal('manual');
    });

    it('retries a 429, names the scope on 403 and returns 404', async () => {
      const retry = setup([reply(429, {}, { 'retry-after': '1' }), reply(200, {})]);
      await retry.client.post('/x', {});
      expect(retry.waits).to.deep.equal([1000]);
      const denied = await failure(setup([reply(403, {})]).client.post('/x', {}, { scope: 'kv:read', what: 'KV store a' }));
      expect(denied.message).to.equal('QUANT_API_TOKEN lacks the kv:read scope for KV store a.');
      expect(await setup([reply(404, {})]).client.post('/x', {})).to.deep.equal({ status: 404 });
    });

    it('redacts the token and hides network errors', async () => {
      const leaked = await failure(setup([reply(500, { message: `bad ${TOKEN}` })]).client.post('/x', {}));
      expect(leaked.message).to.not.include(TOKEN);
      const down = await failure(setup([new Error(`boom ${TOKEN}`)]).client.post('/x', {}));
      expect(down.message).to.not.include(TOKEN);
    });
  });
});
