/**
 * Create a redirect.
 *
 * @usage
 *   quant redirect <from> <to> [status]
 */
const { text, confirm, isCancel, select } = require('@clack/prompts');
const color = require('picocolors');
const config = require('../config');
const client = require('../quant-client');

const command = {
  command: 'redirect <from> <to> [status]',
  describe: 'Create a redirect',
  
  builder: (yargs) => {
    return yargs
      .positional('from', {
        describe: 'URL to redirect from',
        type: 'string'
      })
      .positional('to', {
        describe: 'URL to redirect to',
        type: 'string'
      })
      .positional('status', {
        describe: 'HTTP status code',
        type: 'number',
        default: 302,
        choices: [301, 302, 303, 307, 308]
      });
  },

  async promptArgs(providedArgs = {}) {
    // If from is provided, skip that prompt
    let from = providedArgs.from;
    if (!from) {
      from = await text({
        message: 'Enter URL to redirect from',
        validate: value => !value ? 'From URL is required' : undefined
      });
      if (isCancel(from)) return null;
    }

    // If to is provided, skip that prompt
    let to = providedArgs.to;
    if (!to) {
      to = await text({
        message: 'Enter URL to redirect to',
        validate: value => !value ? 'To URL is required' : undefined
      });
      if (isCancel(to)) return null;
    }

    // If status is provided, skip that prompt
    let status = providedArgs.status;
    if (!status) {
      status = await select({
        message: 'Select HTTP status code',
        options: [
          { value: 301, label: '301 - Permanent' },
          { value: 302, label: '302 - Found (Temporary)' },
          { value: 303, label: '303 - See Other' },
          { value: 307, label: '307 - Temporary Redirect' },
          { value: 308, label: '308 - Permanent Redirect' }
        ],
        initialValue: 302
      });
      if (isCancel(status)) return null;
    }

    return { from, to, status };
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
      await quant.redirect(args.from, args.to, null, args.status);
      return `Created redirect from ${args.from} to ${args.to} (${args.status})`;
    } catch (err) {
      throw new Error(`Failed to create redirect: ${err.message}`);
    }
  }
};

module.exports = command;
