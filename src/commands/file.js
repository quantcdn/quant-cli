/**
 * Deploy a single file to QuantCDN.
 */
const { text, isCancel } = require('@clack/prompts');
const config = require('../config');
const client = require('../quant-client');
const fs = require('fs');
const isMD5Match = require('../helper/is-md5-match');

const command = {
  command: 'file <file> <location>',
  describe: 'Deploy a single asset',
  
  builder: (yargs) => {
    return yargs
      .positional('file', {
        describe: 'Path to local file',
        type: 'string',
        demandOption: true
      })
      .positional('location', {
        describe: 'The access URI',
        type: 'string',
        demandOption: true
      })
      .example('quant file style.css /css/style.css', 'Deploy a CSS file')
      .example('quant file image.jpg /images/header.jpg', 'Deploy an image');
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
    const context = {
      config: this.config || config,
      client: this.client || (() => client(config)),
      fs: this.fs || fs
    };

    if (!args || (!args.file && !args.location)) {
      const promptedArgs = await this.promptArgs();
      if (!promptedArgs) {
        throw new Error('Operation cancelled');
      }
      args = { ...args || {}, ...promptedArgs };
    }

    if (!await context.config.fromArgs(args)) {
      process.exit(1);
    }

    const quant = context.client(context.config);

    try {
      await quant.file(args.file, args.location);
      return `Added [${args.file}]`;
    } catch (err) {
      if (isMD5Match(err)) {
        return `Skipped [${args.file}] (content unchanged)`;
      }
      
      throw new Error(`File [${args.file}] exists at location (${args.location})`);
    }
  }
};

module.exports = command;
