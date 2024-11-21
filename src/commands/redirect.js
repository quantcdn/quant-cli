/**
 * Redirect a QuantCDN path to another.
 *
 * @usage
 *   quant redirect <from> <to> --status
 */
const { text, select, isCancel } = require('@clack/prompts');
const color = require('picocolors');
const config = require('../config');
const client = require('../quant-client');

const command = {
  command: 'redirect <from> <to> [status] [author]',
  describe: 'Create a redirect',
  
  builder: (yargs) => {
    return yargs
      .positional('from', {
        describe: 'Path to redirect from',
        type: 'string'
      })
      .positional('to', {
        describe: 'Path to redirect to',
        type: 'string'
      })
      .positional('status', {
        describe: 'HTTP status code (301 or 302)',
        type: 'number',
        default: 302
      })
      .positional('author', {
        describe: 'Author of the redirect',
        type: 'string'
      });
  },

  async promptArgs() {
    const from = await text({
      message: 'Enter the path to redirect from',
      validate: value => !value ? 'Source path is required' : undefined
    });

    if (isCancel(from)) return null;

    const to = await text({
      message: 'Enter the path to redirect to',
      validate: value => !value ? 'Destination path is required' : undefined
    });

    if (isCancel(to)) return null;

    const status = await select({
      message: 'Select redirect type',
      options: [
        { value: 301, label: '301 - Permanent redirect' },
        { value: 302, label: '302 - Temporary redirect' }
      ],
      initialValue: 302
    });

    if (isCancel(status)) return null;

    const author = await text({
      message: 'Enter author name (optional)',
    });

    if (isCancel(author)) return null;

    return { 
      from, 
      to, 
      status: parseInt(status), 
      author: author || null 
    };
  },

  async handler(args) {
    if (!args) {
      throw new Error('Operation cancelled');
    }

    if (!args.from || !args.to) {
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
      await quant.redirect(args.from, args.to, args.author, args.status);
      return `Added redirect from ${args.from} to ${args.to}`;
    } catch (err) {
      throw new Error(`Failed to create redirect: ${err.message}`);
    }
  }
};

module.exports = command;
