/**
 * `quant serve --pull-rules`: read the rules of the project from the portal
 * one time at start, and run them locally in edge order with the rules of
 * quant/edge-rules.json.
 *
 * The pulled list and its action settings stay in memory only. A rule's
 * settings can hold credentials, so no message prints a setting value.
 */

import { PortalError } from './client.js';
import { orderRules } from '../rules.js';

export const PARTIAL_WARNING = 'Some rule types are not in the portal response for this organisation, so they do not run locally.';
export const HEADERS_SCOPE_WARNING = 'QUANT_API_TOKEN lacks projects:read, so the portal\'s global headers are not used.';

// Action settings that are booleans, but can arrive as text.
const BOOLEAN_SETTINGS = [
  'only_proxy_404', 'static_error_page', 'waf_enabled', 'disable_ssl_verify', 'failover_mode',
  'proxy_alert_enabled', 'proxy_inline_fn_enabled', 'application_proxy'
];
// Action settings that are lists of status codes.
const STATUS_LISTS = ['status_codes', 'static_error_page_status_codes'];
// Request conditions that quant serve does not check. A rule that uses one is skipped.
const UNCHECKED_CONDITIONS = ['country', 'ip', 'asn', 'ua', 'traffic_source'];
const TRUE_TEXT = ['true', '1'];
// A numeric string as the portal reads one: optional white space and sign,
// digits with an optional fraction, an optional exponent.
const NUMERIC_TEXT = /^[ \t\n\r\v\f]*[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?[ \t\n\r\v\f]*$/;
const INT_LIMIT = 2 ** 63;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const projectPath = ({ customer, project }, leaf) =>
  `/organizations/${encodeURIComponent(customer)}/projects/${encodeURIComponent(project)}/${leaf}`;

function toBoolean(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  return typeof value === 'string' && TRUE_TEXT.includes(value.trim().toLowerCase());
}

function toList(value) {
  if (Array.isArray(value)) return value;
  return ['string', 'number'].includes(typeof value) ? [value] : [];
}

const textList = (value) => toList(value).filter((entry) => typeof entry === 'string');

const validItem = (entry) => isObject(entry) && Number.isInteger(entry.position) && entry.position >= 0;

/**
 * Read the rules list of the project, in edge order.
 * @returns {Promise<{ rules: Object[], partial: boolean }>} partial: the
 *   positions are not exactly 0 to n-1, so some rule types are not in the list.
 */
export async function pullRules(client, ids) {
  const { status, body } = await client.get(projectPath(ids, 'rules'), undefined, { scope: 'rules:read', what: 'portal rules' });
  if (status === 404) {
    throw new PortalError(`The portal did not find project ${ids.project} in organisation ${ids.customer} (404).`, 404);
  }
  if (!Array.isArray(body) || !body.every(validItem)) throw new PortalError('The portal sent a rules list that is not valid.', status);
  return { rules: body, partial: body.some((entry, index) => entry.position !== index) };
}

function normalConfig(value) {
  const config = isObject(value) ? { ...value } : {};
  for (const name of BOOLEAN_SETTINGS.filter((key) => key in config)) config[name] = toBoolean(config[name]);
  for (const name of STATUS_LISTS.filter((key) => key in config)) config[name] = toList(config[name]);
  return config;
}

const lower = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

// The uppercase methods of a method list; null (all methods) when it is empty.
function methodList(value) {
  const list = textList(value).map((method) => method.toUpperCase());
  return list.length > 0 ? list : null;
}

// The allowed and the refused methods of the method condition.
function methodLists(item) {
  const mode = lower(item.method);
  if (mode === 'method_is') return { methods: methodList(item.method_is), methodsNot: null };
  if (mode === 'method_is_not') return { methods: null, methodsNot: methodList(item.method_is_not) };
  return { methods: null, methodsNot: null };
}

// A condition is set unless it is empty or `any`, or its list is empty.
function conditionSet(item, name) {
  const mode = lower(item[name]);
  if (mode === '' || mode === 'any') return false;
  const listed = [`${name}_is`, `${name}_is_not`].includes(mode);
  return !listed || toList(item[mode]).length > 0;
}

const uncheckedConditions = (item) => UNCHECKED_CONDITIONS.filter((name) => conditionSet(item, name));

const integral = (value) => Number.isFinite(value) && Number.isInteger(value) && value >= -INT_LIMIT && value < INT_LIMIT;

/**
 * The weight that the portal sorts by: an integral number or a numeric
 * string with an integral value. Anything else (missing, a fraction, a
 * boolean, other text, out of range) is 0.
 */
export function effectiveWeight(value) {
  const number = typeof value === 'string' && NUMERIC_TEXT.test(value) ? Number(value.trim()) : value;
  return typeof number === 'number' && integral(number) ? number : 0;
}

// The cookie name of the cookie condition, or null for no condition.
function cookieName(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function ruleId(item) {
  return String(item.uuid ?? item.rule_id ?? `position-${item.position}`);
}

// The manifest namespace and rule id of a rule that a rules deploy owns
// (managed), from its deployment marker. null for any other rule.
function deploymentOf(item) {
  const marker = item.managed === true && isObject(item.deployment) ? item.deployment : null;
  const valid = marker && typeof marker.namespace === 'string' && typeof marker.id === 'string';
  return valid ? { namespace: marker.namespace, id: marker.id } : null;
}

function domains(value) {
  const list = textList(value).map((domain) => domain.toLowerCase());
  return list.length > 0 ? list : ['any'];
}

/** The portal list item as the local runtime runs it. */
export function fromPortalRule(item) {
  const config = normalConfig(item.action_config);
  const action = String(item.action ?? 'rule');
  const unchecked = uncheckedConditions(item);
  return {
    id: ruleId(item),
    name: typeof item.name === 'string' && item.name !== '' ? item.name : null,
    type: action,
    action,
    config,
    url: textList(item.url),
    domain: domains(item.domain),
    ...methodLists(item),
    cookie: cookieName(item.only_with_cookie),
    weight: effectiveWeight(item.weight),
    disabled: toBoolean(item.disabled) || unchecked.length > 0,
    fnUuid: typeof config.fn_uuid === 'string' ? config.fn_uuid.toLowerCase() : null,
    managed: item.managed === true,
    deployment: deploymentOf(item),
    unchecked
  };
}

// True when the local rule (from a manifest with that namespace) replaces the pulled rule.
const replaces = (local, rule) => rule.deployment !== null && rule.deployment !== undefined &&
  rule.deployment.namespace === local.namespace && rule.deployment.id === local.id;

/**
 * The rules that run, as a rules deploy of the local file leaves them: the
 * pulled list in its order without the managed rules that a local rule
 * replaces (same namespace and id), then each local rule (in weight order)
 * before the first pulled rule with a strictly higher weight. A local rule
 * with a weight higher than all goes last. Every other pulled rule stays,
 * also a managed rule that the file no longer lists or a managed rule of
 * another namespace: a deploy does not remove them.
 */
export function mergeRules(pulled, localRules) {
  const merged = pulled.filter((rule) => !localRules.some((local) => replaces(local, rule)));
  const fromPortal = new Set(merged);
  for (const rule of orderRules(localRules)) {
    const at = merged.findIndex((other) => fromPortal.has(other) && other.weight > rule.weight);
    merged.splice(at === -1 ? merged.length : at, 0, rule);
  }
  return merged;
}

function headersBody(body) {
  if (Array.isArray(body) && body.length === 0) return {};
  if (!isObject(body)) throw new PortalError('The portal sent project headers that are not valid.');
  return body;
}

/**
 * Read the global headers of the project. A token without projects:read
 * gives a warning and null.
 * @returns {Promise<Record<string, string>|null>}
 */
export async function pullGlobalHeaders(client, { customer, project, warn = () => {} }) {
  try {
    const { status, body } = await client.get(projectPath({ customer, project }, 'custom-headers'), undefined, { scope: 'projects:read', what: 'project headers' });
    return status === 404 ? null : headersBody(body);
  } catch (err) {
    if (!(err instanceof PortalError) || err.status !== 403) throw err;
    warn(HEADERS_SCOPE_WARNING);
    return null;
  }
}

const ruleLabel = (rule) => rule.name || rule.id;

function conditionWarning(rule) {
  const names = rule.unchecked.join(', ');
  const noun = rule.unchecked.length === 1 ? 'condition is' : 'conditions are';
  return `Rule ${ruleLabel(rule)}: the ${names} ${noun} not checked in quant serve, so the rule is skipped.`;
}

/**
 * Pull the rules and the global headers of the project.
 * @returns {Promise<{ rules: Object[], headers: Record<string, string>|null, count: number, warnings: string[] }>}
 *   rules: runtime rules in edge order (with the managed rules); count: the pulled rules.
 */
export async function pullProject(client, { customer, project }) {
  const pulled = await pullRules(client, { customer, project });
  const rules = pulled.rules.map(fromPortalRule);
  const warnings = pulled.partial ? [PARTIAL_WARNING] : [];
  const headers = await pullGlobalHeaders(client, { customer, project, warn: (line) => warnings.push(line) });
  const skipped = rules.filter((rule) => !rule.managed && rule.unchecked.length > 0);
  return {
    rules,
    headers,
    count: rules.length,
    warnings: [...warnings, ...skipped.map(conditionWarning)]
  };
}
