/**
 * Edge library globals for `quant serve`.
 * The Quant edge gives functions a set of library globals. Locally, a global
 * comes from the project's own node_modules when the package is installed.
 * Otherwise the global is a stub that throws a clear message. A package from
 * the project can be a different version from the one on the edge.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// `pick` selects the value from the imported module:
// 'namespace' = the module namespace, 'default' = the default export
// (module.exports for CommonJS), any other string = that named export.
export const EDGE_LIBRARIES = [
  { global: 'jose', package: 'jose', pick: 'namespace' },
  { global: 'jwt', package: 'jsonwebtoken', pick: 'default' },
  { global: 'validator', package: 'validator', pick: 'default' },
  { global: 'CryptoJS', package: 'crypto-js', pick: 'default' },
  { global: 'qrcode', package: 'qrcode', pick: 'default' },
  { global: 'JsBarcode', package: 'jsbarcode', pick: 'default' },
  { global: 'htmlparser2', package: 'htmlparser2', pick: 'namespace' },
  { global: 'DOMImplementation', package: '@xmldom/xmldom', pick: 'DOMImplementation' },
  { global: 'XMLSerializer', package: '@xmldom/xmldom', pick: 'XMLSerializer' },
  { global: 'DOMParser', package: '@xmldom/xmldom', pick: 'DOMParser' },
  { global: 'Stripe', package: 'stripe', pick: 'default' },
  { global: 'SlackClient', package: '@slack/web-api', pick: 'WebClient' },
  { global: 'Octokit', package: '@octokit/rest', pick: 'Octokit' },
  { global: 'graphql', package: 'graphql-request', pick: 'namespace' },
  { global: 'createOpenAI', package: '@ai-sdk/openai', pick: 'createOpenAI' },
  { global: 'QuantClient', package: null, pick: null },
  { global: 'awsSes', package: null, pick: null },
  { global: 'requiresLogin', package: null, pick: null },
  { global: 'getJwtToken', package: null, pick: null }
];

export function stubMessage(name) {
  return `${name} is available on the Quant edge but not in quant serve`;
}

/**
 * A stand-in that throws on any use: call, construct or property read.
 * `then` and symbol reads give undefined, so the stub is not a thenable and
 * console.log can describe it.
 */
export function edgeStub(name) {
  const fail = () => {
    throw new Error(stubMessage(name));
  };
  return new Proxy(function edgeLibraryStub() {}, {
    apply: fail,
    construct: fail,
    get(_target, key) {
      if (typeof key === 'symbol' || key === 'then') return undefined;
      return fail();
    }
  });
}

function readManifest(dir) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  } catch (_err) {
    return null;
  }
}

// The ESM entry from a package "exports" field: "." first, then the
// import, node and default conditions.
function exportTarget(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if ('.' in value) return exportTarget(value['.']);
  for (const condition of ['import', 'node', 'default']) {
    const target = exportTarget(value[condition]);
    if (target) return target;
  }
  return null;
}

function findPackageDir(req, pkg) {
  const dirs = req.resolve.paths(pkg) || [];
  return dirs.map((dir) => path.join(dir, pkg)).find((dir) => fs.existsSync(path.join(dir, 'package.json'))) || null;
}

function resolveEntry(root, pkg) {
  const req = createRequire(path.join(root, 'package.json'));
  const dir = findPackageDir(req, pkg);
  if (!dir) return null;
  const manifest = readManifest(dir);
  const target = manifest && exportTarget(manifest.exports);
  if (target) return path.join(dir, target);
  try {
    return req.resolve(pkg);
  } catch (_err) {
    return null;
  }
}

// { namespace } for an imported package, { error } when the import throws,
// or {} when the package is not installed.
async function importPackage(root, pkg) {
  const entry = resolveEntry(root, pkg);
  if (!entry) return {};
  try {
    return { namespace: await import(pathToFileURL(entry).href) };
  } catch (err) {
    return { error: err && typeof err.message === 'string' ? err.message : String(err) };
  }
}

function pickExport(namespace, pick) {
  if (pick === 'namespace') return namespace;
  if (pick === 'default') return namespace.default ?? undefined;
  return namespace[pick] ?? namespace.default?.[pick];
}

async function libraryValue(root, lib, loaded) {
  if (!lib.package) return undefined;
  if (!loaded.has(lib.package)) loaded.set(lib.package, importPackage(root, lib.package));
  const { namespace } = await loaded.get(lib.package);
  return namespace ? pickExport(namespace, lib.pick) : undefined;
}

// One message for each installed package whose import throws.
async function importErrors(loaded) {
  const errors = [];
  for (const [pkg, pending] of loaded) {
    const { error } = await pending;
    if (error === undefined) continue;
    const names = EDGE_LIBRARIES.filter((lib) => lib.package === pkg).map((lib) => lib.global).join(', ');
    errors.push(`The project package ${pkg} could not be imported (${error}). Functions get the ${names} stub.`);
  }
  return errors;
}

/**
 * Load the edge library globals for a project.
 * @param {string} root The project directory. Packages resolve from its node_modules.
 * @returns {Promise<{ globals: Object, fromProject: string[], errors: string[] }>}
 *   errors: one message for each installed package whose import throws (its globals are stubs).
 */
export async function loadProjectLibraries(root) {
  const globals = {};
  const fromProject = [];
  const loaded = new Map();
  for (const lib of EDGE_LIBRARIES) {
    const value = await libraryValue(root, lib, loaded);
    if (value === undefined) {
      globals[lib.global] = edgeStub(lib.global);
    } else {
      globals[lib.global] = value;
      fromProject.push(lib.global);
    }
  }
  return { globals, fromProject, errors: await importErrors(loaded) };
}
