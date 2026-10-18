/**
 * Add an edge function to a manifest, with a new uuid. Uploads nothing.
 *
 * @usage
 *   quant functions-add <manifest> <path> --type function --description "..." [--id my-fn]
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { text, select, isCancel } from '@clack/prompts';
import { assertManifest, FUNCTION_ID, FUNCTION_TYPES } from '../helper/functions-manifest.js';

const TYPES = FUNCTION_TYPES.filter(type => type !== 'edge');
const ID_MESSAGE = 'must be a lowercase slug that starts with a letter (1-48 characters)';

function readManifest(file) {
  if (!fs.existsSync(file)) return [];
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to read ${file}: ${err.message}`);
  }
  assertManifest(manifest, file);
  return manifest;
}

/** A repository path as the manifest stores it: no leading "./". */
function normalise(file) {
  return file.replace(/^(\.\/)+/, '');
}

function assertNew(manifest, args) {
  if (manifest.some(entry => normalise(entry.path) === normalise(args.path))) {
    throw new Error(`${args.manifest} already has an entry for ${normalise(args.path)}`);
  }
  if (args.id !== undefined && manifest.some(entry => entry.id === args.id)) {
    throw new Error(`${args.manifest} already has an entry with id ${args.id}`);
  }
}

function newEntry(args) {
  const entry = { type: args.type, path: normalise(args.path), description: args.description.trim() };
  if (args.id !== undefined) entry.id = args.id;
  entry.uuid = randomUUID();
  return entry;
}

/**
 * Write through a temporary file in the same directory, then rename it, so a
 * failed write never leaves a half-written manifest.
 */
function writeManifest(file, manifest) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temp, JSON.stringify(manifest, null, 2) + '\n');
    fs.renameSync(temp, file);
  } catch (err) {
    fs.rmSync(temp, { force: true });
    throw err;
  }
}

const required = label => value => !value?.trim() ? `${label} is required` : undefined;

const command = {
  command: 'functions-add <manifest> <path>',
  describe: 'Add an edge function to a manifest with a new UUID (uploads nothing)',

  builder: (yargs) => yargs
    .positional('manifest', { describe: 'Function manifest, created if absent', type: 'string', demandOption: true })
    .positional('path', { describe: 'Function file, relative to the repository root', type: 'string', demandOption: true })
    .option('type', { describe: 'Function type', choices: TYPES, default: 'function' })
    .option('description', { describe: 'Description shown in the dashboard', type: 'string', demandOption: true })
    .option('id', { describe: 'Name that rules use as function_ref (lowercase slug)', type: 'string' })
    .check(args => {
      if (args.id !== undefined && !FUNCTION_ID.test(args.id)) throw new Error(`--id ${ID_MESSAGE}`);
      if (!String(args.description).trim()) throw new Error('--description is required');
      return true;
    })
    .example('quant functions-add quant/edge-functions.json quant/edge-functions/api.js --description "API" --id my-api', 'Add a function with a new UUID'),

  async promptArgs(providedArgs = {}) {
    const answers = { ...providedArgs };
    const asks = [
      ['manifest', () => text({ message: 'Function manifest', initialValue: 'quant/edge-functions.json', validate: required('The manifest') })],
      ['path', () => text({ message: 'Function file', placeholder: 'quant/edge-functions/api.js', validate: required('The function file') })],
      ['type', () => select({ message: 'Function type', options: TYPES.map(value => ({ value, label: value })) })],
      ['description', () => text({ message: 'Description', validate: required('Description') })],
      ['id', () => text({ message: 'Id that rules use as function_ref (optional)', validate: value => !value || FUNCTION_ID.test(value) ? undefined : `The id ${ID_MESSAGE}` })]
    ];
    for (const [key, ask] of asks) {
      if (answers[key]) continue;
      const value = await ask();
      if (isCancel(value)) return null;
      answers[key] = value;
    }
    if (!answers.id) delete answers.id;
    return answers;
  },

  async handler(args) {
    if (!args) {
      throw new Error('Operation cancelled');
    }
    if (!fs.existsSync(args.path)) {
      throw new Error(`Function file not found: ${args.path}`);
    }
    const manifest = readManifest(args.manifest);
    assertNew(manifest, args);
    const entry = newEntry(args);
    const next = [...manifest, entry];
    // The written file must pass the same check that deploys it.
    assertManifest(next, args.manifest);
    writeManifest(args.manifest, next);
    // stdout carries only the UUID, so a script can capture it.
    console.error(`Added ${entry.type} ${entry.path} to ${args.manifest}`);
    return entry.uuid;
  }
};

export default command;
