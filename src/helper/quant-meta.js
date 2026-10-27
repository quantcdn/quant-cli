// Validation of the kv_stores section of quant/meta.json. The messages match
// the ones the Quant portal shows, so a local run and a deploy agree.

const MAX_REVEALS = 4;
const MAX_INDEXES = 20;
const MAX_INDEXES_PER_COLLECTION = 5;
const INDEX_KEYS = ['name', 'collection', 'fields', 'sortBy', 'unique', 'count'];
const RESERVED_FIELDS = ['__proto__', 'constructor', 'prototype'];
const SHA256 = '{sha256}';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const bytesOf = value => Buffer.byteLength(JSON.stringify(value));
const fail = message => { throw new Error(message); };
const onlyKeys = (value, allowed) => Object.keys(value).every(key => allowed.includes(key));

function assertCollection(collection, name) {
  const segments = typeof collection === 'string' && collection.length <= 1024 ? collection.split(':') : null;
  const valid = segments && segments.every(s => s !== '' && (s === '*' || !s.includes('*')));
  if (!valid) fail(`Index ${name}: collection must be 1–1024 characters of non-empty ':' segments; '*' is allowed only as a whole segment.`);
}

function assertFieldName(field, name, where) {
  const valid = typeof field === 'string' && /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(field) && !RESERVED_FIELDS.includes(field);
  if (!valid) fail(`Index ${name}: ${where} must use field names of 1–64 letters, digits or underscores, not starting with a digit.`);
}

function assertIndexFields(fields, name) {
  if (!Array.isArray(fields) || fields.length > 3) fail(`Index ${name}: fields must be a list of 0–3 distinct field names.`);
  fields.forEach(field => assertFieldName(field, name, 'fields'));
  if (new Set(fields).size !== fields.length) fail(`Index ${name}: fields must be a list of 0–3 distinct field names.`);
}

function assertIndexFlags(index, name) {
  for (const flag of ['unique', 'count']) {
    if (flag in index && typeof index[flag] !== 'boolean') fail(`Index ${name}: ${flag} must be true or false.`);
  }
  if (index.unique && index.count) fail(`Index ${name}: an index cannot be both unique and count.`);
  if (index.unique && index.fields.length === 0) fail(`Index ${name}: a unique index needs at least one field.`);
}

function validateIndex(index) {
  if (!isObject(index)) fail('indexes: each index must be an object.');
  const name = index.name;
  if (typeof name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(name)) {
    fail('indexes: each index needs a name of 1–64 letters, digits or underscores, starting with a letter.');
  }
  if (!onlyKeys(index, INDEX_KEYS)) fail(`Index ${name}: accepts only ${INDEX_KEYS.join(', ')}.`);
  assertCollection(index.collection, name);
  assertIndexFields(index.fields ?? null, name);
  assertIndexFlags(index, name);
  if ('sortBy' in index) assertFieldName(index.sortBy, name, 'sortBy');
  return name;
}

function validateIndexes(indexes) {
  if (!Array.isArray(indexes) || indexes.length > MAX_INDEXES) fail(`indexes: must be a list of at most ${MAX_INDEXES} indexes.`);
  const names = new Set();
  const collections = new Map();
  for (const index of indexes) {
    const name = validateIndex(index);
    if (names.has(name)) fail(`Index ${name}: the name is already used in this store.`);
    names.add(name);
    const count = (collections.get(index.collection) || 0) + 1;
    collections.set(index.collection, count);
    if (count > MAX_INDEXES_PER_COLLECTION) fail(`Index ${name}: at most ${MAX_INDEXES_PER_COLLECTION} indexes may use the same collection.`);
  }
}

export function normaliseIndex(index) {
  const out = { name: index.name, collection: index.collection, fields: index.fields ?? [] };
  if (typeof index.sortBy === 'string' && index.sortBy !== '') out.sortBy = index.sortBy;
  if (index.unique === true) out.unique = true;
  if (index.count === true) out.count = true;
  return out;
}

function assertKey(key, keys) {
  const valid = typeof key === 'string' && key !== '' && Buffer.byteLength(key) <= 512 && !/[\x00-\x1f\x7f]/.test(key) && !keys.has(key);
  if (!valid) fail('Initial KV keys must be unique, non-empty strings without control characters (maximum 512 bytes).');
  keys.add(key);
}

function assertGenerateShape(generate, key) {
  if (!isObject(generate) || !onlyKeys(generate, ['bytes', 'reveal', 'label'])) fail(`Initial value ${key}: generate accepts only bytes, reveal and label.`);
  if (!Number.isInteger(generate.bytes) || generate.bytes < 16 || generate.bytes > 64) fail(`Initial value ${key}: generate.bytes must be an integer from 16 to 64.`);
  const label = generate.label;
  if ('label' in generate && (typeof label !== 'string' || label === '' || label.length > 80)) fail(`Initial value ${key}: generate.label must be text of at most 80 characters.`);
}

function assertRevealOnce(item, key) {
  if (item.generate.reveal !== 'once') fail(`Initial value ${key}: generate.reveal must be "once".`);
  if (key.split(SHA256).length !== 2) fail(`Initial value ${key}: a value revealed once is stored by its hash, so the key must contain ${SHA256} once.`);
  if (item.encrypted) fail(`Initial value ${key}: a revealed value is stored only as a hash; encrypted does not apply.`);
}

function validateGenerated(item, key) {
  assertGenerateShape(item.generate, key);
  if (item.generate.reveal !== undefined) return assertRevealOnce(item, key);
  if ('value' in item || key.includes(SHA256)) {
    fail(`Initial value ${key}: a generated secret stores the random value itself; use reveal: "once" with ${SHA256} to store a record under its hash.`);
  }
}

function assertPlainValue(item, key) {
  if (!('value' in item)) fail(`Initial value ${key}: declare a value or generate one.`);
  if (key.includes(SHA256)) fail(`Initial value ${key}: ${SHA256} is only allowed in a key whose value is generated and revealed once.`);
}

function validateValue(item, keys) {
  if (!isObject(item) || !onlyKeys(item, ['key', 'value', 'generate', 'encrypted'])) fail('Each initial value accepts only key, value, generate and encrypted.');
  assertKey(item.key, keys);
  if ('encrypted' in item && typeof item.encrypted !== 'boolean') fail(`Initial value ${item.key}: encrypted must be true or false.`);
  if ('generate' in item) validateGenerated(item, item.key);
  else assertPlainValue(item, item.key);
  if ('value' in item && bytesOf(item.value) > 16384) fail('Each initial KV value must be at most 16 KiB of JSON.');
}

function validateInitialValues(values) {
  if (!Array.isArray(values) || values.length > 100) fail('initial_values must be a list of at most 100 key/value pairs.');
  const keys = new Set();
  values.forEach(item => validateValue(item, keys));
  const reveals = values.filter(item => item.generate?.reveal === 'once').length;
  if (reveals > MAX_REVEALS) fail(`At most ${MAX_REVEALS} generated values per store may be revealed once.`);
}

function validateStore(store, names) {
  if (!isObject(store) || !onlyKeys(store, ['name', 'initial_values', 'indexes'])) fail('Each KV store accepts only name, initial_values and indexes.');
  if (typeof store.name !== 'string' || !/^[a-z][a-z0-9-]{0,47}$/.test(store.name) || names.has(store.name)) {
    fail('KV store names must be unique lowercase slugs of 1–48 characters.');
  }
  names.add(store.name);
  validateIndexes(store.indexes ?? []);
  validateInitialValues(store.initial_values ?? []);
}

function validateStores(stores) {
  if (!Array.isArray(stores) || stores.length > 10) fail('kv_stores must be a list of at most 10 stores.');
  const names = new Set();
  let total = 0;
  for (const store of stores) {
    validateStore(store, names);
    total += (store.initial_values ?? []).length;
    if (total > 100) fail('At most 100 initial values may be declared across all stores.');
  }
  if (bytesOf(stores) > 65536) fail('KV declarations must be at most 64 KiB of JSON in total.');
}

function toStore(store) {
  return {
    name: store.name,
    indexes: (store.indexes ?? []).map(normaliseIndex),
    initialValues: store.initial_values ?? []
  };
}

function readDocument(json) {
  if (typeof json !== 'string') return json;
  try {
    return JSON.parse(json);
  } catch (error) {
    // Older templates ship meta.json that is not valid JSON and declares no stores.
    if (!json.includes('kv_stores')) return {};
    throw error;
  }
}

function metaOf(document) {
  const meta = Array.isArray(document) ? document[0] : document;
  if (!isObject(meta)) fail('Template metadata must be an object or a one-element object array.');
  return meta;
}

/**
 * The KV stores that quant/meta.json declares, validated with the portal rules.
 * `json` is the file text or the parsed document. Throws `<source>: <message>`.
 */
export function parseMeta(json, source) {
  try {
    const meta = metaOf(readDocument(json));
    const stores = 'kv_stores' in meta ? meta.kv_stores : [];
    validateStores(stores);
    return { stores: stores.map(toStore) };
  } catch (error) {
    throw new Error(`${source}: ${error.message}`);
  }
}

/** The platform id of a store: org, project and the declared name. */
export function storeId(org, project, name) {
  const id = `${org}-${project}-${name}`;
  if (id.length > 255) throw new Error('The KV store id is longer than 255 characters');
  return id;
}
