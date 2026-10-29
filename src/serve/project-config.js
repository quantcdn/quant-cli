/**
 * Local project settings for `quant serve`: quant/serve.json.
 * The dashboard sets these on a real project: project-wide headers, basic
 * authentication and the trailing-slash redirect. The file is local only. No
 * deploy command reads it, and quant serve never prints the password.
 *
 * The request order is the order of the Quant edge: global headers, basic
 * authentication, rules, the trailing-slash redirect, then static content.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const SERVE_CONFIG = 'quant/serve.json';

const FIELDS = ['globalHeaders', 'basicAuth', 'trailingSlash'];
const TRAILING_SLASH = ['redirect', 'none'];
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const HEADER_VALUE = /^[\t\x20-\x7e]*$/;
// Headers that a project cannot set.
const PROTECTED = ['quant-server', 'age'];
const AUTH_BODY = 'Authentication required';
const REDIRECT_CACHE = 'public, max-age=300, s-maxage=86400';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value !== '';

function globalHeaders(value, source, warnings) {
  if (!isObject(value)) throw new Error(`${source}: globalHeaders must be an object of header names and values.`);
  const headers = new Map();
  for (const [name, text] of Object.entries(value)) {
    if (!HEADER_NAME.test(name)) throw new Error(`${source}: globalHeaders: ${JSON.stringify(name)} is not a valid header name.`);
    if (typeof text !== 'string' || !HEADER_VALUE.test(text)) {
      throw new Error(`${source}: globalHeaders.${name} must be printable ASCII text on one line.`);
    }
    const lower = name.toLowerCase();
    if (PROTECTED.includes(lower)) warnings.push(`${source}: globalHeaders.${name} is not applied. A project cannot set the ${lower} header.`);
    else headers.set(lower, text);
  }
  return [...headers];
}

// The Authorization header value that a request must send. The password is
// kept only in this value and is never printed.
function basicAuth(value, source) {
  const valid = isObject(value) && Object.keys(value).length === 2 && isText(value.username) && isText(value.password);
  if (!valid) throw new Error(`${source}: basicAuth must be { "username": "...", "password": "..." } with two non-empty text values.`);
  if (value.username.includes(':')) throw new Error(`${source}: basicAuth.username cannot contain ":".`);
  return `Basic ${Buffer.from(`${value.username}:${value.password}`).toString('base64')}`;
}

function trailingSlash(value, source) {
  if (!TRAILING_SLASH.includes(value)) throw new Error(`${source}: trailingSlash must be "redirect" or "none".`);
  return value;
}

/**
 * Check a parsed quant/serve.json document.
 * @returns {{ globalHeaders: Array<[string, string]>, basicAuth: string|null, trailingSlash: string, warnings: string[] }}
 */
export function parseServeConfig(document, source = SERVE_CONFIG) {
  if (!isObject(document)) throw new Error(`${source} must be a JSON object.`);
  const unknown = Object.keys(document).find((key) => !FIELDS.includes(key));
  if (unknown) throw new Error(`${source}: ${unknown} is not supported (supported: ${FIELDS.join(', ')}).`);
  const warnings = [];
  return {
    globalHeaders: 'globalHeaders' in document ? globalHeaders(document.globalHeaders, source, warnings) : [],
    basicAuth: 'basicAuth' in document ? basicAuth(document.basicAuth, source) : null,
    trailingSlash: 'trailingSlash' in document ? trailingSlash(document.trailingSlash, source) : 'none',
    warnings
  };
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// The JSON error text can quote the file, so it is not shown: the file can
// hold a password.
function parseJson(text, source) {
  try {
    return JSON.parse(text);
  } catch (_err) {
    throw new Error(`${source} is not valid JSON.`);
  }
}

/** The settings from quant/serve.json under root. A missing file gives the defaults. */
export function readServeConfig(root, source = SERVE_CONFIG) {
  const text = readText(path.resolve(root, source));
  return parseServeConfig(text === null ? {} : parseJson(text, source), source);
}

/** The global headers as an object, for a function response to start from. */
export function globalHeaderObject(settings) {
  return Object.fromEntries(settings.globalHeaders);
}

/**
 * Add the global headers to a response. With `replace` false, a header that
 * the response has already (from a function) stays.
 */
export function withGlobalHeaders(response, settings, replace = true) {
  if (settings.globalHeaders.length === 0) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of settings.globalHeaders) {
    if (replace || !headers.has(name)) headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function sameText(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(b);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

/**
 * The 401 response when basic authentication is on and the Authorization
 * header is not the exact expected value, else null.
 */
export function basicAuthResponse(settings, authorization) {
  if (!settings.basicAuth || sameText(authorization || '', settings.basicAuth)) return null;
  const headers = new Headers({ 'content-type': 'text/html; charset=utf-8' });
  for (const [name, value] of settings.globalHeaders) headers.set(name, value);
  headers.set('www-authenticate', 'Basic realm=Authorization Required');
  headers.set('cache-control', 'private');
  return new Response(AUTH_BODY, { status: 401, headers });
}

/**
 * The 301 to the path without its trailing slashes, when the redirect is on
 * and the path (as the client sent it) ends with "/". Else null.
 */
export function trailingSlashRedirect(settings, sentPath, search) {
  if (settings.trailingSlash !== 'redirect') return null;
  if (sentPath === '/' || !sentPath.endsWith('/') || sentPath.startsWith('//')) return null;
  const location = `${sentPath.replace(/\/+$/, '')}${search || ''}`;
  return new Response(null, { status: 301, headers: { location, 'cache-control': REDIRECT_CACHE } });
}
