/**
 * The KV of `quant serve`: the edge kvStore and the local backend from
 * @quantcdn/edge-kv, on the state files of state.js (or in memory).
 * Only the stores that quant/meta.json declares are allowed; any other
 * store id gets the FORBIDDEN error of the package.
 */

import { createLocalKv } from '@quantcdn/edge-kv';
import { storeId } from '../../helper/quant-meta.js';
import { seedStore } from '../seed.js';
import { declareLedgers } from './ledgers.js';
import path from 'node:path';
import {
  statePaths, ensureQuantDir, fileStorage, readBackendKeys, replaceState, writeBackendKeys, resetState
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

// The seed marker of a store, in a map of store id to seed time.
function markerOf(seeded, id) {
  return { get seeded() { return Boolean(seeded[id]); }, mark: async () => { seeded[id] = new Date().toISOString(); } };
}

// A backend in memory with the state of the snapshot (and its keys).
function memoryKv(ctx, snapshot) {
  const memory = createLocalKv({ ...backendOptions(null, undefined, ctx.options), isAllowed: (id) => ctx.allowed.has(id), warn: ctx.warn });
  memory.backend.restore(snapshot);
  return memory;
}

// A trial seed in a backend in memory, with no keys file: it checks every
// fixture file (JSON, shape, $date, limits and unique indexes) before the
// first real write, so a bad fixture never reveals a key.
async function trialSeed(ctx, snapshot, seeded, seedOptions) {
  const trial = memoryKv(ctx, snapshot);
  try {
    await seedStores({ ...ctx, kvStore: trial.kvStore, paths: null, seeded: { ...seeded } }, seedOptions);
  } catch (err) {
    err.revealed = [];
    throw err;
  }
}

// On file storage, each write of the backend copies its whole state, so a
// large seed runs in a backend in memory. It starts from the state file
// under the lock, and its state (with the seed markers) is written once,
// also when the seed fails part way (its keys are revealed already).
async function seedOnFile(ctx, seedOptions) {
  let failure = null;
  let result;
  await replaceState(ctx.paths, async (fresh) => {
    const snapshot = fresh ?? ctx.backend.snapshot();
    const seeded = { ...fresh?.seeded };
    await trialSeed(ctx, snapshot, seeded, seedOptions);
    const memory = memoryKv(ctx, snapshot);
    try {
      result = await seedStores({ ...ctx, kvStore: memory.kvStore, seeded }, seedOptions);
    } catch (err) {
      failure = err;
    }
    return { ...memory.backend.snapshot(), seeded };
  });
  if (failure) throw failure;
  return result;
}

async function seedInMemory(ctx, seedOptions) {
  await trialSeed(ctx, ctx.backend.snapshot(), ctx.seededInMemory, seedOptions);
  return seedStores({ ...ctx, seeded: ctx.seededInMemory }, seedOptions);
}

function seedAll(ctx, seedOptions) {
  return ctx.paths ? seedOnFile(ctx, seedOptions) : seedInMemory(ctx, seedOptions);
}

async function seedStores(ctx, { fixtures, userName, seedKey, now }) {
  const revealed = [];
  const seedKeyState = { used: false };
  let count = 0;
  const withStore = (id, keys) => keys.map((key) => ({ ...key, storeId: id }));
  for (const [id, definition] of ctx.allowed) {
    try {
      const result = await seedStore(ctx.kvStore.open(id), {
        definition,
        fixturesFile: fixtures ? path.join(fixtures, `${definition.name}.json`) : null,
        userName,
        seedKey,
        seedKeyState,
        keysPath: ctx.paths ? ctx.paths.revealKeys(id) : null,
        now,
        marker: markerOf(ctx.seeded, id)
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

// The meta.json stores and indexes, then the quant/kv-ledgers.json ledgers.
async function declareAll(ctx, { stores = [], ledgers = [] }) {
  for (const definition of stores) await declareStore(ctx, definition);
  await declareLedgers(ctx.backend, { org: ctx.org, project: ctx.project, ledgers, warnings: ctx.warnings });
}

async function prepareFiles(root, reset) {
  const paths = statePaths(root);
  ensureQuantDir(root);
  if (reset) await resetState(paths);
  return paths;
}

function backendOptions(paths, storage, options) {
  const { lagMs = 0, indexState: state, org, clock, budgetRows } = options;
  return {
    storage,
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
 * @param {{ store: string, defs: Object[] }[]} [options.ledgers] The ledgers from readLedgerFile() (quant serve only).
 * @param {Object} [options.clock] The clock of the backend (`{ now() }`). Default: the real clock.
 * @param {(message: string) => void} [options.warn] Unknown set and delete options.
 * @returns {Promise<{ kvStore, backend, warnings: string[], paths: Object|null,
 *   declare: (store: Object) => Promise<string>, seed: (options: Object) => Promise<Object> }>}
 */
export async function openLocalKv(options) {
  const { root, org, project, memory = false, reset = false, warn } = options;
  const paths = memory ? null : await prepareFiles(root, reset);
  const allowed = new Map();
  const storage = paths ? fileStorage(paths) : undefined;
  const { kvStore, backend } = createLocalKv({ ...backendOptions(paths, storage, options), isAllowed: (id) => allowed.has(id), warn });
  if (paths && readBackendKeys(paths) === undefined) writeBackendKeys(paths, backend.snapshot().keys);
  const ctx = {
    org, project, backend, kvStore, paths, allowed, options, warn,
    indexState: options.indexState === undefined ? null : indexState(options.indexState), warnings: [], seededInMemory: {}
  };
  await declareAll(ctx, options);
  return {
    kvStore,
    backend,
    paths,
    warnings: ctx.warnings,
    declare: (definition) => declareStore(ctx, definition),
    seed: (seedOptions = {}) => seedAll(ctx, seedOptions)
  };
}
