/**
 * Seeding of a local KV store at its first start (and after --reset):
 * `initial_values` from quant/meta.json with the portal rules, then the dev
 * fixtures in quant/kv-fixtures/<store-name>.json. Every write is a set with
 * ifAbsent, so a value that exists stays, and the size limits and unique
 * indexes apply. A marker records the seed, so a restart does not seed again.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import { appendRevealedKey } from './kv/state.js';

export const MAX_FIXTURE_BYTES = 1024 * 1024;
export const MAX_FIXTURE_ENTRIES = 5000;
const SHA256 = '{sha256}';
const USER_NAME = /\{user_name\}/g;
const DATE_OFFSET = /^(now|[+-]\d+[mhd])$/;
const UNIT_MS = { m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const randomHex = (bytes) => crypto.randomBytes(bytes).toString('hex');

// Apply fn to every string, deep in arrays and objects. Other values stay.
function mapStrings(value, fn) {
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item, fn)]));
  return value;
}

function dateOf(token, now) {
  const offset = token.$date;
  if (typeof offset !== 'string' || !DATE_OFFSET.test(offset)) {
    throw new Error(`$date must be "now" or a signed number with m, h or d (for example "-14d"), not ${JSON.stringify(offset)}`);
  }
  const ms = offset === 'now' ? 0 : Number(offset.slice(0, -1)) * UNIT_MS[offset.slice(-1)];
  const iso = new Date(now + ms).toISOString();
  return token.format === 'date' ? iso.slice(0, 10) : iso;
}

/**
 * Replace each `{ "$date": "<offset>" }` in the value with an ISO 8601 string
 * (`format: 'date'` gives YYYY-MM-DD). The offset is `now` or a signed number
 * with the unit m, h or d.
 */
export function resolveDates(value, now) {
  if (Array.isArray(value)) return value.map((item) => resolveDates(item, now));
  if (!isObject(value)) return value;
  if ('$date' in value) return dateOf(value, now);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, resolveDates(item, now)]));
}

function checkSeedKey(seedKey, bytes) {
  const pattern = new RegExp(`^[0-9a-fA-F]{${bytes * 2}}$`);
  if (!pattern.test(seedKey)) throw new Error(`--seed-key must be ${bytes * 2} hex characters`);
  return seedKey.toLowerCase();
}

// The write for one entry: { key, value, options, reveal } with the
// generated value, the {sha256} key and the {user_name} replacements.
function planEntry(entry, ctx) {
  const generate = entry.generate;
  const value = 'value' in entry ? mapStrings(entry.value, (text) => text.replace(USER_NAME, ctx.userName)) : true;
  const options = entry.encrypted ? { ifAbsent: true, secret: true } : { ifAbsent: true };
  if (!generate) return { key: entry.key, value, options };
  if (generate.reveal !== 'once') return { key: entry.key, value: randomHex(generate.bytes), options };
  const useSeedKey = ctx.seedKey !== undefined && !ctx.seedKeyUsed;
  const secret = useSeedKey ? checkSeedKey(ctx.seedKey, generate.bytes) : randomHex(generate.bytes);
  if (useSeedKey) ctx.seedKeyUsed = true;
  return {
    key: entry.key.replace(SHA256, digest(secret)),
    value,
    options,
    reveal: { label: generate.label || entry.key, value: secret }
  };
}

// set with ifAbsent: a CONFLICT means that the key exists, and it stays.
async function writeAbsent(store, plan) {
  try {
    await store.set(plan.key, plan.value, plan.options);
    return true;
  } catch (err) {
    if (err && err.code === 'CONFLICT') return false;
    throw err;
  }
}

async function writeEntry(store, entry, ctx) {
  const plan = planEntry(entry, ctx);
  const written = await writeAbsent(store, plan);
  if (written && plan.reveal) {
    ctx.revealed.push(plan.reveal);
    if (ctx.keysPath) appendRevealedKey(ctx.keysPath, plan.reveal.label, plan.reveal.value);
  }
}

function parseFixtures(file, text) {
  let entries;
  try {
    entries = JSON.parse(text);
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(entries)) throw new Error(`${file} must be a JSON array of entries.`);
  if (entries.length > MAX_FIXTURE_ENTRIES) throw new Error(`${file} has more than 5,000 entries.`);
  return entries;
}

/** The fixture entries of a store, or [] when the file does not exist. */
function readFixtures(file) {
  if (!file || !fs.existsSync(file)) return [];
  if (fs.statSync(file).size > MAX_FIXTURE_BYTES) throw new Error(`${file} is larger than 1 MiB.`);
  return parseFixtures(file, fs.readFileSync(file, 'utf8'));
}

function fixtureKey(entry) {
  return isObject(entry) && typeof entry.key === 'string' && entry.key !== '' ? entry.key : '?';
}

async function writeFixture(store, entry, ctx, where) {
  try {
    if (fixtureKey(entry) === '?') throw new Error('each entry needs a key');
    const dated = 'value' in entry ? { ...entry, value: resolveDates(entry.value, ctx.now()) } : entry;
    await writeEntry(store, dated, ctx);
  } catch (err) {
    throw new Error(`${where.file} entry ${where.n} (${fixtureKey(entry)}): ${err.message}`);
  }
}

/**
 * Seed one store.
 * @param {Object} store The store handle (kvStore.open(id)).
 * @param {Object} options
 * @param {Object} options.definition The store from parseMeta(): { name, indexes, initialValues }.
 * @param {string|null} options.fixturesFile quant/kv-fixtures/<store-name>.json.
 * @param {string} options.userName The {user_name} value.
 * @param {string} [options.seedKey] The value of the first reveal-once entry (--seed-key).
 * @param {string|null} options.keysPath The keys file for revealed keys (null: no file).
 * @param {() => number} [options.now]
 * @param {{ seeded: boolean, mark: () => Promise<void> }} options.marker The seed marker.
 * @returns {Promise<{ revealed: { label: string, value: string }[], fixtures: number }>}
 */
export async function seedStore(store, { definition, fixturesFile, userName, seedKey, keysPath, now = Date.now, marker }) {
  if (marker.seeded) return { revealed: [], fixtures: 0 };
  const ctx = { userName, seedKey, seedKeyUsed: false, keysPath, now, revealed: [] };
  try {
    for (const entry of definition.initialValues) await writeEntry(store, entry, ctx);
    const fixtures = readFixtures(fixturesFile);
    for (const [i, entry] of fixtures.entries()) await writeFixture(store, entry, ctx, { file: fixturesFile, n: i + 1 });
    await marker.mark();
    return { revealed: ctx.revealed, fixtures: fixtures.length };
  } catch (err) {
    // The keys that were revealed before the failure stay available to the caller.
    err.revealed = ctx.revealed;
    throw err;
  }
}
