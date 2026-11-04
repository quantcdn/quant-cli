import { PortalError } from './client.js';

const PAGE_LIMIT = 1000;
const BATCH_SIZE = 100;
const MASKED = '[ENCRYPTED]';
const READ_SCOPE = 'kv:read';

const storePath = ({ customer, project }, leaf = '') =>
  `/organizations/${encodeURIComponent(customer)}/projects/${encodeURIComponent(project)}/kv${leaf}`;

const notLinked = name => new PortalError(`The KV store ${name} is not linked to this project.`, 404);
const scopeInfo = name => ({ scope: READ_SCOPE, what: `KV store ${name}` });

export async function findStore(client, { customer, project, name }) {
  const { status, body } = await client.get(storePath({ customer, project }), undefined, scopeInfo(name));
  const stores = status === 404 || !Array.isArray(body) ? [] : body;
  const found = stores.find(store => store && store.name === name);
  if (!found) throw notLinked(name);
  return { id: found.id, name: found.name, ...([1, 2].includes(found.format) ? { format: found.format } : {}) };
}

// Counts every request. With a counter (the onRequest hook of the client:
// { count }), the count is the counter, so 429 retries count too; else each
// call counts one, from `used`. `full` is true once the request cap is reached.
function budget(max, used, counter) {
  const own = { count: used };
  const source = counter || own;
  const state = { max, tick: () => { own.count += 1; } };
  Object.defineProperty(state, 'requests', { get: () => source.count });
  state.full = () => state.requests >= state.max;
  return state;
}

async function fetchOk(state, name, send) {
  state.tick();
  const { status, body } = await send(scopeInfo(name));
  if (status === 404) throw notLinked(name);
  return body;
}

function splitItem(item) {
  const { key, value, ...metadata } = item;
  return { key, value, metadata };
}

async function readValues(client, state, ctx, id, keys) {
  const entries = [];
  for (let start = 0; start < keys.length; start += BATCH_SIZE) {
    if (state.full()) return { entries, complete: false };
    const chunk = keys.slice(start, start + BATCH_SIZE);
    const body = await fetchOk(state, ctx.name, info => client.post(storePath(ctx, `/${encodeURIComponent(id)}/batch-get`), { keys: chunk }, info));
    const items = Array.isArray(body?.items) ? body.items : [];
    for (const item of items) if (item && typeof item.key === 'string') entries.push(splitItem(item));
  }
  return { entries, complete: true };
}

function readIndexes(client, state, ctx, id) {
  return fetchOk(state, ctx.name, info => client.get(storePath(ctx, `/${encodeURIComponent(id)}/indexes`), undefined, info))
    .then(body => (Array.isArray(body?.indexes) ? body.indexes : []));
}

function readKeysPage(client, state, ctx, id, cursor) {
  const query = { limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) };
  return fetchOk(state, ctx.name, info => client.get(storePath(ctx, `/${encodeURIComponent(id)}/keys`), query, info));
}

const pageKeys = page => (Array.isArray(page?.data) ? page.data : []).map(row => row?.key).filter(key => typeof key === 'string');

// Why a page stops the read: 'requests' (the request cap cut the values),
// 'keys' (maxKeys), 'cursor' (has_more with no cursor: the rest cannot be
// read), or null (the read goes on, or the list has ended).
function stopReason({ complete, room, count, hasMore, more }) {
  if (!complete) return 'requests';
  if (room < count || (more && room <= count)) return 'keys';
  return hasMore && !more ? 'cursor' : null;
}

// Reads one page of keys and their values. Returns the next cursor, or the stop reason.
async function readPage(client, state, ctx, id, { cursor, room }) {
  const page = await readKeysPage(client, state, ctx, id, cursor);
  const all = pageKeys(page);
  const values = await readValues(client, state, ctx, id, all.slice(0, room));
  const hasMore = page?.has_more === true;
  const more = hasMore && Boolean(page.next_cursor);
  const stop = stopReason({ complete: values.complete, room, count: all.length, hasMore, more });
  return { entries: values.entries, next: more && !stop ? page.next_cursor : null, stop };
}

export async function readStore(client, ctx, id, { maxKeys = 10000, maxRequests = 200 } = {}) {
  const state = budget(maxRequests, ctx.requestsUsed ?? 0, ctx.counter);
  const entries = [];
  const indexes = state.full() ? [] : await readIndexes(client, state, ctx, id);
  let cursor;
  let stoppedBy = null;
  do {
    if (state.full()) {
      stoppedBy = 'requests';
      break;
    }
    const page = await readPage(client, state, ctx, id, { cursor, room: maxKeys - entries.length });
    entries.push(...page.entries);
    stoppedBy = page.stop;
    cursor = page.next;
  } while (cursor);
  const masked = entries.filter(entry => entry.value === MASKED).length;
  return { entries, indexes, masked, truncated: stoppedBy !== null, stoppedBy, requests: state.requests };
}
