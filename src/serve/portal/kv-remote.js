import { PortalError, RequestLimitError } from './client.js';

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

async function fetchOk(name, send) {
  const { status, body } = await send(scopeInfo(name));
  if (status === 404) throw notLinked(name);
  return body;
}

function splitItem(item) {
  const { key, value, ...metadata } = item;
  return { key, value, metadata };
}

// Reads the values of `keys` into `entries`, 100 keys for each request.
async function readValues(client, ctx, id, keys, entries) {
  for (let start = 0; start < keys.length; start += BATCH_SIZE) {
    const chunk = keys.slice(start, start + BATCH_SIZE);
    const body = await fetchOk(ctx.name, info => client.post(storePath(ctx, `/${encodeURIComponent(id)}/batch-get`), { keys: chunk }, info));
    const items = Array.isArray(body?.items) ? body.items : [];
    for (const item of items) if (item && typeof item.key === 'string') entries.push(splitItem(item));
  }
}

function readIndexes(client, ctx, id) {
  return fetchOk(ctx.name, info => client.get(storePath(ctx, `/${encodeURIComponent(id)}/indexes`), undefined, info))
    .then(body => (Array.isArray(body?.indexes) ? body.indexes : []));
}

function readKeysPage(client, ctx, id, cursor) {
  const query = { limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) };
  return fetchOk(ctx.name, info => client.get(storePath(ctx, `/${encodeURIComponent(id)}/keys`), query, info));
}

const pageKeys = page => (Array.isArray(page?.data) ? page.data : []).map(row => row?.key).filter(key => typeof key === 'string');

// Why a page stops the read: 'keys' (maxKeys), 'cursor' (has_more with no
// cursor: the rest cannot be read), or null (the read goes on, or the list
// has ended). The request budget stops the read with 'requests' (see readStore).
function stopReason({ room, count, hasMore, more }) {
  if (room < count || (more && room <= count)) return 'keys';
  return hasMore && !more ? 'cursor' : null;
}

// Reads one page of keys and their values into `entries`. Returns the next cursor, or the stop reason.
async function readPage(client, ctx, id, { cursor, room, entries }) {
  const page = await readKeysPage(client, ctx, id, cursor);
  const all = pageKeys(page);
  await readValues(client, ctx, id, all.slice(0, room), entries);
  const hasMore = page?.has_more === true;
  const more = hasMore && Boolean(page.next_cursor);
  const stop = stopReason({ room, count: all.length, hasMore, more });
  return { next: more && !stop ? page.next_cursor : null, stop };
}

async function readPages(client, ctx, id, { maxKeys, entries }) {
  let cursor;
  let page;
  do {
    page = await readPage(client, ctx, id, { cursor, room: maxKeys - entries.length, entries });
    cursor = page.next;
  } while (cursor);
  return page.stop;
}

/**
 * Read the index definitions, the keys and the values of a store. The
 * request budget of the client caps the read: when it is spent, the read
 * stops with the entries so far (truncated, stoppedBy 'requests').
 */
export async function readStore(client, ctx, id, { maxKeys = 10000 } = {}) {
  const entries = [];
  const read = { indexes: [], stoppedBy: null };
  try {
    read.indexes = await readIndexes(client, ctx, id);
    read.stoppedBy = await readPages(client, ctx, id, { maxKeys, entries });
  } catch (err) {
    if (!(err instanceof RequestLimitError)) throw err;
    read.stoppedBy = 'requests';
  }
  const masked = entries.filter(entry => entry.value === MASKED).length;
  return { entries, indexes: read.indexes, masked, truncated: read.stoppedBy !== null, stoppedBy: read.stoppedBy };
}
