/**
 * The edge function manifest schema (quant/edge-functions.json).
 *
 * The same rules as the Quant portal (App\Helpers\TemplateManifestPaths), so a
 * manifest that passes here passes there, and the reverse. Every entry names
 * its function by an explicit uuid: no tool derives one.
 */

/**
 * UUID shape only (8-4-4-4-12 hex). The version and variant digits are not
 * checked: deployed manifests hold UUIDs with other version digits, and the
 * functions API accepts them.
 */
export const MANIFEST_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The rules API needs an RFC 4122 UUID (version 1-5) for a function a rule references. */
export const RULE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const FUNCTION_ID = /^[a-z][a-z0-9-]{0,47}$/;

export const FUNCTION_TYPES = ['function', 'edge', 'auth', 'filter'];

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalisePath(path) {
  return path.replace(/^(\.\/)+/, '');
}

/** "Entry 2 (quant/edge-functions/api.js)": how messages name an entry. */
export function entryLabel(index, entry) {
  const path = isObject(entry) && typeof entry.path === 'string' ? normalisePath(entry.path) : '';
  return path === '' ? `Entry ${index}` : `Entry ${index} (${path})`;
}

function isUuid(uuid) {
  return typeof uuid === 'string' && MANIFEST_UUID.test(uuid);
}

/** PHP trim()'s characters, so a description passes here exactly when it passes the portal. */
function phpTrim(value) {
  return value.replace(/^[ \t\n\r\0\x0B]+|[ \t\n\r\0\x0B]+$/g, '');
}

/** The required fields, in the portal's order: uuid, path, type, description. */
function requiredFieldErrors(entry) {
  const errors = [];
  if (entry.uuid === undefined || entry.uuid === null || entry.uuid === '') {
    errors.push('uuid is required');
  } else if (!isUuid(entry.uuid)) {
    errors.push('uuid is not a valid UUID');
  }
  if (typeof entry.path !== 'string' || normalisePath(entry.path) === '') errors.push('path is required');
  if (!FUNCTION_TYPES.includes(entry.type)) errors.push('type must be function, edge, auth or filter');
  if (typeof entry.description !== 'string' || phpTrim(entry.description) === '') errors.push('description is required');
  return errors;
}

function duplicateUuidErrors(uuid, seen) {
  if (!isUuid(uuid)) return [];
  const key = uuid.toLowerCase();
  if (seen.uuid.has(key)) return ['uuid is used by another entry'];
  seen.uuid.add(key);
  return [];
}

function idErrors(entry, seen) {
  if (!('id' in entry)) return [];
  if (typeof entry.id !== 'string' || !FUNCTION_ID.test(entry.id)) {
    return ['id must be a lowercase slug that starts with a letter (1-48 characters)'];
  }
  if (seen.id.has(entry.id)) return ['id is used by another entry'];
  seen.id.add(entry.id);
  return [];
}

function entryErrors(entry, seen) {
  if (!isObject(entry)) return ['each entry must be an object'];
  return [...requiredFieldErrors(entry), ...duplicateUuidErrors(entry.uuid, seen), ...idErrors(entry, seen)];
}

/**
 * Every problem in a function manifest, one message per problem, each naming
 * its entry. An empty list means the manifest is valid.
 *
 * @param {unknown} manifest the parsed JSON
 * @returns {string[]}
 */
export function manifestErrors(manifest) {
  if (!Array.isArray(manifest)) return ['The function manifest must be a JSON array.'];
  const seen = { uuid: new Set(), id: new Set() };
  return manifest.flatMap((entry, index) => entryErrors(entry, seen).map(message => `${entryLabel(index, entry)}: ${message}`));
}

/**
 * Throw when the manifest is not valid, listing every problem, before anything
 * is uploaded.
 *
 * @param {unknown} manifest the parsed JSON
 * @param {string} source the file name, for the message
 */
export function assertManifest(manifest, source) {
  const errors = manifestErrors(manifest);
  if (errors.length > 0) {
    throw new Error(`${source} is not a valid function manifest:\n  ${errors.join('\n  ')}`);
  }
}
