/**
 * Deploy an edge function.
 * 
 * @usage
 *   quant function <file> <description> [uuid]
 */
const { text, isCancel } = require('@clack/prompts');
const config = require('../config');
const client = require('../quant-client');
const { validateUUID } = require('../helper/validate-uuid');

const command = {
  command: 'function <file> <description> [uuid]',
  describe: 'Deploy an edge function',
  
  builder: (yargs) => {
    return yargs
      .positional('file', {
        describe: 'Path to function file',
        type: 'string',
        demandOption: true
      })
      .positional('description', {
        describe: 'Description of the function',
        type: 'string',
        demandOption: true
      })
      .positional('uuid', {
        describe: 'UUID of existing function to update',
        type: 'string',
        coerce: value => {
          if (value && !validateUUID(value)) {
            throw new Error('Invalid UUID format');
          }
          return value;
        }
      })
      .example('quant function handler.js "My edge function"', 'Deploy a new function')
      .example('quant function handler.js "Updated function" 019361ae-2516-788a-8f50-e803ff561c34', 'Update existing function');
  },

  async promptArgs(providedArgs = {}) {
    let file = providedArgs.file;
    if (!file) {
      file = await text({
        message: 'Enter path to function file',
        validate: value => !value ? 'File path is required' : undefined
      });
      if (isCancel(file)) return null;
    }

    let description = providedArgs.description;
    if (!description) {
      description = await text({
        message: 'Enter function description',
        validate: value => !value ? 'Description is required' : undefined
      });
      if (isCancel(description)) return null;
    }

    let uuid = providedArgs.uuid;
    if (uuid === undefined) {
      uuid = await text({
        message: 'Enter UUID to update (optional)',
      });
      if (isCancel(uuid)) return null;
    }

    return { file, description, uuid: uuid || null };
  },

  async handler(args) {
    if (!args) {
      throw new Error('Operation cancelled');
    }

    if (!await config.fromArgs(args)) {
      process.exit(1);
    }

    const quant = client(config);

    try {
      const response = await quant.edgeFunction(args.file, args.description, args.uuid);
      if (args.uuid) {
        return `Updated edge function [${args.uuid}]`;
      }
      return `Created edge function [${response.uuid}]`;
    } catch (err) {
      throw new Error(`Failed to deploy edge function: ${err.message}`);
    }
  }
};

module.exports = command; 