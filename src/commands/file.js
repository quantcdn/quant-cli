/**
 * Deploy a single file to QuantCDN.
 *
 * This allows an optional paramter to define where the asset
 * will be accessible by QuantCDN.
 *
 * @usage
 *   quant file <file> <location>
 */
const { text, confirm, isCancel } = require('@clack/prompts');
const color = require('picocolors');
const config = require('../config');
const client = require('../quant-client');

const command = {
  command: 'file <file> <location>',
  describe: 'Deploy a single asset',
  
  builder: (yargs) => {
    return yargs
      .positional('file', {
        describe: 'Path to local file',
        type: 'string'
      })
      .positional('location', {
        describe: 'The access URI',
        type: 'string'
      });
  },

  async promptArgs() {
    const file = await text({
      message: 'Enter path to local file',
      validate: value => !value ? 'File path is required' : undefined
    });

    if (isCancel(file)) return null;

    const location = await text({
      message: 'Enter the access URI (where the file will be available)',
      validate: value => !value ? 'Location is required' : undefined
    });

    if (isCancel(location)) return null;

    return { file, location };
  },

  async handler(args) {
    if (!args) {
      throw new Error('Operation cancelled');
    }

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
      await quant.file(args.file, args.location);
      return `Added [${args.file}]`;
    } catch (err) {
      throw new Error(`File [${args.file}] exists at location (${args.location})`);
    }
  }
};

module.exports = command;
