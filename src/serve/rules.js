/**
 * Documented rule matching for `quant serve`.
 * A `*` matches one or more characters. The pattern is anchored and case
 * insensitive. A pattern that contains `?` is tested against the path plus
 * the query string; any other pattern is tested against each path form.
 */

const INDEX_SUFFIX = /\/index\.html$/;
const REGEX_SPECIAL = /[.+?^${}()|[\]\\]/g;

const cache = new Map();

/** Rules in the order they run: ascending weight, ties keep their given order. */
export function orderRules(rules) {
  return rules
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => (a.rule.weight - b.rule.weight) || (a.index - b.index))
    .map(entry => entry.rule);
}

/** The path as raw, lowercased, and lowercased without a trailing /index.html. */
export function pathForms(pathname) {
  const lower = pathname.toLowerCase();
  return [pathname, lower, lower.replace(INDEX_SUFFIX, '') || '/'];
}

function compile(pattern) {
  let re = cache.get(pattern);
  if (!re) {
    const source = pattern.split('*').map(part => part.replace(REGEX_SPECIAL, '\\$&')).join('(.+)');
    re = new RegExp(`^${source}$`, 'i');
    cache.set(pattern, re);
  }
  return re;
}

function urlMatches(pattern, pathname, search) {
  const re = compile(pattern);
  if (pattern.includes('?')) return re.test(pathname + search);
  return pathForms(pathname).some(form => re.test(form));
}

function hostMatches(domains, host) {
  const bare = host.replace(/:\d+$/, '').toLowerCase();
  return domains.some(domain => domain === 'any' || domain === bare);
}

function ruleMatches(rule, ctx) {
  if (rule.disabled) return false;
  if (rule.methods && !rule.methods.includes(ctx.method)) return false;
  if (!hostMatches(rule.domain, ctx.host)) return false;
  return rule.url.some(pattern => urlMatches(pattern, ctx.pathname, ctx.search || ''));
}

function firstMatch(rules, ctx, wantFilter) {
  return rules.find(rule => (rule.type === 'filter') === wantFilter && ruleMatches(rule, ctx)) || null;
}

/** The first enabled function or auth rule that matches, or null. Filter rules are skipped. */
export function matchRule(rules, ctx) {
  return firstMatch(rules, ctx, false);
}

/**
 * Every enabled function or auth rule that matches, in run order. An auth
 * rule's 201 continues to the next rule in this list.
 */
export function matchRules(rules, ctx) {
  return rules.filter(rule => rule.type !== 'filter' && ruleMatches(rule, ctx));
}

/** The first enabled filter rule that matches, or null. */
export function matchFilter(rules, ctx) {
  return firstMatch(rules, ctx, true);
}
