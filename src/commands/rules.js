import fs from 'node:fs';
import axios from 'axios';
import { text, isCancel } from '@clack/prompts';
import { assertManifest } from '../helper/functions-manifest.js';
import { resolveRules } from '../helper/edge-rules-manifest.js';
import { portalOptions, oneLine } from '../serve/portal/client.js';

export { resolveRules };

export function rulesOptions(args, env = process.env) {
  // Rules keep the token and base flags that the serve command does not have.
  const merged = {
    ...env,
    QUANT_API_TOKEN: args['api-token'] || env.QUANT_API_TOKEN,
    QUANT_BASE_URL: args['api-base-url'] || env.QUANT_BASE_URL
  };
  const { base: _url, ...rest } = portalOptions(args, merged);
  return { ...rest, base: merged.QUANT_BASE_URL.replace(/\/$/, '') };
}

// Drift values printed in CI logs: matchers and placement only. Anything else
// (action_config in particular) can hold credentials, so only its name is shown.
const SAFE_DIFF_FIELDS = ['name', 'disabled', 'url', 'domain', 'method', 'method_is', 'weight', 'action', 'country', 'ip'];
const STATUSES = ['created', 'updated', 'unchanged', 'forced', 'drift', 'collision'];

function deployParams(args) {
  const params = {};
  if (args['dry-run']) params.dry_run = 1;
  if (args.force) params.force = 1;
  return params;
}

function shortJson(value) {
  const json = JSON.stringify(value) ?? 'null';
  return json.length > 200 ? `${json.slice(0, 197)}...` : json;
}

function describeRefusal(rule) {
  const id = /^[a-z][a-z0-9-]{0,47}$/.test(rule?.id) ? rule.id : '(unknown rule)';
  const status = STATUSES.includes(rule?.status) ? rule.status : 'unknown';
  const lines = [`${id}: ${status}`];
  for (const [field, change] of Object.entries(status === 'drift' ? rule.diff || {} : {})) {
    if (!/^[a-z_]{1,64}$/.test(field)) continue;
    lines.push(SAFE_DIFF_FIELDS.includes(field) ? `  ${field}: live ${shortJson(change?.live)} -> code ${shortJson(change?.code)}` : `  ${field}: changed`);
  }
  return lines.join('\n');
}

function refusalError(rules) {
  for (const rule of rules) console.log(describeRefusal(rule));
  if (rules.some(rule => rule?.status === 'collision')) {
    return new Error('A rule id collides with a rule this manifest does not own; nothing was written. Rename the rule id or remove the other rule (--force never takes over a rule).');
  }
  return new Error('Managed rules were changed outside code; nothing was written. Re-run with --force to overwrite them with this manifest.');
}

const MESSAGE_STATUSES = [409, 422];

function adviceText(status, code) {
  if (status === 409) return 'Rules are being changed by another request (409). Retry shortly.';
  return `Rules deployment failed (${status || code || 'network error'}). Check portal URL, token scopes and project access.`;
}

// A 409 or 422 `message` replaces the advice: the API writes it for the user
// (for example, that the change may already be live, or that the rule order
// cannot be kept). A string `error` alone is printed above the advice.
function statusText(status, data, code) {
  const advice = adviceText(status, code);
  if (!MESSAGE_STATUSES.includes(status)) return advice;
  const message = oneLine(data?.message);
  if (message) return `Rules deployment failed (${status}): ${message}`;
  const errorText = oneLine(data?.error);
  return errorText ? `Rules deployment failed (${status}): ${errorText}\n${advice}` : advice;
}

// Never print Axios config/headers or an arbitrary upstream body containing credentials.
function deployError(error) {
  const { status, data } = error.response || {};
  if (status === 409 && Array.isArray(data?.rules)) return refusalError(data.rules);
  return new Error(statusText(status, data, error.code));
}

export default {
  command: 'rules <file>',
  describe: 'Deploy managed rules with a separate project-scoped portal API token',
  builder: yargs => yargs.positional('file', { type: 'string', describe: 'Rules JSON manifest' })
    .option('functions', { type: 'string', describe: 'Functions manifest for resolving function_ref' })
    .option('api-token', { type: 'string', describe: 'Scoped portal token (prefer QUANT_API_TOKEN)' })
    .option('api-base-url', { type: 'string', describe: 'Portal /api/v2 URL (or QUANT_BASE_URL)' })
    .option('dry-run', { type: 'boolean', default: false, describe: 'Validate permissions and preview changes without saving' })
    .option('force', { type: 'boolean', default: false, describe: 'Overwrite managed rules that were changed outside code (never takes over a rule this manifest does not own)' }),
  promptArgs: async () => {
    const file = await text({ message: 'Path to rules manifest', placeholder: 'edge-rules.json' });
    return isCancel(file) ? null : { file };
  },
  async handler(args) {
    const options = rulesOptions(args);
    const manifest = JSON.parse(fs.readFileSync(args.file, 'utf8'));
    const functions = args.functions ? JSON.parse(fs.readFileSync(args.functions, 'utf8')) : [];
    // The same check as `quant functions`, so a rule never resolves through an
    // entry that the functions deploy would refuse.
    if (args.functions) assertManifest(functions, args.functions);
    const body = resolveRules(manifest, functions);
    const url = `${options.base}/organizations/${encodeURIComponent(options.customer)}/projects/${encodeURIComponent(options.project)}/rules/deploy`;
    let response;
    try {
      response = await axios.post(url, body, {
        headers: { Authorization: `Bearer ${options.token}`, Accept: 'application/json' },
        params: deployParams(args), timeout: 60000, maxRedirects: 0
      });
    } catch (error) {
      throw deployError(error);
    }
    if (!Array.isArray(response.data?.rules) || response.data.namespace !== manifest.namespace || response.data.rules.length !== manifest.rules.length ||
        response.data.rules.some((rule, i) => rule.id !== manifest.rules[i].id || !['created', 'updated', 'unchanged', 'forced'].includes(rule.status))) {
      throw new Error('Rules API returned an invalid acknowledgement');
    }
    for (const rule of response.data.rules) console.log(`${rule.id}: ${rule.status}`);
    return args['dry-run'] ? 'Rules validated; no changes saved' : 'Rules deployed successfully';
  }
};
