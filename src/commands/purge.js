/**
 * Purge the cache for a given url.
 *
 * @usage
 *   quant unpublish <path>
 */
const { text, isCancel } = require('@clack/prompts');
const color = require('picocolors');
const config = require('../config');
const client = require('../quant-client');

const command = {
  command: 'purge [path]',
  describe: 'Purge the cache for a given URL',
  
  builder: (yargs) => {
    return yargs
      .positional('path', {
        describe: 'Path to purge from cache',
        type: 'string'
      });
  },

  async promptArgs(providedArgs = {}) {
    // If path is provided, skip that prompt
    let path = providedArgs.path;
    if (!path) {
      path = await text({
        message: 'Enter the path to purge from cache',
        validate: value => !value ? 'Path is required' : undefined
      });
      if (isCancel(path)) return null;
    }

    return { path };
  },

  async handler(args) {
    if (!args) {
      throw new Error('Operation cancelled');
    }

    if (!args.path) {
      const promptedArgs = await this.promptArgs();
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
      await quant.purge(args.path);
      return `Purged ${args.path}`;
    } catch (err) {
      throw new Error(`Failed to purge: ${err.message}`);
    }
  }
};

module.exports = command;
