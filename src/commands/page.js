/**
 * Deploy a single index.html file to QuantCDN.
 */
const { text, isCancel } = require('@clack/prompts');
const config = require('../config');
const client = require('../quant-client');
const fs = require('fs');
const isMD5Match = require('../helper/is-md5-match');

const command = {
  command: 'page <file> <location>',
  describe: 'Make a local page asset available via Quant',
  
  builder: (yargs) => {
    return yargs
      .positional('file', {
        describe: 'Path to local HTML file',
        type: 'string',
        demandOption: true
      })
      .positional('location', {
        describe: 'The access URI',
        type: 'string',
        demandOption: true
      })
      .option('enable-index-html', {
        describe: 'Keep index.html in URLs',
        type: 'boolean'
      })
      .example('quant page index.html /about', 'Deploy a page')
      .example('quant page about.html /about --enable-index-html', 'Deploy with index.html suffix');
  },

  async promptArgs(providedArgs = {}) {
    let file = providedArgs.file;
    if (!file) {
      file = await text({
        message: 'Enter path to local HTML file',
      validate: value => !value ? 'File path is required' : undefined
      });
      if (isCancel(file)) return null;
    }

    let location = providedArgs.location;
    if (!location) {
      location = await text({
      message: 'Enter the access URI (where the page will be available)',
      validate: value => !value ? 'Location is required' : undefined
      });
      if (isCancel(location)) return null;
    }

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

    const enableIndexHtml = context.config.get('enableIndexHtml');
    let location = args.location;

    if (enableIndexHtml && !location.endsWith('index.html')) {
      location = location.replace(/\/?$/, '/index.html');
    }
    else if (!enableIndexHtml && location.endsWith('index.html')) {
      location = location.replace(/index\.html$/, '');
    }

    const quant = context.client(context.config);

    try {
      await quant.markup(args.file, location);
      return `Added [${args.file}]`;
    } catch (err) {
      if (isMD5Match(err)) {
        return `Skipped [${args.file}] (content unchanged)`;
      }
      throw new Error(`Failed to add page: ${err.message}`);
    }
  }
};

module.exports = command;
