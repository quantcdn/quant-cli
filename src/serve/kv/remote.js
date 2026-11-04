/**
 * --kv-remote: one KV store of the portal, read one time at start into
 * memory. Local writes go on top of the snapshot for the session. Nothing
 * of the snapshot is written to .quant/ or to any other file: a restart
 * reads the portal again. Secret values stay the string [ENCRYPTED].
 */

import { createLocalKv } from '@quantcdn/edge-kv';
import { createPortalClient, portalOptions, requestBudget, START_REQUEST_LIMIT } from '../portal/client.js';
import { findStore, readStore } from '../portal/kv-remote.js';
import { isObject } from '../../helper/is-object.js';

export const REMOTE_MAX_KEYS = 10000;
export const REMOTE_MAX_REQUESTS = START_REQUEST_LIMIT;
const MASKED = '[ENCRYPTED]';
// Portal index states that do not serve queries: they are not declared.
const UNUSED_STATES = ['FAILED', 'DROPPING'];

/**
 * The local declare shape of a portal index definition: name, collection,
 * fields, sortBy, unique and count. The state fields (slot, state, createdAt,
 * error, conflicts, job) are dropped.
 */
export function toLocalIndex(def) {
  if (!isObject(def)) return null;
  const out = {
    name: def.name,
    collection: def.collection,
    fields: Array.isArray(def.fields) ? [...def.fields] : [],
    unique: def.unique === true,
    count: def.count === true
  };
  if (typeof def.sortBy === 'string' && def.sortBy !== '') out.sortBy = def.sortBy;
  return out;
}

/**
 * Read the store from the portal: the store list, the index definitions,
 * the keys and their values. `budget` is the request budget of the start-up,
 * shared with --pull-rules; each attempt (429 retries too) uses one request.
 * A PortalError stops the start-up with its one-line message.
 */
export async function readRemoteStore({ name, org, project }, { env = process.env, fetchImpl, budget = requestBudget() } = {}) {
  const ids = portalOptions({ clientid: org, project }, env, '--kv-remote');
  const client = createPortalClient({ base: ids.base, token: ids.token, budget, ...(fetchImpl ? { fetchImpl } : {}) });
  const ctx = { customer: ids.customer, project: ids.project, name };
  const store = await findStore(client, ctx);
  const snapshot = await readStore(client, ctx, store.id, { maxKeys: REMOTE_MAX_KEYS });
  return { name, format: store.format ?? 2, ...snapshot };
}

// The set options of a portal entry: secret for an encrypted value, and the
// time left of its expiry (epoch seconds). null when the entry has expired.
function putOptions(metadata, nowMs) {
  const options = metadata.encrypted === true ? { secret: true } : {};
  if (typeof metadata.expires_at !== 'number') return options;
  const ttl = metadata.expires_at - nowMs / 1000;
  return ttl > 0 ? { ...options, ttl } : null;
}

const isLedgerRow = (entry) => entry.metadata?.ledger !== undefined;

// A ledger entry (counted), an entry with no value, or an expired entry is not copied.
async function writeEntry(backend, id, entry, result) {
  if (isLedgerRow(entry)) {
    result.ledgerRows += 1;
    return;
  }
  const options = putOptions(entry.metadata || {}, backend.now());
  if (entry.value === undefined || options === null) return;
  try {
    await backend.put(id, entry.key, JSON.stringify(entry.value), options);
    result.copied += 1;
    if (entry.value === MASKED) result.masked += 1;
  } catch (err) {
    result.failed.add(err.code || 'ERROR');
  }
}

const notDeclared = (store, index, code) => `KV store ${store}: index ${index} from the portal could not be declared locally (${code}).`;

async function declareIndexes(backend, id, { name, indexes }, { building, warnings }) {
  for (const def of indexes.filter((item) => !UNUSED_STATES.includes(String(item?.state).toUpperCase()))) {
    const local = toLocalIndex(def);
    if (!local) {
      warnings.push(notDeclared(name, '?', 'VALIDATION'));
      continue;
    }
    try {
      await backend.declareIndex(id, local);
      if (building) await backend.setIndexState(id, local.name, 'BUILDING');
    } catch (err) {
      warnings.push(notDeclared(name, local.name, err.code || err.message));
    }
  }
}

/**
 * The remote store as store data of a backend snapshot. It is built in a
 * backend in memory that starts from `base` (the keys and clock offset of
 * the local backend) with no stores: the index definitions first, then each
 * entry with its metadata (secret, ttl).
 * @returns {Promise<{ data: Object, copied: number, masked: number, ledgerRows: number, warnings: string[] }>}
 */
export async function buildRemoteStore({ base, id, snapshot, backendOptions, building = false }) {
  const { backend } = createLocalKv({ ...backendOptions, storage: undefined });
  backend.restore({ ...base, stores: [] });
  await backend.createStore({ id, format: snapshot.format });
  const warnings = [];
  await declareIndexes(backend, id, snapshot, { building, warnings });
  const result = { copied: 0, masked: 0, ledgerRows: 0, failed: new Set() };
  for (const entry of snapshot.entries) await writeEntry(backend, id, entry, result);
  if (result.failed.size > 0) {
    warnings.push(`KV store ${snapshot.name}: some keys from the portal could not be copied locally (${[...result.failed].join(', ')}).`);
  }
  const data = backend.snapshot().stores.find((store) => store.id === id);
  return { data, copied: result.copied, masked: result.masked, ledgerRows: result.ledgerRows, warnings };
}

// The cap that stopped a truncated read, in the start-up line.
const STOPPED = {
  keys: `limit ${REMOTE_MAX_KEYS}`,
  requests: `request limit ${REMOTE_MAX_REQUESTS}`,
  cursor: 'the portal ended the list early'
};

function copiedLine({ name, truncated, stoppedBy }, { copied, masked, ledgerRows = 0 }) {
  const ledger = ledgerRows > 0 ? ` (${ledgerRows} ledger entries not copied)` : '';
  if (!truncated) return `KV store ${name}: copied ${copied} keys from the portal (${masked} encrypted values masked)${ledger}.`;
  return `KV store ${name}: copied the first ${copied} keys only (${STOPPED[stoppedBy] || STOPPED.keys})${ledger}. Writes stay local.`;
}

/** The start-up lines of the remote store. */
export function remoteLines(snapshot, built, ledgers) {
  const { name } = snapshot;
  const lines = [copiedLine(snapshot, built)];
  const declared = ledgers.some((entry) => entry.store === name && entry.defs.length > 0);
  if (declared) lines.push(`Ledgers of ${name} are not copied from the portal; declare local ledgers in quant/kv-ledgers.json.`);
  return lines;
}

const without = (doc, id) => doc.stores.filter((store) => store.id !== id);

// The document with the store `id` replaced by data (or removed when data is null).
function splice(doc, id, data) {
  if (!doc) return doc;
  return { ...doc, stores: data ? [...without(doc, id), data] : without(doc, id) };
}

/**
 * A storage hook over the file storage that keeps one store in memory.
 * A load gives the disk state with the store of the session; a save writes
 * the disk copy of that store back (or none), never the store of the session.
 * @returns {{ storage: Object, setRemote: (data: Object) => void }}
 */
export function remoteOverlay(storage, id) {
  let remote = null;
  const withRemote = (doc) => (remote ? splice(doc, id, remote) : doc);
  return {
    storage: {
      load: () => withRemote(storage.load()),
      changed: () => storage.changed(),
      // The new remote state is kept only after the save: a failed save rolls it back too.
      transaction: async (run) => {
        let after = remote;
        await storage.transaction(async (fresh) => {
          const disk = fresh ? fresh.stores.find((store) => store.id === id) ?? null : null;
          const next = await run(withRemote(fresh));
          if (remote) after = next.stores.find((store) => store.id === id) ?? remote;
          return splice(next, id, disk);
        });
        remote = after;
      }
    },
    setRemote: (data) => { remote = data; }
  };
}

/** The snapshot with the store data in place of any store with the same id. */
export function withStore(snapshot, data) {
  return splice(snapshot, data.id, data);
}
