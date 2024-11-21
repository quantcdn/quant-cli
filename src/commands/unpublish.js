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
  command: 'unpublish <path>',
  describe: 'Unpublish an asset',
  
  builder: (yargs) => {
    return yargs
      .positional('path', {
        describe: 'Path to unpublish',
        type: 'string'
      })
      .option('force', {
        alias: 'f',
        describe: 'Skip confirmation prompt',
        type: 'boolean',
        default: false
      });
  },

  async promptArgs() {
    const path = await text({
      message: 'Enter the path to unpublish',
      validate: value => !value ? 'Path is required' : undefined
    });

    if (isCancel(path)) return null;

    const confirmUnpublish = await confirm({
      message: 'Are you sure you want to unpublish this asset?',
      initialValue: false
    });

    if (isCancel(confirmUnpublish) || !confirmUnpublish) return null;

    return { path };
  },

  async handler(args) {
    if (!args) {
      throw new Error('Operation cancelled');
    }

    // Check for required arguments and prompt if missing
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

    // If not in force mode and not coming from interactive prompt, confirm
    if (!args.force && !args._interactiveMode) {
      console.log(color.yellow('This will unpublish the asset from QuantCDN'));
      console.log(color.yellow('Use --force to skip this warning'));
      process.exit(0);
    }

    const quant = client(config);
    try {
      await quant.unpublish(args.path);
      return 'Unpublished successfully';
    } catch (err) {
      throw new Error(`Failed to unpublish: ${err.message}`);
    }
  }
};

module.exports = command;
