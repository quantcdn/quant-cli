/**
 * Local ledger declarations of `quant serve`: the file quant/kv-ledgers.json,
 * `{ "<store name>": [ <ledger definition>, ... ] }`. Only quant serve reads
 * it. A deploy never reads it: production ledgers are declared with the API
 * or the portal.
 *
 * quant-cli checks the file shape only. The local backend of
 * @quantcdn/edge-kv checks each definition.
 */

import fs from 'node:fs';
import path from 'node:path';
import { storeId } from '../../helper/quant-meta.js';

export const LEDGERS_FILE = 'quant/kv-ledgers.json';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function readText(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function parse(text, source) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error(`${source}: ${err.message}`);
  }
}

function checkStore(name, defs, known, { source, meta }) {
  if (!known.has(name)) throw new Error(`${source}: the store ${name} is not in ${meta}.`);
  if (!Array.isArray(defs)) throw new Error(`${source} ${name}: the value must be a list of ledger definitions.`);
  const bad = defs.findIndex((def) => !isObject(def));
  if (bad >= 0) throw new Error(`${source} ${name} entry ${bad + 1}: the entry must be an object.`);
}

/**
 * The ledger definitions of quant/kv-ledgers.json, or [] when the file is absent.
 * @param {{ root: string, stores: Object[], source?: string, meta?: string }} options
 *   stores: the stores of meta.json; meta: the meta.json name for the error text.
 * @returns {{ store: string, defs: Object[] }[]}
 */
export function readLedgerFile({ root, stores, source = LEDGERS_FILE, meta = 'quant/meta.json' }) {
  const text = readText(path.resolve(root, source));
  if (text === null) return [];
  const doc = parse(text, source);
  if (!isObject(doc)) throw new Error(`${source} must be a JSON object of store names to lists of ledger definitions.`);
  const known = new Set(stores.map((store) => store.name));
  return Object.entries(doc).map(([name, defs]) => {
    checkStore(name, defs, known, { source, meta });
    return { store: name, defs };
  });
}

// JSON text with sorted object keys, for a compare.
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (!isObject(value)) return JSON.stringify(value);
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

// The ledger definitions of a store in the backend: Map name -> definition.
// It reads the snapshot layout of @quantcdn/edge-kv 0.1.1 (stores[].ledgers as
// [name, { definition }] pairs), which the package does not document. Edge-kv
// has no documented call that lists the ledgers of a store. Check this at each
// edge-kv upgrade.
function ledgersOf(backend, id) {
  const store = backend.snapshot().stores.find((item) => item.id === id);
  return new Map((store ? store.ledgers : []).map(([name, entry]) => [name, entry.definition]));
}

// The fields of the file entry must be the same in the declared definition.
function sameFields(def, declared) {
  return Object.keys(def).every((key) => stable(def[key]) === stable(declared[key]));
}

function differentDefinition(id, name, source) {
  return `KV store ${id}: ledger ${name} in ${source} has a different definition from the local state. `
    + 'quant serve keeps the old definition. Run quant serve --reset to use the new one.';
}

async function declareOne(backend, id, def, { where, wait }) {
  try {
    await backend.declareLedger(id, def, { wait });
  } catch (err) {
    throw new Error(`${where}: ${err.message}`);
  }
}

function pendingWarning(id, name, status) {
  return `KV store ${id}: ledger ${name} is pending until ${status.activeAfter} (declared with --clock manual). `
    + 'Run quant serve --reset to declare it again.';
}

// On the real clock, a ledger that an earlier --clock manual session declared
// can still be PENDING. Each one gets a warning.
async function pendingWarnings(kvStore, id, defs, warnings) {
  for (const def of defs) {
    const status = await kvStore.ledgerStatus(id, def.name);
    if (status.state === 'PENDING') warnings.push(pendingWarning(id, def.name, status));
  }
}

/**
 * Declare the ledgers in the local backend. A ledger that the state already
 * has is kept; a changed definition gives a warning. `wait: true` (the
 * default) makes a new ledger ACTIVE at once, with no activation delay;
 * `wait: false` keeps it PENDING until the activation time on the backend clock.
 * With `wait: true` and a kvStore, a ledger that is still PENDING gets a warning.
 * @param {Object} backend The local backend.
 * @param {{ org: string, project: string, ledgers: { store: string, defs: Object[] }[], source?: string, wait?: boolean,
 *   kvStore?: Object, warnings: string[] }} options
 */
export async function declareLedgers(backend, { org, project, ledgers, source = LEDGERS_FILE, wait = true, kvStore, warnings }) {
  for (const { store, defs } of ledgers) {
    const id = storeId(org, project, store);
    const existing = ledgersOf(backend, id);
    for (const [i, def] of defs.entries()) {
      const declared = existing.get(def.name);
      if (!declared) await declareOne(backend, id, def, { where: `${source} ${store} entry ${i + 1}`, wait });
      else if (!sameFields(def, declared)) warnings.push(differentDefinition(id, def.name, source));
    }
    if (wait && kvStore) await pendingWarnings(kvStore, id, defs, warnings);
  }
}
