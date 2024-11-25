/**
 * Deploy an edge filter function.
 * 
 * @usage
 *   quant filter <file> <description> [uuid]
 */
const { text, isCancel } = require('@clack/prompts');
const config = require('../config');
const client = require('../quant-client');
const { validateUUID } = require('../helper/validate-uuid');

const command = {
  command: 'filter <file> <description> [uuid]',
  describe: 'Deploy an edge filter function',
  
  builder: (yargs) => {
    return yargs
      .positional('file', {
        describe: 'Path to filter function file',
        type: 'string',
        demandOption: true
      })
      .positional('description', {
        describe: 'Description of the filter',
        type: 'string',
        demandOption: true
      })
      .positional('uuid', {
        describe: 'UUID of existing filter to update',
        type: 'string',
        coerce: value => {
          if (value && !validateUUID(value)) {
            throw new Error('Invalid UUID format');
          }
          return value;
        }
      })
      .example('quant filter filter.js "My edge filter"', 'Deploy a new filter')
      .example('quant filter filter.js "Updated filter" 019361ae-2516-788a-8f50-e803ff561c34', 'Update existing filter');
  },

  async promptArgs(providedArgs = {}) {
    let file = providedArgs.file;
    if (!file) {
      file = await text({
        message: 'Enter path to filter function file',
        validate: value => !value ? 'File path is required' : undefined
      });
      if (isCancel(file)) return null;
    }

    let description = providedArgs.description;
    if (!description) {
      description = await text({
        message: 'Enter filter description',
        validate: value => !value ? 'Description is required' : undefined
      });
      if (isCancel(description)) return null;
    }

    let uuid = providedArgs.uuid;
    if (uuid === undefined) {
      uuid = await text({
        message: 'Enter UUID to update (optional)',
        validate: value => {
          if (!value) return undefined; // Allow empty for new functions
          if (!validateUUID(value)) return 'Invalid UUID format';
          return undefined;
        }
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
      const response = await quant.edgeFilter(args.file, args.description, args.uuid);
      if (args.uuid) {
        return `Updated edge filter [${args.uuid}]`;
      }
      return `Created edge filter [${response.uuid}]`;
    } catch (err) {
      throw new Error(`Failed to deploy edge filter: ${err.message}`);
    }
  }
};

module.exports = command; 