// The in-process edge-conformance adapter for `quant serve`.
// matchRule uses the rule matcher directly. The other operations write a
// temporary project, start the real quant serve server on a free port, send
// the request and read the response.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../../src/serve/server.js';
import { matchRule, orderRules } from '../../src/serve/rules.js';
import { resolveRules, toRuntimeRule } from '../../src/helper/edge-rules-manifest.js';

const UPSTREAM_UUID = 'c0ffee00-0000-4000-8000-000000000001';
const NAMESPACE = 'conformance';

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function functionsManifest(functions) {
  return functions.map((fn, index) => ({
    uuid: fn.uuid,
    id: fn.id || `fn-${index}`,
    type: fn.type,
    path: `quant/edge-functions/${fn.uuid}.js`,
    description: fn.id || `fn-${index}`
  }));
}

function writeProject(root, { files = {}, functions = [], rules }) {
  const manifest = functionsManifest(functions);
  functions.forEach((fn, index) => writeFile(path.join(root, manifest[index].path), fn.body || ''));
  writeFile(path.join(root, 'quant', 'edge-functions.json'), JSON.stringify(manifest));
  if (rules) writeFile(path.join(root, 'quant', 'edge-rules.json'), JSON.stringify(rules));
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFile(path.join(root, 'dist', name), content);
}

function requestOptions(serverUrl, request) {
  const target = new URL(request.url);
  const server = new URL(serverUrl);
  const body = request.body == null ? null : Buffer.from(request.body);
  const headers = { ...(request.headers || {}), host: target.host };
  if (body) headers['content-length'] = String(body.length);
  return {
    options: { hostname: server.hostname, port: server.port, path: `${target.pathname}${target.search}`, method: request.method || 'GET', headers },
    body
  };
}

function send(serverUrl, request) {
  const { options, body } = requestOptions(serverUrl, request);
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bodyText: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end(body || undefined);
  });
}

function rule(id, type, uuid, weight = 0) {
  return { id, type, urls: ['/', '/*'], weight, function_uuid: uuid };
}

function upstreamBody(response) {
  const init = JSON.stringify({ status: response.status, headers: response.headers || {} });
  return `return new Response(${JSON.stringify(response.body ?? null)}, ${init});`;
}

// One function on every path. A filter runs over a function that returns the
// case's upstream response.
function functionSite(input) {
  const fn = { uuid: input.uuid, id: 'subject', type: input.type, body: input.body };
  if (input.type !== 'filter') {
    return { functions: [fn], rules: [rule('subject', input.type, input.uuid)], request: input.request };
  }
  const upstream = { uuid: UPSTREAM_UUID, id: 'upstream', type: 'function', body: upstreamBody(input.response) };
  return {
    functions: [fn, upstream],
    rules: [rule('upstream', 'function', UPSTREAM_UUID), rule('subject', 'filter', input.uuid)],
    request: input.request
  };
}

function manifest(rules) {
  return { version: 1, namespace: NAMESPACE, rules };
}

export function createAdapter() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-serve-conformance-'));
  let count = 0;
  const logs = [];

  async function serveSite(input) {
    count += 1;
    const root = path.join(base, `case-${count}`);
    writeProject(root, input);
    // The case URLs use public host names: --domain lets the loopback server answer them.
    const domain = new URL(input.request.url).host;
    const server = await startServer({ root, dir: 'dist', port: 0, host: '127.0.0.1', domain, log: (line) => logs.push(line) });
    try {
      return await send(server.url, input.request);
    } finally {
      await server.close();
    }
  }

  return {
    capabilities: { ops: ['matchRule', 'serveStatic', 'runFunction', 'serveSite'] },
    logs,
    async matchRule(rules, functions, request) {
      const url = new URL(request.url);
      const runtime = orderRules(resolveRules(rules, functions).rules.map(toRuntimeRule));
      const matched = matchRule(runtime, { host: url.host, method: request.method || 'GET', pathname: url.pathname, search: url.search });
      return { ruleId: matched ? matched.id : null };
    },
    serveStatic: (files, request) => serveSite({ files, request }),
    runFunction: (input) => {
      const site = functionSite(input);
      return serveSite({ ...site, rules: manifest(site.rules) });
    },
    serveSite,
    async dispose() {
      fs.rmSync(base, { recursive: true, force: true });
    }
  };
}
