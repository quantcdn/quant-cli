/**
 * Inline functions for `quant serve`: {{QUANT_FN:uuid}} tokens in a static
 * HTML page are replaced by the output of the function, as on the Quant
 * edge. The project setting is project_settings.enable_inline_fn in
 * quant/meta.json, checked with the rules and messages of the portal.
 */

import fs from 'node:fs';
import path from 'node:path';
import mime from 'mime-types';

const TOKEN = /{{QUANT_FN:(.*?)}}/gi;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SETTINGS_KEYS = ['enable_inline_fn'];
const PRIVATE = 'private, max-age=0';
const HTML = 'text/html; charset=utf-8';
// The scan keeps a BOM in the text, so a page with tokens keeps it too.
const DECODER = new TextDecoder('utf-8', { ignoreBOM: true });
// Response headers that a function cannot set.
const PROTECTED = ['quant-server', 'age'];

const REFUSALS = {
  auth: 'Direct execution of auth function is disallowed.',
  filter: 'Direct execution of filter function is disallowed.'
};

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function settingsObject(settings, source) {
  if (Array.isArray(settings) && settings.length === 0) return {};
  if (!isObject(settings)) throw new Error(`${source}: project_settings must be an object.`);
  return settings;
}

/**
 * Whether inline functions are on: project_settings.enable_inline_fn is true.
 * `meta` is the parsed quant/meta.json document (an object, or a one-element list).
 */
export function inlineSetting(meta, source = 'quant/meta.json') {
  const document = Array.isArray(meta) ? meta[0] : meta;
  if (!isObject(document) || document.project_settings === undefined) return false;
  const settings = settingsObject(document.project_settings, source);
  for (const [key, value] of Object.entries(settings)) {
    if (!SETTINGS_KEYS.includes(key)) throw new Error(`${source}: project_settings.${key} is not supported (supported: ${SETTINGS_KEYS.join(', ')}).`);
    if (typeof value !== 'boolean') throw new Error(`${source}: project_settings.${key} must be true or false.`);
  }
  return settings.enable_inline_fn === true;
}

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

// Older templates ship a meta.json that is not JSON. Such a file counts as
// no settings, unless it names project_settings.
function parseDocument(text, source) {
  try {
    return JSON.parse(text);
  } catch (err) {
    if (!text.includes('project_settings')) return null;
    throw new Error(`${source}: ${err.message}`);
  }
}

/** The inline setting from the meta.json file under root. A missing file counts as off. */
export function readInlineSetting(root, source) {
  const text = readText(path.resolve(root, source));
  if (text === null) return false;
  return inlineSetting(parseDocument(text, source), source);
}

/**
 * The distinct full UUIDs of the tokens in a body, in document order and in
 * lower case. `hit` is true when the body has any token, also one without a
 * full UUID.
 */
export function tokenUuids(body) {
  const uuids = [];
  let hit = false;
  for (const match of body.matchAll(TOKEN)) {
    hit = true;
    const uuid = match[1].toLowerCase();
    if (UUID.test(uuid) && !uuids.includes(uuid)) uuids.push(uuid);
  }
  return { uuids, hit };
}

/** True for a file that is served as an HTML page. */
export function isHtmlFile(file) {
  return String(mime.lookup(file) || '').startsWith('text/html');
}

/** The text that replaces the token of a function that is not a request function. */
export function refusal(type) {
  return REFUSALS[type] || null;
}

function mergeFunctionHeaders(target, source) {
  let cookiesReplaced = false;
  for (const [key, value] of source) {
    if (PROTECTED.includes(key)) continue;
    if (key !== 'set-cookie') {
      target.set(key, value);
      continue;
    }
    if (!cookiesReplaced) target.delete('set-cookie');
    cookiesReplaced = true;
    target.append(key, value);
  }
}

// The page headers: the headers of the last function that ran win. When no
// function ran, or it gave no cache-control, the page is private.
function pageHeaders(source, lastHeaders, length) {
  const headers = new Headers(source);
  if (lastHeaders) mergeFunctionHeaders(headers, lastHeaders);
  if (!lastHeaders || !lastHeaders.has('cache-control')) headers.set('cache-control', PRIVATE);
  for (const name of ['etag', 'last-modified']) headers.delete(name);
  headers.set('content-length', String(length));
  headers.set('content-type', HTML);
  return headers;
}

/**
 * Replace the tokens of an HTML page response. Each distinct UUID runs once,
 * one at a time, in document order. Every copy of its token is replaced by
 * the output text, which is not scanned for tokens again. A page without a
 * token is sent with its original bytes and headers.
 * @param {Response} response The page.
 * @param {(uuid: string) => Promise<{ text: string, headers?: Headers }>} run
 *   The output of one token; `headers` only when a function ran.
 * @returns {Promise<Response>}
 */
export async function applyInline(response, run) {
  const bytes = new Uint8Array(await response.arrayBuffer());
  const body = DECODER.decode(bytes);
  const init = { status: response.status, statusText: response.statusText };
  const { uuids, hit } = tokenUuids(body);
  if (!hit) return new Response(bytes, { ...init, headers: response.headers });
  const outputs = new Map();
  let lastHeaders = null;
  for (const uuid of uuids) {
    const output = await run(uuid);
    outputs.set(uuid, output.text);
    if (output.headers) lastHeaders = output.headers;
  }
  const replaced = body.replace(TOKEN, (token, inner) => {
    const text = outputs.get(inner.toLowerCase());
    return text === undefined ? token : text;
  });
  const output = new TextEncoder().encode(replaced);
  return new Response(output, { ...init, headers: pageHeaders(response.headers, lastHeaders, output.byteLength) });
}
