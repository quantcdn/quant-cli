/**
 * `quant kv --local`: read and write the local KV store of `quant serve`.
 * It needs no token. It uses the state file of quant serve, so a write is
 * seen by a running server, and it never seeds a store.
 */

import fs from 'node:fs';
import path from 'node:path';
import { select, text, isCancel } from '@clack/prompts';
import { openLocalKv } from '../serve/kv/wire.js';
import { pendingLedgerWarnings } from '../serve/kv/ledgers.js';
import { DEFAULT_FILES } from '../serve/project.js';
import { parseMeta, storeId } from '../helper/quant-meta.js';
import { resolveOptions } from './serve.js';

const REMOTE_MESSAGE = 'Remote KV commands are not available yet. Use --local.';
const ACTIONS = ['list', 'get', 'set', 'delete'];
const MAX_PAGES = 100;

/** A failure with a message for the user and no stack. */
class UsageError extends Error {}

function readStores(root, meta) {
  const file = path.resolve(root, meta);
  let json;
  try {
    json = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw new Error(`${meta}: the file cannot be read`);
  }
  return parseMeta(json, meta).stores;
}

// The id of a store name, or null when no id can be made.
function idOf(options, name) {
  try {
    return storeId(options.org, options.project, name);
  } catch (_err) {
    return null;
  }
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch (err) {
    throw new UsageError(`The value is not valid JSON: ${err.message}`);
  }
}

// An --equals value: a JSON scalar when it parses as one, else the text.
function scalarOf(text) {
  try {
    const value = JSON.parse(text);
    return value === null || typeof value !== 'object' ? value : text;
  } catch (_err) {
    return text;
  }
}

function equalsOf(pairs) {
  const equals = {};
  for (const pair of [].concat(pairs ?? [])) {
    const at = String(pair).indexOf('=');
    if (at < 1) throw new UsageError('--equals must look like field=value');
    equals[pair.slice(0, at)] = scalarOf(pair.slice(at + 1));
  }
  return equals;
}

function queryOf(args) {
  const query = { includeValues: true };
  if (args.prefix !== undefined) query.prefix = args.prefix;
  if (args.collection !== undefined) query.collection = args.collection;
  if (args.index !== undefined) {
    query.index = args.index;
    query.equals = equalsOf(args.equals);
  }
  return query;
}

async function listAll(store, args) {
  const items = [];
  for await (const item of store.list(queryOf(args)).items({ maxPages: MAX_PAGES })) items.push(item);
  return items;
}

function need(value, label) {
  if (value === undefined || value === '') throw new UsageError(`${label} is required`);
  return value;
}

const OPERATIONS = {
  list: (store, args) => listAll(store, args),
  get: (store, args) => store.getEntry(need(args.key, 'The key')),
  async set(store, args) {
    const value = parseJson(need(args.value, 'The JSON value'));
    const ifVersion = args['if-version'];
    await store.set(need(args.key, 'The key'), value, ifVersion === undefined ? undefined : { ifVersion });
    return store.getEntry(args.key);
  },
  async delete(store, args) {
    await store.delete(need(args.key, 'The key'));
    return { deleted: args.key };
  }
};

function describeError(err) {
  if (err instanceof UsageError) return err.message;
  return err.code ? `${err.code}: ${err.message}` : err.message;
}

async function execute(args, root, error) {
  if (!ACTIONS.includes(args.action)) throw new UsageError(`The action must be one of: ${ACTIONS.join(', ')}`);
  const options = resolveOptions({ org: args.org, project: args.project, meta: args.meta }, { root, gitUserName: () => null });
  const id = idOf(options, args.store);
  if (id === null) throw new UsageError(`FORBIDDEN: Access to KV store ${args.store} is not allowed`);
  // kv only creates missing stores: it declares no index and holds no index state.
  const stores = readStores(root, options.meta).map((store) => ({ ...store, indexes: [] }));
  const local = await openLocalKv({ root, org: options.org, project: options.project, stores });
  // The warnings come before the operation, so a failed operation keeps them.
  for (const warning of [...local.warnings, ...pendingLedgerWarnings(local.backend, local.backend.storeIds())]) error(warning);
  return OPERATIONS[args.action](local.kvStore.open(id), args);
}

/**
 * Run one kv command.
 * @param {Object} args The parsed flags and positionals.
 * @param {{ root?: string, print?: Function, error?: Function }} [deps]
 * @returns {Promise<number>} The exit code.
 */
export async function runKv(args, { root = process.cwd(), print = console.log, error = console.error } = {}) {
  if (!args.local) {
    error(REMOTE_MESSAGE);
    return 1;
  }
  try {
    print(JSON.stringify(await execute(args, root, error), null, 2));
    return 0;
  } catch (err) {
    error(describeError(err));
    return 1;
  }
}

// Ask for the action, the store and what the action needs. Null on cancel.
async function promptArgs() {
  const action = await select({ message: 'Operation', options: ACTIONS.map((value) => ({ value, label: value })) });
  if (isCancel(action)) return null;
  const store = await text({ message: 'Store name (from quant/meta.json)' });
  if (isCancel(store)) return null;
  const args = { local: true, action, store };
  if (action === 'list') return args;
  const key = await text({ message: 'Key' });
  if (isCancel(key)) return null;
  const value = action === 'set' ? await text({ message: 'JSON value' }) : undefined;
  return isCancel(value) ? null : { ...args, key, value };
}

export default {
  command: 'kv <action> <store> [key] [value]',
  describe: 'Read and write the local KV store (list, get, set, delete)',
  builder: (yargs) => yargs
    .positional('action', { type: 'string', choices: ACTIONS, describe: 'The operation' })
    .positional('store', { type: 'string', describe: 'The store name from quant/meta.json' })
    .positional('key', { type: 'string', describe: 'The key (get, set, delete)' })
    .positional('value', { type: 'string', describe: 'The JSON value (set)' })
    .option('local', { type: 'boolean', describe: 'Use the local store of quant serve' })
    .option('prefix', { type: 'string', describe: 'list: key prefix' })
    .option('collection', { type: 'string', describe: 'list: collection' })
    .option('index', { type: 'string', describe: 'list: index name' })
    .option('equals', { type: 'string', array: true, describe: 'list: field=value for the index (repeat)' })
    .option('if-version', { type: 'string', describe: 'set: write only if the key has this version' })
    .option('org', { type: 'string', describe: 'Organisation (default: quant.json clientid, then local)' })
    .option('project', { type: 'string', describe: 'Project (default: quant.json project, then dev)' })
    .option('meta', { type: 'string', default: DEFAULT_FILES.meta, describe: 'Template metadata with KV stores' }),
  promptArgs,
  async handler(args) {
    const code = await runKv(args);
    if (code !== 0) process.exit(code);
    return null;
  }
};
