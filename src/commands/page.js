/**
 * Deploy a single index.html file to QuantCDN.
 *
 * This allows an optional paramter to define where the asset
 * will be accessible by QuantCDN.
 *
 * @usage
 *   quant page <file> <location>
 */
const { text, isCancel } = require('@clack/prompts');
const color = require('picocolors');
const config = require('../config');
const client = require('../quant-client');

const command = {
  command: 'page <file> <location>',
  describe: 'Make a local page asset available via Quant',
  
  builder: (yargs) => {
    return yargs
      .positional('file', {
        describe: 'Path to local HTML file',
        type: 'string'
      })
      .positional('location', {
        describe: 'The access URI',
        type: 'string'
      });
  },

  async promptArgs() {
    const file = await text({
      message: 'Enter path to local HTML file',
      validate: value => !value ? 'File path is required' : undefined
    });

    if (isCancel(file)) return null;

    const location = await text({
      message: 'Enter the access URI (where the page will be available)',
      validate: value => !value ? 'Location is required' : undefined
    });

    if (isCancel(location)) return null;

    return { file, location };
  },

  async handler(args) {
    if (!args) {
      throw new Error('Operation cancelled');
    }

    // Check for required arguments and prompt if missing
    if (!args.file || !args.location) {
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
      await quant.markup(args.file, args.location);
      return `Added [${args.file}]`;
    } catch (err) {
      throw new Error(`Failed to add page: ${err.message}`);
    }
  }
};

module.exports = command;
