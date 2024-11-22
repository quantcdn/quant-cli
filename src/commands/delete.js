/**
 * Delete content from the Quant API.
 *
 * @usage
 *   quant delete <path>
 */

const { text, confirm, isCancel } = require('@clack/prompts');
const color = require('picocolors');
const config = require('../config');
const client = require('../quant-client');

const command = {
  command: 'delete [path]',
  describe: 'Delete a deployed path from Quant',
  
  builder: (yargs) => {
    return yargs
      .positional('path', {
        describe: 'Deployed asset path to remove',
        type: 'string'
      })
      .option('force', {
        alias: 'f',
        type: 'boolean',
        description: 'Delete the asset without confirmation'
      });
  },

  async promptArgs(providedArgs = {}) {
    // If path is provided, skip that prompt
    let path = providedArgs.path;
    if (!path) {
      path = await text({
        message: 'Enter the deployed asset path to remove',
        validate: value => !value ? 'Path is required' : undefined
      });
      if (isCancel(path)) return null;
    }

    // If force is not provided, ask for confirmation
    if (!providedArgs.force) {
      const shouldDelete = await confirm({
        message: 'This will delete all revisions of this asset from QuantCDN. Are you sure?',
        initialValue: false
      });
      if (isCancel(shouldDelete) || !shouldDelete) return null;
    }

    return { path, force: providedArgs.force };
  },

  async handler(args) {
    if (!args) {
      throw new Error('Operation cancelled');
    }

    // Always prompt if path is missing
    if (!args.path) {
      const promptedArgs = await this.promptArgs(args);
      if (!promptedArgs) {
        throw new Error('Operation cancelled');
      }
      args = { ...args, ...promptedArgs };
    }
    // Only prompt for confirmation if not forced
    else if (!args.force) {
      const promptedArgs = await this.promptArgs(args);
      if (!promptedArgs) {
        throw new Error('Operation cancelled');
      }
      args = { ...args, ...promptedArgs };
    }

    if (!await config.fromArgs(args)) {
      process.exit(1);
    }

    const quant = client(config);
    try {
      await quant.delete(args.path);
      return `Successfully removed [${args.path}]`;
    } catch (err) {
      throw new Error(`Cannot delete path (${args.path}): ${err.message}`);
    }
  }
};

module.exports = command;
