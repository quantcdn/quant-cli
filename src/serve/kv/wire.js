/**
 * The KV of `quant serve`: the edge kvStore and the local backend from
 * @quantcdn/edge-kv, on the state files of state.js (or in memory).
 * Only the stores that quant/meta.json declares are allowed; any other
 * store id gets the FORBIDDEN error of the package.
 */

import { createLocalKv } from '@quantcdn/edge-kv';
import { storeId } from '../../helper/quant-meta.js';
import { seedStore } from '../seed.js';
import path from 'node:path';
import {
  statePaths, ensureQuantDir, fileStorage, isSeeded, markSeeded, readBackendKeys, writeBackendKeys, resetState
} from './state.js';

// An index definition in one shape, for a compare with the backend state.
const canonical = (def) => JSON.stringify([def.name, def.collection, def.fields ?? [], def.sortBy ?? null, def.unique === true, def.count === true]);

function indexState(value) {
  return String(value || 'active').toUpperCase() === 'BUILDING' ? 'BUILDING' : 'ACTIVE';
}

// The index entries of a store in the backend: Map name -> { def, state }.
function indexesOf(backend, id) {
  const store = backend.snapshot().stores.find((item) => item.id === id);
  return new Map(store ? store.indexes : []);
}

function differentDefinition(id, name) {
  return `KV store ${id}: index ${name} in quant/meta.json has a different definition from the local state. `
    + 'quant serve keeps the old definition. Run quant serve --reset to use the new one.';
}

// The state of the session for a declared index: 'building' holds it
// BUILDING; null (no indexState option) leaves the state alone; the default makes an index that a building session held ACTIVE.
async function holdState(backend, id, name, entry, state) {
  if (state === null) return;
  if (state === 'BUILDING') await backend.setIndexState(id, name, 'BUILDING');
  else if (entry && entry.state === 'BUILDING') await backend.setIndexState(id, name, 'ACTIVE');
}

async function declareIndexes(backend, id, definition, state, warnings) {
  const existing = indexesOf(backend, id);
  for (const def of definition.indexes) {
    const entry = existing.get(def.name);
    if (!entry) await backend.declareIndex(id, def);
    else if (canonical(entry.def) !== canonical(def)) warnings.push(differentDefinition(id, def.name));
    await holdState(backend, id, def.name, entry, state);
  }
}

async function declareStore(ctx, definition) {
  const id = storeId(ctx.org, ctx.project, definition.name);
  if (!ctx.backend.storeIds().includes(id)) await ctx.backend.createStore({ id, format: 2 });
  await declareIndexes(ctx.backend, id, definition, ctx.indexState, ctx.warnings);
  ctx.allowed.set(id, definition);
  return id;
}

// The seed marker of a store: in the state document, or in memory.
function markerOf(ctx, id) {
  if (!ctx.paths) {
    return { get seeded() { return ctx.seededInMemory.has(id); }, mark: async () => { ctx.seededInMemory.add(id); } };
  }
  return { get seeded() { return isSeeded(ctx.paths, id); }, mark: () => markSeeded(ctx.paths, id) };
}

async function seedAll(ctx, { fixtures, userName, seedKey, now }) {
  const revealed = [];
  let count = 0;
  const withStore = (id, keys) => keys.map((key) => ({ ...key, storeId: id }));
  for (const [id, definition] of ctx.allowed) {
    try {
      const result = await seedStore(ctx.kvStore.open(id), {
        definition,
        fixturesFile: fixtures ? path.join(fixtures, `${definition.name}.json`) : null,
        userName,
        seedKey,
        keysPath: ctx.paths ? ctx.paths.revealKeys(id) : null,
        now,
        marker: markerOf(ctx, id)
      });
      revealed.push(...withStore(id, result.revealed));
      count += result.fixtures;
    } catch (err) {
      // Give the caller every key revealed so far, so the start-up can show them.
      err.revealed = [...revealed, ...withStore(id, err.revealed || [])];
      throw err;
    }
  }
  return { revealed, fixtures: count };
}

async function prepareFiles(root, reset) {
  const paths = statePaths(root);
  ensureQuantDir(root);
  if (reset) await resetState(paths);
  return paths;
}

function backendOptions(paths, options) {
  const { lagMs = 0, indexState: state, org, clock, budgetRows } = options;
  return {
    storage: paths ? fileStorage(paths) : undefined,
    keys: paths ? readBackendKeys(paths) : undefined,
    indexes: { initialState: indexState(state), listLagMs: lagMs },
    org,
    ...(clock ? { clock } : {}),
    ...(budgetRows ? { budgetRows } : {})
  };
}

/**
 * Open the local KV of a project.
 * @param {Object} options
 * @param {string} options.root The project directory (.quant/kv is under it).
 * @param {string} options.org
 * @param {string} options.project
 * @param {Object[]} options.stores The stores from parseMeta().
 * @param {boolean} [options.memory] Keep the state in memory only (no files).
 * @param {boolean} [options.reset] Delete the state files first.
 * @param {number} [options.lagMs] Index list delay (--kv-lag).
 * @param {string} [options.indexState] 'active' or 'building' (--indexes). Absent: index states are left as they are.
 * @param {(message: string) => void} [options.warn] Unknown set and delete options.
 * @returns {Promise<{ kvStore, backend, warnings: string[], paths: Object|null,
 *   declare: (store: Object) => Promise<string>, seed: (options: Object) => Promise<Object> }>}
 */
export async function openLocalKv(options) {
  const { root, org, project, stores = [], memory = false, reset = false, warn } = options;
  const paths = memory ? null : await prepareFiles(root, reset);
  const allowed = new Map();
  const { kvStore, backend } = createLocalKv({ ...backendOptions(paths, options), isAllowed: (id) => allowed.has(id), warn });
  if (paths && readBackendKeys(paths) === undefined) writeBackendKeys(paths, backend.snapshot().keys);
  const ctx = { org, project, backend, kvStore, paths, allowed, indexState: options.indexState === undefined ? null : indexState(options.indexState), warnings: [], seededInMemory: new Set() };
  for (const definition of stores) await declareStore(ctx, definition);
  return {
    kvStore,
    backend,
    paths,
    warnings: ctx.warnings,
    declare: (definition) => declareStore(ctx, definition),
    seed: (seedOptions = {}) => seedAll(ctx, seedOptions)
  };
}
