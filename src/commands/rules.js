import fs from 'node:fs';
import axios from 'axios';
import { text, isCancel } from '@clack/prompts';
import { assertManifest } from '../helper/functions-manifest.js';
import { resolveRules } from '../helper/edge-rules-manifest.js';

export { resolveRules };

export function rulesOptions(args, env = process.env) {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync('quant.json', 'utf8')); } catch { /* Optional project selection only. */ }
  const customer = args.clientid || args.c || env.QUANT_CLIENT_ID || env.QUANT_CUSTOMER || saved.clientid;
  const project = args.project || args.p || env.QUANT_PROJECT || saved.project;
  // Deliberately never read QUANT_TOKEN, -t, saved.token, or upload endpoint.
  const token = args['api-token'] || env.QUANT_API_TOKEN;
  const base = args['api-base-url'] || env.QUANT_BASE_URL;
  if (!customer || !project || !token || !base) throw new Error('Rules require customer, project, QUANT_API_TOKEN and QUANT_BASE_URL (portal /api/v2 URL)');
  const url = new URL(base);
  if (url.username || url.password || url.search || url.hash || !/\/api\/v2\/?$/.test(url.pathname) ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Rules require an HTTPS portal /api/v2 URL (HTTP is allowed only for localhost)');
  }
  return { customer, project, token, base: base.replace(/\/$/, '') };
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

// Never print Axios config/headers or an arbitrary upstream body containing credentials.
function deployError(error) {
  const status = error.response?.status;
  if (status === 409 && Array.isArray(error.response?.data?.rules)) return refusalError(error.response.data.rules);
  if (status === 409) return new Error('Rules are being changed by another request (409). Retry shortly.');
  return new Error(`Rules deployment failed (${status || error.code || 'network error'}). Check portal URL, token scopes and project access.`);
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
