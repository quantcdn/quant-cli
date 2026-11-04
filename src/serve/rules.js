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

// The text that a pattern is tested against: path plus query for a pattern with ?.
function subjects(pattern, pathname, search) {
  return pattern.includes('?') ? [pathname + search] : pathForms(pathname);
}

function urlMatches(pattern, pathname, search) {
  const re = compile(pattern);
  return subjects(pattern, pathname, search).some(form => re.test(form));
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

// Filter and error page rules are not run in the rule stage.
const NOT_IN_RULE_STAGE = new Set(['edge_filter', 'error_page']);
const inRuleStage = rule => !NOT_IN_RULE_STAGE.has(rule.action);

/** The first enabled rule of the rule stage that matches, or null. Filter and error page rules are skipped. */
export function matchRule(rules, ctx) {
  return rules.find(rule => inRuleStage(rule) && ruleMatches(rule, ctx)) || null;
}

/**
 * Every enabled rule of the rule stage that matches, in run order. A rule
 * that continues (an auth 201, a headers rule) goes on to the next rule.
 */
export function matchRules(rules, ctx) {
  return rules.filter(rule => inRuleStage(rule) && ruleMatches(rule, ctx));
}

/** The first enabled filter rule that matches, or null. */
export function matchFilter(rules, ctx) {
  return rules.find(rule => rule.action === 'edge_filter' && ruleMatches(rule, ctx)) || null;
}

const listsStatus = (rule, status) => (rule.config?.status_codes || []).map(String).includes(String(status));

/** The first enabled error page rule for the status that matches, or null. */
export function matchErrorPage(rules, ctx, status) {
  return rules.find(rule => rule.action === 'error_page' && listsStatus(rule, status) && ruleMatches(rule, ctx)) || null;
}

/**
 * The text that each * of the first matching URL pattern matched, and
 * whether that pattern contains ?. Null when no pattern matches.
 */
export function ruleCaptures(rule, ctx) {
  for (const pattern of rule.url) {
    const re = compile(pattern);
    for (const form of subjects(pattern, ctx.pathname, ctx.search || '')) {
      const found = re.exec(form);
      if (found) return { groups: found.slice(1), withQuery: pattern.includes('?') };
    }
  }
  return null;
}
