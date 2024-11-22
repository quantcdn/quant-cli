/**
 * Unpublish a QuantCDN url.
 *
 * @usage
 *   quant unpublish <path>
 */
const { text, confirm, isCancel } = require('@clack/prompts');
const color = require('picocolors');
const config = require('../config');
const client = require('../quant-client');

const command = {
  command: 'unpublish [path]',
  describe: 'Unpublish an asset',
  
  builder: (yargs) => {
    return yargs
      .positional('path', {
        describe: 'Path to unpublish',
        type: 'string'
      })
      .option('force', {
        alias: 'f',
        type: 'boolean',
        description: 'Skip confirmation prompt',
        default: false
      });
  },

  async promptArgs(providedArgs = {}) {
    // If path is provided, skip that prompt
    let path = providedArgs.path;
    if (!path) {
      path = await text({
        message: 'Enter the path to unpublish',
        validate: value => !value ? 'Path is required' : undefined
      });
      if (isCancel(path)) return null;
    }

    // If force is not provided, ask for confirmation
    if (!providedArgs.force) {
      const shouldUnpublish = await confirm({
        message: 'Are you sure you want to unpublish this asset?',
        initialValue: false,
        active: 'Yes',
        inactive: 'No'
      });
      if (isCancel(shouldUnpublish) || !shouldUnpublish) return null;
    }

    return { path, force: providedArgs.force };
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
      await quant.unpublish(args.path);
      return 'Unpublished successfully';
    } catch (err) {
      // Check for already unpublished message
      if (err.response?.data?.errorMsg?.includes('already unpublished') ||
          err.response?.data?.errorMsg?.includes('not published')) {
        return color.dim(`Path [${args.path}] is already unpublished`);
      }
      
      // For other errors, show the full response
      throw new Error(`Failed to unpublish: ${err.message}\nResponse: ${JSON.stringify(err.response?.data, null, 2)}`);
    }
  }
};

module.exports = command;
