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
  return { id: found.id, name: found.name };
}

// Counts every request. `full` is true once the request cap is reached.
function budget(max, used) {
  const state = { requests: used, max };
  state.full = () => state.requests >= state.max;
  return state;
}

async function fetchOk(state, name, send) {
  state.requests += 1;
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

// Reads one page of keys and their values. Returns the next cursor, or a stop flag.
async function readPage(client, state, ctx, id, { cursor, room }) {
  const page = await readKeysPage(client, state, ctx, id, cursor);
  const all = pageKeys(page);
  const values = await readValues(client, state, ctx, id, all.slice(0, room));
  const more = page?.has_more === true && Boolean(page.next_cursor);
  const cut = !values.complete || room < all.length || (more && room <= all.length);
  return { entries: values.entries, next: more ? page.next_cursor : null, cut };
}

export async function readStore(client, ctx, id, { maxKeys = 10000, maxRequests = 200 } = {}) {
  const state = budget(maxRequests, ctx.requestsUsed ?? 0);
  const entries = [];
  const indexes = state.full() ? [] : await readIndexes(client, state, ctx, id);
  let cursor;
  let truncated = false;
  do {
    truncated = state.full();
    if (truncated) break;
    const page = await readPage(client, state, ctx, id, { cursor, room: maxKeys - entries.length });
    entries.push(...page.entries);
    truncated = page.cut;
    cursor = truncated ? null : page.next;
  } while (cursor);
  const masked = entries.filter(entry => entry.value === MASKED).length;
  return { entries, indexes, masked, truncated, requests: state.requests };
}
