/**
 * The single-function deploy commands (`function`, `auth`, `filter`).
 *
 * From 7.0.0 the uuid is required: the uuid is the function's identity, and
 * an upload without one made the API create a new function each time. Use
 * `quant functions-add` to create a manifest entry with a new uuid.
 */
import { text, isCancel } from '@clack/prompts';
import { randomUUID } from 'node:crypto';
import config from '../config.js';
import client from '../quant-client.js';
import { MANIFEST_UUID } from './functions-manifest.js';

const EXAMPLE_UUID = '43aec1f0-095b-4a76-a9c8-934bf3d49d59';

function checkUuid(value) {
  if (!value || !MANIFEST_UUID.test(String(value))) {
    throw new Error(`A function UUID is required (8-4-4-4-12 hex). For a new function, generate one, for example ${randomUUID()}`);
  }
  return value;
}

async function ask(message, current, validate) {
  if (current) return current;
  const value = await text({ message, validate });
  return isCancel(value) ? null : value;
}

/**
 * @param {object} spec
 * @param {string} spec.name the command (`function`, `auth`, `filter`)
 * @param {string} spec.noun the thing deployed, for help text and messages
 * @param {string} spec.method the quant-client method (`edgeFunction`, ...)
 * @param {string} spec.sample an example file name
 */
export function singleFunctionCommand({ name, noun, method, sample }) {
  return {
    command: `${name} <file> <description> <uuid>`,
    describe: `Deploy an ${noun}`,

    builder: (yargs) => yargs
      .positional('file', { describe: `Path to ${noun} file`, type: 'string', demandOption: true })
      .positional('description', { describe: `Description of the ${noun}`, type: 'string', demandOption: true })
      .positional('uuid', { describe: `UUID of the ${noun} (create or update)`, type: 'string', demandOption: true, coerce: checkUuid })
      .example(`quant ${name} ${sample} "My ${noun}" ${EXAMPLE_UUID}`, `Deploy the ${noun} with this UUID`),

    async promptArgs(providedArgs = {}) {
      const file = await ask(`Enter path to ${noun} file`, providedArgs.file, value => !value ? 'File path is required' : undefined);
      if (file === null) return null;
      const description = await ask(`Enter ${noun} description`, providedArgs.description, value => !value ? 'Description is required' : undefined);
      if (description === null) return null;
      const uuid = await ask(`Enter the ${noun} UUID`, providedArgs.uuid, value => MANIFEST_UUID.test(value || '') ? undefined : 'A UUID is required (8-4-4-4-12 hex)');
      if (uuid === null) return null;
      return { file, description, uuid };
    },

    async handler(args) {
      if (!args) {
        throw new Error('Operation cancelled');
      }
      checkUuid(args.uuid);
      // The same test seam as `quant functions`: a caller may pass config and client.
      const context = { config: this?.config || config, client: this?.client || client };
      if (!await context.config.fromArgs(args)) {
        process.exit(1);
      }
      try {
        await context.client(context.config)[method](args.file, args.description, args.uuid);
        return `Deployed ${noun} [${args.uuid}]`;
      } catch (err) {
        throw new Error(`Failed to deploy ${noun}: ${err.message}`);
      }
    }
  };
}
