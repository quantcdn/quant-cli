/**
 * The project files that `quant serve` reads: the functions manifest, the
 * rules manifest and quant/meta.json. Each file is checked with the same
 * helper as the deploy commands, so a file that a deploy refuses also stops
 * `quant serve`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { assertManifest } from '../helper/functions-manifest.js';
import { resolveRules, ruleErrors, toRuntimeRule } from '../helper/edge-rules-manifest.js';
import { parseMeta } from '../helper/quant-meta.js';
import { readInlineSetting } from './inline.js';
import { readServeConfig, SERVE_CONFIG } from './project-config.js';
import { orderRules } from './rules.js';

export const DEFAULT_FILES = Object.freeze({
  functions: 'quant/edge-functions.json',
  rules: 'quant/edge-rules.json',
  meta: 'quant/meta.json',
  fixtures: 'quant/kv-fixtures',
  serve: SERVE_CONFIG
});

export const WATCH_DEBOUNCE_MS = 300;

/** The file text, or null when the file does not exist. */
function readOptional(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function readJson(root, source) {
  const text = readOptional(path.resolve(root, source));
  if (text === null) return null;
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${source}: ${err.message}`);
  }
}

function readFunctions(root, source) {
  const manifest = readJson(root, source) ?? [];
  assertManifest(manifest, source);
  return manifest;
}

function readRules(root, source, functions) {
  const manifest = readJson(root, source);
  if (manifest === null) return [];
  const errors = ruleErrors(manifest);
  if (errors.length > 0) throw new Error(`${source} is not a valid rules manifest:\n  ${errors.join('\n  ')}`);
  try {
    return orderRules(resolveRules(manifest, functions).rules.map(toRuntimeRule));
  } catch (err) {
    throw new Error(`${source}: ${err.message}`);
  }
}

function readStores(root, source) {
  const text = readOptional(path.resolve(root, source));
  return text === null ? [] : parseMeta(text, source).stores;
}

function functionMap(root, manifest) {
  return new Map(manifest.map((fn) => [String(fn.uuid).toLowerCase(), {
    uuid: String(fn.uuid).toLowerCase(),
    id: fn.id,
    type: fn.type,
    path: path.resolve(root, fn.path)
  }]));
}

function ruleWarning(rule, fn, source) {
  if (!fn) {
    const effect = rule.type === 'filter' ? ' The filter is skipped.' : '';
    return `Rule ${rule.id}: function ${rule.fnUuid} is not in ${source}.${effect}`;
  }
  return fs.existsSync(fn.path) ? null : `Rule ${rule.id}: the function file ${fn.path} was not found.`;
}

/**
 * Load and check the project files. A missing file counts as empty.
 * @param {Object} options
 * @param {string} options.root The project directory. File paths resolve from it.
 * @returns {{ functions: Map<string, Object>, rules: Object[], stores: Object[], fixtures: string, inlineFunctions: boolean, warnings: string[] }}
 *   functions is keyed by lowercase uuid; rules are runtime rules in run order.
 *   inlineFunctions: project_settings.enable_inline_fn in meta.json.
 *   settings: the local project settings from serve.json (see project-config.js).
 */
export function loadProject({ root, functions = DEFAULT_FILES.functions, rules = DEFAULT_FILES.rules, meta = DEFAULT_FILES.meta, fixtures = DEFAULT_FILES.fixtures, serve = DEFAULT_FILES.serve }) {
  const manifest = readFunctions(root, functions);
  const runtimeRules = readRules(root, rules, manifest);
  const map = functionMap(root, manifest);
  const settings = readServeConfig(root, serve);
  const warnings = runtimeRules.map((rule) => ruleWarning(rule, map.get(rule.fnUuid), functions)).filter(Boolean);
  return {
    functions: map,
    rules: runtimeRules,
    stores: readStores(root, meta),
    fixtures: path.resolve(root, fixtures),
    inlineFunctions: readInlineSetting(root, meta),
    settings,
    warnings: [...warnings, ...settings.warnings]
  };
}

function watchOne(full, relative, changed, schedule) {
  try {
    const watcher = fs.watch(full, { recursive: true }, (_event, filename) => {
      changed.add(filename ? path.join(relative, filename.toString()) : relative);
      schedule();
    });
    watcher.on('error', () => {});
    return watcher;
  } catch (_err) {
    return null;
  }
}

/**
 * Watch project paths and call onChange with the changed paths (relative to
 * root) after a 300 ms quiet period. Paths that do not exist are skipped.
 * @param {string} root The project directory.
 * @param {(paths: string[]) => void} onChange
 * @param {{ paths?: string[] }} [options] The paths to watch (default: quant, src, public).
 * @returns {() => void} Stops the watchers.
 */
export function watchProject(root, onChange, { paths = ['quant', 'src', 'public'] } = {}) {
  const changed = new Set();
  let timer = null;
  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const list = [...changed];
      changed.clear();
      onChange(list);
    }, WATCH_DEBOUNCE_MS);
  };
  const watchers = [...new Set(paths)]
    .map((relative) => ({ relative, full: path.resolve(root, relative) }))
    .filter(({ full }) => fs.existsSync(full))
    .map(({ full, relative }) => watchOne(full, relative, changed, schedule))
    .filter(Boolean);
  return () => {
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
  };
}
