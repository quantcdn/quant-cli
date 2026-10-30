/**
 * Static file serving for `quant serve`.
 * Only files found in the index are served. A request path is looked up as a
 * key and is never joined to the file system, so it cannot leave the site
 * directory.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import mime from 'mime-types';
import quantURL from '../helper/quant-url.js';

const NOT_FOUND_KEY = '/_quant404';
const NOT_FOUND_WARNING = 'Production serves /_quant404. Copy 404.html to _quant404/index.html in your deploy step.';
const BUILT_IN_404 = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found</title></head>'
  + '<body><h1>404</h1><p>This page was not found.</p></body></html>';
const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

export const NOT_SERVED = 'quant.json, the quant/ folder, quant/serve.json and quant/kv-ledgers.json at any depth, node_modules, '
  + 'and files and folders whose names start with "." '
  + '(except the .well-known folder at the top of the site)';
const WELL_KNOWN = '.well-known';
// The local-only files of quant serve in a quant/ folder: never deployed, so never served.
const LOCAL_ONLY = new Set(['serve.json', 'kv-ledgers.json']);

function localOnly(name, full) {
  return LOCAL_ONLY.has(name) && path.basename(path.dirname(full)).toLowerCase() === 'quant';
}

// Files that are never served: dotfiles and dot-folders (.env, .git, .quant),
// node_modules, quant.json, quant/serve.json and quant/kv-ledgers.json (at
// any depth, as a deploy skips them), and the quant/ folder of the project. The
// .well-known folder at the top of the site is served (security.txt, ACME).
function excluded(entry, full, walkState) {
  const name = entry.name.toLowerCase();
  if (entry.isDirectory() && name === WELL_KNOWN && path.dirname(full) === walkState.dir) return false;
  if (name.startsWith('.') || name === 'node_modules') return true;
  if (entry.isFile()) return name === 'quant.json' || localOnly(name, full);
  return full === walkState.projectQuant;
}

function walk(walkState, current) {
  const { dir, index } = walkState;
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    if (excluded(entry, full, walkState)) continue;
    if (entry.isDirectory()) {
      walk(walkState, full);
    } else if (entry.isFile()) {
      const relative = path.relative(dir, full).split(path.sep).join('/');
      index.set(quantURL.prepare(relative), { path: full, size: fs.statSync(full).size });
    }
  }
}

/**
 * Map each file under dir to its canonical Quant path. Symlinks are skipped,
 * and so are the files that NOT_SERVED names.
 * @param {string} dir The site directory.
 * @param {string} [root] The project directory (its quant/ folder is not served).
 */
export function buildIndex(dir, root = dir) {
  const index = new Map();
  walk({ dir: path.resolve(dir), index, projectQuant: path.join(path.resolve(root), 'quant') }, path.resolve(dir));
  return index;
}

/** True when dir is the project directory or contains it. */
export function containsProject(dir, root) {
  const relative = path.relative(path.resolve(dir), path.resolve(root));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Find the file for a request path, or null. */
export function lookup(index, pathname, search = '') {
  const decoded = decode(pathname);
  const withQuery = quantURL.prepare(`${decoded}${search || ''}`);
  return index.get(withQuery) || index.get(quantURL.prepare(decoded)) || null;
}

// One path segment on disk: a real file or folder (not a symlink) that the
// index would include.
function segmentServed(full, walkState) {
  let stat;
  try {
    stat = fs.lstatSync(full);
  } catch (_err) {
    return null;
  }
  const entry = { name: path.basename(full), isFile: () => stat.isFile(), isDirectory: () => stat.isDirectory() };
  return excluded(entry, full, walkState) ? null : stat;
}

function servedFile(walkState, relative) {
  let current = walkState.dir;
  let stat = null;
  for (const segment of relative.split('/').filter(Boolean)) {
    if (stat && !stat.isDirectory()) return null;
    current = path.join(current, segment);
    stat = segmentServed(current, walkState);
    if (!stat) return null;
  }
  return stat && stat.isFile() ? { path: current, size: stat.size } : null;
}

/**
 * Find the file for a request path on disk, with the same exclusions as
 * buildIndex: the path itself, then its index.html. For a site directory
 * that a build has made again after the index was built.
 * @returns {{ path: string, size: number }|null}
 */
export function findOnDisk(dir, root, pathname) {
  const walkState = { dir: path.resolve(dir), projectQuant: path.join(path.resolve(root), 'quant') };
  const relative = decode(pathname);
  if (relative.split('/').some((segment) => segment === '..')) return null;
  return servedFile(walkState, relative) || servedFile(walkState, `${relative}/index.html`);
}

function baseHeaders(file, stat) {
  return {
    'content-type': mime.lookup(file.path) || 'application/octet-stream',
    etag: `"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`,
    'accept-ranges': 'bytes',
    'cache-control': 'no-store'
  };
}

/** Parse a single byte range. Returns null (ignore), 'invalid' or { start, end }. */
function parseRange(header, size) {
  const match = RANGE_PATTERN.exec((header || '').trim());
  if (!match || (match[1] === '' && match[2] === '')) {
    return null;
  }
  let start;
  let end;
  if (match[1] === '') {
    start = Math.max(size - Number(match[2]), 0);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  }
  return start >= size || start > end ? 'invalid' : { start, end };
}

// The file bytes from start to end (inclusive), as a stream.
function fileStream(file, start, end) {
  if (end < start) return new Uint8Array(0);
  return Readable.toWeb(fs.createReadStream(file.path, { start, end }));
}

/** Build a response for an indexed file. The file is streamed (a range with start and end). */
export function serveStatic(file, method, rangeHeader, status = 200) {
  const stat = fs.statSync(file.path);
  const headers = baseHeaders(file, stat);
  const range = status === 200 ? parseRange(rangeHeader, stat.size) : null;
  if (range === 'invalid') {
    return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${stat.size}` } });
  }
  const { start, end } = range || { start: 0, end: stat.size - 1 };
  headers['content-length'] = String(end - start + 1);
  if (range) headers['content-range'] = `bytes ${start}-${end}/${stat.size}`;
  const body = method === 'HEAD' ? null : fileStream(file, start, end);
  return new Response(body, { status: range ? 206 : status, headers });
}

/** The 404 response, plus a warning when only 404.html exists. */
export function notFound(dir, index) {
  const custom = index.get(NOT_FOUND_KEY);
  if (custom) {
    return { response: serveStatic(custom, 'GET', null, 404), warning: null };
  }
  const warning = fs.existsSync(path.join(dir, '404.html')) ? NOT_FOUND_WARNING : null;
  const response = new Response(BUILT_IN_404, {
    status: 404,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }
  });
  return { response, warning };
}
