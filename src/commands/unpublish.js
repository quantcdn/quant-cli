/**
 * Unpublish a QuantCDN url.
 *
 * @usage
 *   quant unpublish <path>
 */
const { text, isCancel } = require('@clack/prompts');
const config = require('../config');
const client = require('../quant-client');

const command = {
  command: 'unpublish <path>',
  describe: 'Unpublish an asset',
  
  builder: (yargs) => {
    return yargs
      .positional('path', {
        describe: 'Path to unpublish',
        type: 'string',
        demandOption: true
      });
  },

  async promptArgs(providedArgs = {}) {
    let path = providedArgs.path;
    if (!path) {
      path = await text({
        message: 'Enter the path to unpublish',
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

    const context = {
      config: this.config || config,
      client: this.client || (() => client(config))
    };

    if (!await context.config.fromArgs(args)) {
      process.exit(1);
    }

    const quant = context.client(context.config);

    try {
      await quant.unpublish(args.path);
      return `Successfully unpublished [${args.path}]`;
    } catch (err) {
      // Format a user-friendly error message
      if (err.response?.status === 404) {
        throw new Error(`Path [${args.path}] not found`);
      }
      
      throw new Error(`Failed to unpublish: ${err.message}`);
    }
  }
};

module.exports = command;
