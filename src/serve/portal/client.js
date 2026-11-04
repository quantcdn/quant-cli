import fs from 'node:fs';

const REQUEST_TIMEOUT_MS = 15000;
const DEFAULT_RETRY_SECONDS = 2;
const MAX_WAIT_MS = 30000;
const MIN_RETRY_MS = 250;
const MAX_MESSAGE = 300;
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

export class PortalError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'PortalError';
    this.status = status;
  }
}

// A string as one short line, or null when it is not text.
export function oneLine(value) {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const line = value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return line.length > MAX_MESSAGE ? `${line.slice(0, MAX_MESSAGE - 3)}...` : line;
}

function savedProject() {
  try {
    return JSON.parse(fs.readFileSync('quant.json', 'utf8'));
  } catch {
    return {}; // Optional project selection only.
  }
}

function assertPortalUrl(url) {
  const plainLocal = url.protocol === 'http:' && LOCAL_HOSTS.includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || !/\/api\/v2\/?$/.test(url.pathname) ||
      (url.protocol !== 'https:' && !plainLocal)) {
    throw new Error('Rules require an HTTPS portal /api/v2 URL (HTTP is allowed only for localhost)');
  }
}

const first = (...values) => values.find(Boolean);

export function portalOptions(args, env = process.env) {
  const saved = savedProject();
  const customer = first(args.clientid, args.c, env.QUANT_CLIENT_ID, env.QUANT_CUSTOMER, saved.clientid);
  const project = first(args.project, args.p, env.QUANT_PROJECT, saved.project);
  // Deliberately never read QUANT_TOKEN, -t, saved.token, or upload endpoint.
  // The serve command has no token flag: only the environment is read.
  const { QUANT_API_TOKEN: token, QUANT_BASE_URL: base } = env;
  if (![customer, project, token, base].every(Boolean)) throw new Error('Rules require customer, project, QUANT_API_TOKEN and QUANT_BASE_URL (portal /api/v2 URL)');
  const url = new URL(base);
  assertPortalUrl(url);
  return { customer, project, token, base: url };
}

function buildUrl(base, path, query) {
  const url = new URL(`${String(base.href).replace(/\/$/, '')}${path}`);
  for (const [key, value] of Object.entries(query || {})) url.searchParams.set(key, String(value));
  return url;
}

function retryDelayMs(response) {
  const header = response.headers.get('retry-after');
  const seconds = /^\d+$/.test(header ?? '') ? Number(header) : DEFAULT_RETRY_SECONDS;
  return Math.max(seconds * 1000, MIN_RETRY_MS);
}

async function readBody(response) {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

function failureMessage(status, body, token) {
  const raw = typeof body?.message === 'string' ? body.message.split(token).join('[redacted]') : null;
  const message = oneLine(raw);
  return message ? `The portal answered ${status}: ${message}` : `The portal answered ${status}.`;
}

function refusal(status, scopeInfo) {
  if (status === 401) return new PortalError('The portal refused QUANT_API_TOKEN (401).', 401);
  const { scope = 'required', what = 'this request' } = scopeInfo || {};
  return new PortalError(`QUANT_API_TOKEN lacks the ${scope} scope for ${what}.`, 403);
}

async function send({ base, token, fetchImpl }, { method, path, query, body }) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    return await fetchImpl(buildUrl(base, path, query), {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
  } catch {
    // The original error is dropped on purpose: it can echo request headers.
    throw new PortalError('The portal did not answer. Check QUANT_BASE_URL and the network.');
  }
}

async function settle(context, response, scopeInfo) {
  const { status } = response;
  if (status === 401 || status === 403) throw refusal(status, scopeInfo);
  if (status === 404) return { status };
  const body = await readBody(response);
  if (status < 200 || status > 299) throw new PortalError(failureMessage(status, body, context.token), status);
  if (body === undefined && status !== 204) throw new PortalError('The portal sent a response that is not JSON.', status);
  return { status, body: body ?? null };
}

// onRequest() is called once for each HTTP attempt, a 429 retry included.
export function createPortalClient({ base, token, fetchImpl = fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)), onRequest = () => {} }) {
  const context = { base, token, fetchImpl };
  async function request(call, scopeInfo) {
    let waited = 0;
    for (;;) {
      onRequest();
      const response = await send(context, call);
      if (response.status !== 429) return settle(context, response, scopeInfo);
      const delay = retryDelayMs(response);
      if (waited + delay > MAX_WAIT_MS) throw new PortalError('The portal rate limit (429) did not clear in 30 seconds. Try again later.', 429);
      waited += delay;
      await sleep(delay);
    }
  }
  return {
    get: (path, query, scopeInfo) => request({ method: 'GET', path, query }, scopeInfo),
    post: (path, body, scopeInfo) => request({ method: 'POST', path, body }, scopeInfo)
  };
}
