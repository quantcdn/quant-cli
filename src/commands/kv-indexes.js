import fs from 'node:fs';
import axios from 'axios';
import { text, isCancel } from '@clack/prompts';
import { rulesOptions } from './rules.js';
import { parseMeta, storeId, normaliseIndex } from '../helper/quant-meta.js';

const DEFAULT_META = 'quant/meta.json';
const MAX_TRIES = 3;
const MAX_WAIT_SECONDS = 60;
const NONE_DECLARED = 'No KV indexes declared';
const SCOPE_WARNING = 'The deploy token cannot declare KV indexes (it needs the kv:read and kv:write scopes). Indexes in quant/meta.json were not declared.';
const FORMAT_2_MESSAGE = 'Upgrade this store to format 2 in Compute > K/V Stores, then deploy again.';

const sleep = seconds => new Promise(resolve => setTimeout(resolve, seconds * 1000));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const safeCode = error => (/^[A-Z_]{1,40}$/.test(error.response?.data?.code) ? error.response.data.code : null);

/** A failure that stops the run. The message never holds upstream text. */
class SyncError extends Error {}
/** The token lacks the scope the index routes need. */
class ScopeError extends Error {}

function readMeta(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`${file}: the file cannot be read`);
  }
}

function declaredStores(file) {
  const json = readMeta(file);
  if (json === null) return [];
  return parseMeta(json, file).stores.filter(store => store.indexes.length > 0);
}

function retryAfter(error) {
  const seconds = Number(error.response?.headers?.['retry-after']);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.min(seconds, MAX_WAIT_SECONDS) : 1;
}

async function send(call) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      if (error.response?.status !== 429 || attempt >= MAX_TRIES) throw error;
      await sleep(retryAfter(error));
    }
  }
}

function isScopeDenied(error) {
  return error.response?.status === 403 && error.response?.data?.code === 'SCOPE_REQUIRED';
}

function isAlreadyExists(error) {
  const data = error.response?.data;
  return error.response?.status === 400 && data?.code === 'VALIDATION' && /already exists/i.test(String(data?.message));
}

function failure(error) {
  if (isScopeDenied(error)) return new ScopeError(SCOPE_WARNING);
  if (error.response?.data?.code === 'REQUIRES_FORMAT_2') return new SyncError(FORMAT_2_MESSAGE);
  const detail = safeCode(error);
  return new SyncError(`KV index sync failed (${error.response?.status || error.code || 'network error'}${detail ? ` ${detail}` : ''}). Check portal URL, token scopes and project access.`);
}

function request(options, name) {
  const org = encodeURIComponent(options.customer);
  const project = encodeURIComponent(options.project);
  return {
    url: `${options.base}/organizations/${org}/projects/${project}/kv/${encodeURIComponent(name)}/indexes`,
    config: { headers: { Authorization: `Bearer ${options.token}`, Accept: 'application/json' }, timeout: 60000, maxRedirects: 0 }
  };
}

async function listLive(options, id) {
  const { url, config } = request(options, id);
  try {
    const response = await send(() => axios.get(url, config));
    return Array.isArray(response.data?.indexes) ? response.data.indexes : [];
  } catch (error) {
    throw failure(error);
  }
}

async function declare(options, id, index) {
  const { url, config } = request(options, id);
  try {
    await send(() => axios.post(url, index, config));
  } catch (error) {
    if (!isAlreadyExists(error)) throw failure(error);
  }
}

const normaliseLive = live => normaliseIndex({
  name: live.name, collection: live.collection, fields: live.fields, sortBy: live.sortBy, unique: live.unique, count: live.count
});

function judgeLive(declared, live) {
  if (!same(normaliseLive(live), declared)) return { status: 'conflict', message: 'the live definition differs from the one in meta.json' };
  if (live.state === 'ACTIVE') return { status: 'ready' };
  if (live.state === 'BUILDING') return { status: 'building' };
  if (live.state === 'DROPPING') return { status: 'failed', message: 'the index is being dropped' };
  const code = /^[A-Z_]{1,40}$/.test(live.error) ? live.error : 'unknown error';
  return { status: 'failed', message: `the index build failed (${code})` };
}

async function reconcile(options, id, index, live, dryRun) {
  if (live) return judgeLive(index, live);
  if (dryRun) return { status: 'declared', message: '(dry run)' };
  await declare(options, id, index);
  return { status: 'declared' };
}

async function reconcileStore(options, store, dryRun) {
  const id = storeId(options.customer, options.project, store.name);
  const liveByName = new Map((await listLive(options, id)).map(live => [live?.name, live]));
  const results = [];
  for (const index of store.indexes) {
    const result = await reconcile(options, id, index, liveByName.get(index.name), dryRun);
    results.push({ line: `${store.name}/${index.name}: ${result.status}${result.message ? ` ${result.message}` : ''}`, bad: ['failed', 'conflict'].includes(result.status) });
  }
  return results;
}

async function storeResults(options, store, dryRun) {
  try {
    return { results: await reconcileStore(options, store, dryRun), scopeError: null };
  } catch (error) {
    if (!(error instanceof ScopeError)) throw error;
    return { results: [], scopeError: error };
  }
}

// A missing scope stops the run (the same token is used for each store), but
// the results of the stores before it still count.
async function reconcileAll(options, stores, dryRun) {
  const results = [];
  for (const store of stores) {
    const outcome = await storeResults(options, store, dryRun);
    for (const result of outcome.results) {
      console.log(result.line);
      results.push(result);
    }
    if (outcome.scopeError) return { results, scopeError: outcome.scopeError };
  }
  return { results, scopeError: null };
}

async function run(args) {
  const stores = declaredStores(args.meta || DEFAULT_META);
  if (stores.length === 0) return NONE_DECLARED;
  const { results, scopeError } = await reconcileAll(rulesOptions(args), stores, Boolean(args['dry-run']));
  if (scopeError) console.warn(scopeError.message);
  const bad = results.filter(result => result.bad).length;
  if (bad > 0) throw new Error(`${bad} KV ${bad === 1 ? 'index is' : 'indexes are'} failed or in conflict with meta.json.`);
  if (scopeError) return undefined;
  return args['dry-run'] ? 'KV indexes checked; nothing was declared' : 'KV indexes are in sync';
}

export default {
  command: 'kv-indexes [meta]',
  describe: 'Declare the KV indexes in quant/meta.json with a separate project-scoped portal API token',
  builder: yargs => yargs.positional('meta', { type: 'string', default: DEFAULT_META, describe: 'Template metadata with KV stores' })
    .option('api-token', { type: 'string', describe: 'Scoped portal token (prefer QUANT_API_TOKEN)' })
    .option('api-base-url', { type: 'string', describe: 'Portal /api/v2 URL (or QUANT_BASE_URL)' })
    .option('dry-run', { type: 'boolean', default: false, describe: 'Report what would be declared without declaring it' }),
  promptArgs: async () => {
    const meta = await text({ message: 'Path to meta.json', placeholder: DEFAULT_META });
    return isCancel(meta) ? null : { meta: meta || DEFAULT_META };
  },
  async handler(args) {
    return run(args);
  }
};
