/**
 * Create a redirect.
 *
 * @usage
 *   quant redirect <from> <to> [status]
 */
const { text, select, isCancel, confirm } = require('@clack/prompts');
const color = require('picocolors');
const config = require('../config');
const client = require('../quant-client');
const isMD5Match = require('../helper/is-md5-match');
const deleteResponse = require('../helper/deleteResponse');

const command = {
  command: 'redirect <from> <to> [status]',
  describe: 'Create a redirect',
  
  builder: (yargs) => {
    return yargs
      .positional('from', {
        describe: 'URL to redirect from',
        type: 'string',
        demandOption: true
      })
      .positional('to', {
        describe: 'URL to redirect to',
        type: 'string',
        demandOption: true
      })
      .positional('status', {
        describe: 'HTTP status code',
        type: 'number',
        default: 302,
        choices: [301, 302, 303, 307, 308]
      })
      .option('delete', {
        describe: 'Delete the redirect',
        alias: ['d'],
        type: 'boolean',
        default: false
      })
      .option('force', {
        describe: 'Delete without confirmation',
        alias: ['f'],
        type: 'boolean',
        default: false
      })
  },

  async promptArgs(providedArgs = {}) {
    let isDelete = providedArgs.delete === true;
    let from = providedArgs.from;

    if (isDelete) {
      from = await text({
        message: 'Enter URL to redirect from',
        validate: value => !value ? 'From URL is required' : undefined
      });
      if (isCancel(from)) return null;
      return { from, to: null, status: null, delete: true, force: providedArgs.force}
    }

    if (!from) {
      from = await text({
        message: 'Enter URL to redirect from',
        validate: value => !value ? 'From URL is required' : undefined
      });
      if (isCancel(from)) return null;
    }

    let to = providedArgs.to;
    if (!to) {
      to = await text({
        message: 'Enter URL to redirect to',
        validate: value => !value ? 'To URL is required' : undefined
      });
      if (isCancel(to)) return null;
    }

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

    return { from, to, status, delete: false, force: false };
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
    const status = args.status || 302;

    try {
      if (args.delete) {
        if (!args.force) {
          const shouldDelete = await confirm({
            message: 'This will delete the redirect. Are you sure?',
            initialValue: false,
            active: 'Yes',
            inactive: 'No'
          });
          if (isCancel(shouldDelete) || !shouldDelete) {
            throw new Error('Operation cancelled');
          }
        }
        await quant.delete(args.from);
        return color.green(`Deleted redirect from ${args.from}`);
      } else {
        await quant.redirect(args.from, args.to, null, status);
        return color.green(`Created redirect from ${args.from} to ${args.to} (${status})`);
      }
    } catch (err) {
      const [ok, message] = deleteResponse(err);
      if (ok) {
        if (message === "success") {
          return color.green("Redirect was deleted");
        }
        if (message === "already deleted") {
          return color.dim("Redirect was already deleted");
        }
      }
      if (isMD5Match(err)) {
        return color.dim(`Skipped redirect from ${args.from} to ${args.to} (already exists)`);
      }
      throw new Error(`Failed to create redirect: ${err.message}`);
    }
  }
};

module.exports = command;
