import { RULE_UUID } from './functions-manifest.js';

const SLUG = /^[a-z][a-z0-9-]{0,47}$/;
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];
const DOMAIN = /^(any|[a-z0-9][a-z0-9.-]*)$/i;

/**
 * The rules manifest with each function_ref resolved to its function's uuid.
 * Every function in the manifest names its uuid (none is derived), so the
 * customer and project do not change the result. The caller validates
 * `functions` first (assertManifest): this does not check it again.
 */
export function resolveRules(manifest, functions) {
  if (!manifest || manifest.version !== 1 || !SLUG.test(manifest.namespace) || !Array.isArray(manifest.rules)) {
    throw new Error('Rules manifest requires version: 1, namespace and a rules array');
  }
  if (Buffer.byteLength(JSON.stringify(manifest)) > 65536 || manifest.rules.length > 100) throw new Error('Rules manifest exceeds size limits');
  const ids = new Map(functions.filter(fn => fn.id).map(fn => [fn.id, fn]));
  const seen = new Set();
  return { ...manifest, rules: manifest.rules.map(rule => {
    if (!rule || !SLUG.test(rule.id) || seen.has(rule.id)) throw new Error('Rules require unique lowercase ids');
    seen.add(rule.id);
    if (!['function', 'auth', 'filter'].includes(rule.type)) throw new Error(`Invalid rule type: ${rule.type}`);
    const result = rule.function_ref === undefined ? { ...rule } : resolveRef(rule, ids);
    if (!RULE_UUID.test(result.function_uuid || '')) throw new Error(`Invalid function UUID for rule: ${rule.id} (the rules API needs an RFC 4122 UUID, version 1-5)`);
    return result;
  }) };
}

function resolveRef(rule, ids) {
  if (rule.function_uuid !== undefined) throw new Error('Use function_ref or function_uuid, not both');
  const fn = ids.get(rule.function_ref);
  if (!fn) throw new Error(`Unknown function reference: ${rule.function_ref}`);
  const type = fn.type === 'edge' ? 'function' : fn.type;
  if (type !== rule.type) throw new Error(`Function type does not match rule: ${rule.id}`);
  const { function_ref: _ref, ...rest } = rule;
  return { ...rest, function_uuid: fn.uuid };
}

const badValue = value => typeof value !== 'string' || value === '' || value.length > 2048 || /[\x00-\x20\x7f]/.test(value);

function listErrors(values, field, valid, message) {
  if (!Array.isArray(values) || values.length > 50 || (field === 'urls' && values.length === 0)) return [`Invalid ${field} list.`];
  return values.flatMap(value => {
    if (badValue(value)) return [`Invalid ${field} value.`];
    return valid(value) ? [] : [message];
  });
}

function weightErrors(weight) {
  const valid = Number.isInteger(weight) && weight >= -100000 && weight <= 100000;
  return valid ? [] : ['Each rule needs an explicit weight between -100000 and 100000.'];
}

function ruleListErrors(rule) {
  return [
    ...listErrors(rule.urls, 'urls', v => v.startsWith('/'), 'Rule URLs must begin with /.'),
    ...listErrors(rule.domains ?? [], 'domains', v => DOMAIN.test(v), 'Invalid domain matcher.'),
    ...listErrors(rule.methods ?? [], 'methods', v => METHODS.includes(v), 'Invalid HTTP method.')
  ];
}

const RULE_FIELDS = ['id', 'type', 'name', 'urls', 'domains', 'methods', 'weight', 'disabled', 'function_uuid', 'function_ref'];
const MANIFEST_FIELDS = ['version', 'namespace', 'rules'];
const hasUnknownKey = (value, allowed) => Object.keys(value).some(key => !allowed.includes(key));

function fieldErrors(rule) {
  const errors = [];
  if (hasUnknownKey(rule, RULE_FIELDS)) errors.push('Unknown rules manifest fields.');
  if ('disabled' in rule && typeof rule.disabled !== 'boolean') errors.push('disabled must be boolean.');
  const name = rule.name;
  if (name !== undefined && name !== null && (typeof name !== 'string' || name.length > 200 || /[\x00-\x1f]/.test(name))) errors.push('Invalid rule name.');
  return errors;
}

/**
 * The checks the portal makes on a rules manifest that resolveRules does not:
 * unknown fields, name, disabled, urls, domains, methods and weight.
 * Returns the messages (empty when valid).
 */
export function ruleErrors(manifest) {
  const rules = Array.isArray(manifest?.rules) ? manifest.rules : [];
  const top = manifest && typeof manifest === 'object' && hasUnknownKey(manifest, MANIFEST_FIELDS) ? ['Unknown rules manifest fields.'] : [];
  return [...top, ...rules.flatMap(rule => {
    const r = rule && typeof rule === 'object' ? rule : {};
    return [...fieldErrors(r), ...weightErrors(r.weight), ...ruleListErrors(r)];
  })];
}

/** The rule as the local runtime matches it. `rule` is resolved (function_uuid set). */
export function toRuntimeRule(rule) {
  return {
    id: rule.id,
    type: rule.type,
    url: rule.urls,
    domain: rule.domains?.length ? rule.domains.map(d => d.toLowerCase()) : ['any'],
    methods: rule.methods?.length ? rule.methods : null,
    weight: rule.weight ?? 0,
    disabled: rule.disabled === true,
    fnUuid: String(rule.function_uuid).toLowerCase()
  };
}
