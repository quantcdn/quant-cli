/**
 * The rule actions of the `quant serve` rule stage. Each runtime rule names
 * its `action` and holds its action settings in `config` (the rule's
 * action_config). A rule's config can hold credentials (a basic-auth password,
 * origin credentials, injected headers), so no message prints a config value:
 * messages name the rule and its action only.
 */

import { basicAuthResponse } from './project-config.js';
import { PROXY_RESPONSE_DROP, proxyBody, proxyRequestHeaders, withoutHeaders } from './forward.js';
import { listsStatus, ruleCaptures } from './rules.js';

const SUPPORTED = new Set(['edge_fn', 'edge_auth', 'edge_filter', 'redirect', 'headers', 'custom_response', 'auth', 'error_page', 'proxy']);
// Headers that a headers rule cannot set.
const PROTECTED = new Set(['quant-server', 'age', 'quant-project', 'quant-url-hash', 'quant-orig-host']);
// Headers that a proxy rule cannot inject: hop-by-hop and length headers.
const NOT_INJECTED = new Set(['content-length', 'transfer-encoding', 'connection', 'keep-alive', 'upgrade', 'te', 'trailer', 'host']);
const REDIRECT_CODES = [301, 302, 303, 307, 308];
const NULL_BODY = [204, 205, 304];
const DEFAULT_ORIGIN_TIMEOUT_MS = 30000;
const HTML = 'text/html; charset=utf-8';
const PROXY_ERROR = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Proxy Error</title></head>'
  + '<body><h1>Proxy Error</h1><p>An error occurred when communicating with a backend origin service.</p></body></html>';

/** The rule as messages name it: its name, else its id. */
export const ruleLabel = (rule) => rule.name || rule.id;

const configOf = (rule) => (rule.config && typeof rule.config === 'object' ? rule.config : {});

function validHeader(name, value) {
  try {
    new Headers([[name, value]]);
    return true;
  } catch (_err) {
    return false;
  }
}

// The entries of a header map that are valid headers. An invalid entry is
// skipped, so that no error message carries its value.
function headerEntries(map) {
  if (!map || typeof map !== 'object') return [];
  return Object.entries(map)
    .map(([name, value]) => [String(name).toLowerCase(), String(value)])
    .filter(([name, value]) => validHeader(name, value));
}

// A list of header names, without the names that are not valid.
function nameList(value) {
  return Array.isArray(value) ? value.map(String).filter((name) => validHeader(name, '')) : [];
}

function basicCredentials(user, pass) {
  return `Basic ${Buffer.from(`${user ?? ''}:${pass ?? ''}`).toString('base64')}`;
}

function failed(state, rule, why, status = 500) {
  state.log(`Rule ${ruleLabel(rule)} (${rule.action}): ${why}.`);
  return new Response(null, { status });
}

/**
 * The destination as written, with $* (the whole path) and $1 to $5 (the
 * text of each * of the pattern). A $n with no * stays as literal text. The
 * query string is added unless the pattern contains ?.
 */
export function destination(template, ctx, captures) {
  const groups = captures ? captures.groups : [];
  const out = String(template ?? '').replace(/\$(\*|[1-5])/g, (match, key) => (key === '*' ? ctx.pathname : groups[key - 1] ?? match));
  const query = ctx.search || '';
  if ((captures && captures.withQuery) || query.length < 2) return out;
  return `${out}${out.includes('?') ? '&' : '?'}${query.slice(1)}`;
}

// --- Redirect, headers, custom response, basic auth -------------------------------------

function redirect(state, ctx, rule) {
  const config = configOf(rule);
  const location = destination(config.to, ctx, ruleCaptures(rule, ctx));
  if (!validHeader('location', location)) return failed(state, rule, 'the destination is not a valid Location header');
  const code = Number(config.status_code);
  return new Response(null, { status: REDIRECT_CODES.includes(code) ? code : 301, headers: { location } });
}

function headers(_state, _ctx, rule) {
  const entries = headerEntries(configOf(rule).headers).filter(([name]) => !PROTECTED.has(name));
  return { continue: true, headers: entries };
}

function customResponse(_state, _ctx, rule) {
  const config = configOf(rule);
  const code = Number(config.custom_response_status_code);
  const status = Number.isInteger(code) && code >= 200 && code <= 599 ? code : 200;
  const body = NULL_BODY.includes(status) ? null : String(config.custom_response_body ?? '');
  return new Response(body, { status, headers: { 'content-type': HTML } });
}

// A 401 when the credentials are missing or wrong; null (continue) when they are right.
function basicAuth(_state, ctx, rule) {
  const config = configOf(rule);
  const expected = basicCredentials(config.auth_user, config.auth_pass);
  return basicAuthResponse({ basicAuth: expected, globalHeaders: [] }, ctx.req.headers.authorization);
}

// --- Proxy -------------------------------------------------------------------------

// The origin of `to` up to its first placeholder. Only http and https.
function configuredOrigin(to) {
  try {
    const url = new URL(String(to ?? '').split('$')[0]);
    return ['http:', 'https:'].includes(url.protocol) ? url.origin : null;
  } catch (_err) {
    return null;
  }
}

// The URL to forward to, or null when it is not on the configured origin
// (a placeholder value cannot move the request to another host).
function proxyTarget(rule, ctx) {
  const config = configOf(rule);
  const origin = configuredOrigin(config.to);
  if (!origin) return null;
  try {
    const target = new URL(destination(config.to, ctx, ruleCaptures(rule, ctx)));
    return target.origin === origin ? target : null;
  } catch (_err) {
    return null;
  }
}

// fetch sends the host of the target URL as Host, so the rule's host
// setting is not used (start-up warns).
function originRequestHeaders(ctx, config) {
  const headers = withoutHeaders(proxyRequestHeaders(ctx.req), nameList(config.proxy_strip_request_headers));
  for (const [name, value] of headerEntries(config.inject_headers)) {
    if (!NOT_INJECTED.has(name)) headers.set(name, value);
  }
  if (config.auth_user) headers.set('authorization', basicCredentials(config.auth_user, config.auth_pass));
  return headers;
}

function originTimeout(config) {
  const ms = Number(config.origin_timeout);
  return Number.isFinite(ms) && ms > 0 ? ms : DEFAULT_ORIGIN_TIMEOUT_MS;
}

// Empty or -1 keeps the origin's cache-control; 0 is no-store; N is public, max-age=N.
function applyCacheLifetime(target, value) {
  const text = String(value ?? '').trim();
  const seconds = Number(text);
  if (text === '' || !Number.isInteger(seconds) || seconds < 0) return;
  target.set('cache-control', seconds === 0 ? 'no-store' : `public, max-age=${seconds}`);
}

// The origin must answer within origin_timeout; the body then streams without a limit.
async function originFetch(ctx, config, target) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), originTimeout(config));
  try {
    return await fetch(target, {
      method: ctx.method,
      headers: originRequestHeaders(ctx, config),
      ...(await proxyBody(ctx)),
      redirect: 'manual',
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
}

async function forward(ctx, config, target) {
  const upstream = await originFetch(ctx, config, target);
  const result = withoutHeaders(upstream.headers, [...PROXY_RESPONSE_DROP, ...nameList(config.proxy_strip_headers)]);
  applyCacheLifetime(result, config.cache_lifetime);
  if (config.only_proxy_404) result.set('quant-404-proxied', 'true');
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: result });
}

// With static error pages on, a listed origin status gets the published error page.
function withErrorPage(state, ctx, config, response) {
  if (!config.static_error_page || !listsStatus(config.static_error_page_status_codes, response.status)) return response;
  const page = state.stages.errorPage(ctx, response.status);
  if (!page) return response;
  if (response.body) response.body.cancel().catch(() => {});
  return page;
}

function proxyError(state, ctx, rule, why) {
  state.log(`Rule ${ruleLabel(rule)} (proxy): ${why}.`);
  const page = configOf(rule).static_error_page ? state.stages.errorPage(ctx, 502) : null;
  return page || new Response(PROXY_ERROR, { status: 502, headers: { 'content-type': HTML } });
}

async function proxy(state, ctx, rule) {
  const config = configOf(rule);
  const found = config.only_proxy_404 ? state.stages.static(ctx) : null;
  if (found) return found;
  const target = proxyTarget(rule, ctx);
  if (!target) return proxyError(state, ctx, rule, 'the destination is not a URL on the configured origin');
  try {
    return withErrorPage(state, ctx, config, await forward(ctx, config, target));
  } catch (_err) {
    return proxyError(state, ctx, rule, 'the origin did not answer');
  }
}

// --- Dispatch ---------------------------------------------------------------------

const ACTIONS = {
  edge_fn: (state, ctx, rule) => state.stages.edgeFunction(ctx, rule),
  edge_auth: (state, ctx, rule) => state.stages.edgeAuth(ctx, rule),
  redirect,
  headers,
  custom_response: customResponse,
  auth: basicAuth,
  proxy
};

/**
 * Run one matched rule of the rule stage.
 * `state.stages` gives the server stages: edgeFunction(ctx, rule),
 * edgeAuth(ctx, rule), static(ctx) and errorPage(ctx, status).
 * @returns {Promise<Response|null|{ continue: true, headers: Array<[string, string]> }>}
 *   A Response ends the request; null or { continue } goes on to the next rule.
 *   An action that quant serve does not run gives null (start-up warns).
 */
export async function runAction(state, ctx, rule) {
  const action = Object.hasOwn(ACTIONS, rule.action) ? ACTIONS[rule.action] : null;
  return action ? action(state, ctx, rule) : null;
}

// TLS verification and failover work differently on this machine. The other
// failover settings have an effect only with failover_mode on. Notification,
// alert and application settings have no local effect and get no warning.
const changesOriginTrust = (config) => config.disable_ssl_verify === true || config.failover_mode === true;

function proxyWarnings(rule) {
  const config = configOf(rule);
  return [
    ...(config.waf_enabled ? [`Rule ${ruleLabel(rule)}: WAF settings are ignored in quant serve.`] : []),
    ...(config.host ? [`Rule ${ruleLabel(rule)}: the host setting is ignored in quant serve. The origin gets the host of the to URL.`] : []),
    ...(changesOriginTrust(config) ? [`Rule ${ruleLabel(rule)}: failover and TLS verification settings work differently in quant serve.`] : [])
  ];
}

function ruleActionWarnings(rule) {
  if (!SUPPORTED.has(rule.action)) return [`Rule ${ruleLabel(rule)} (${rule.action}) is not available in quant serve and is skipped.`];
  return rule.action === 'proxy' ? proxyWarnings(rule) : [];
}

/** The start-up warnings for rules that quant serve skips in part or whole: one for each rule id. */
export function actionWarnings(rules) {
  const seen = new Set();
  return rules.flatMap((rule) => {
    if (rule.disabled || seen.has(rule.id)) return [];
    seen.add(rule.id);
    return ruleActionWarnings(rule);
  });
}
