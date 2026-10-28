/**
 * Static file serving for `quant serve`.
 * Only files found in the index are served. A request path is looked up as a
 * key and is never joined to the file system, so it cannot leave the site
 * directory.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import mime from 'mime-types';
import quantURL from '../helper/quant-url.js';

const NOT_FOUND_KEY = '/_quant404';
const NOT_FOUND_WARNING = 'Production serves /_quant404. Copy 404.html to _quant404/index.html in your deploy step.';
const BUILT_IN_404 = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found</title></head>'
  + '<body><h1>404</h1><p>This page was not found.</p></body></html>';
const RANGE_PATTERN = /^bytes=(\d*)-(\d*)$/;

export const NOT_SERVED = 'quant.json, the quant/ folder, node_modules, and files and folders whose names start with "."';

// Files that are never served: dotfiles and dot-folders (.env, .git, .quant),
// node_modules, quant.json, and the quant/ folder of the project.
function excluded(entry, full, projectQuant) {
  const name = entry.name.toLowerCase();
  if (name.startsWith('.') || name === 'node_modules') return true;
  if (entry.isFile()) return name === 'quant.json';
  return full === projectQuant;
}

function walk(walkState, current) {
  const { dir, index, projectQuant } = walkState;
  for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    if (excluded(entry, full, projectQuant)) continue;
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
  walk({ dir, index, projectQuant: path.join(path.resolve(root), 'quant') }, dir);
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

function baseHeaders(file, body) {
  return {
    'content-type': mime.lookup(file.path) || 'application/octet-stream',
    etag: `"${crypto.createHash('md5').update(body).digest('hex')}"`,
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

/** Build a response for an indexed file. */
export function serveStatic(file, method, rangeHeader, status = 200) {
  const body = fs.readFileSync(file.path);
  const headers = baseHeaders(file, body);
  const range = status === 200 ? parseRange(rangeHeader, body.length) : null;
  if (range === 'invalid') {
    return new Response(null, { status: 416, headers: { ...headers, 'content-range': `bytes */${body.length}` } });
  }
  const slice = range ? body.subarray(range.start, range.end + 1) : body;
  headers['content-length'] = String(slice.length);
  if (range) {
    headers['content-range'] = `bytes ${range.start}-${range.end}/${body.length}`;
  }
  const hasBody = method !== 'HEAD';
  return new Response(hasBody ? slice : null, { status: range ? 206 : status, headers });
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
