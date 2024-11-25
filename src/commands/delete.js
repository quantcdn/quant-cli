/**
 * Delete content from the Quant API.
 *
 * @usage
 *   quant delete <path>
 */

const { text, confirm, isCancel } = require('@clack/prompts');
const color = require('picocolors');
const config = require('../config');
const client = require('../quant-client');

const command = {
  command: 'delete <path>',
  describe: 'Delete a deployed path from Quant',
  
  builder: (yargs) => {
    return yargs
      .positional('path', {
        describe: 'Deployed asset path to remove',
        type: 'string',
        demandOption: true
      })
      .option('force', {
        alias: 'f',
        type: 'boolean',
        description: 'Delete the asset without confirmation',
        default: false
      });
  },

  async promptArgs(providedArgs = {}) {
    let path = providedArgs.path;
    if (!path) {
      path = await text({
        message: 'Enter the deployed asset path to remove',
        validate: value => !value ? 'Path is required' : undefined
      });
      if (isCancel(path)) return null;
    }

    // If force is not provided, ask for confirmation
    if (!providedArgs.force) {
      const shouldDelete = await confirm({
        message: 'This will delete all revisions of this asset from QuantCDN. Are you sure?',
        initialValue: false,
        active: 'Yes',
        inactive: 'No'
      });
      if (isCancel(shouldDelete) || !shouldDelete) return null;
    }

    return { path, force: providedArgs.force };
  },

  async handler(args) {
    if (!args) {
      throw new Error('Operation cancelled');
    }

    // Check for required path argument
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

    const quant = client(config);

    try {
      const response = await quant.delete(args.path);
      
      // Check if the response indicates success
      if (response && !response.error && response.meta && response.meta[0]) {
        const meta = response.meta[0];
        if (meta.deleted) {
          return color.green(`Successfully removed [${args.path}]`);
        }
      }

      // If we get here, something unexpected happened
      throw new Error(`Unexpected response format: ${JSON.stringify(response, null, 2)}`);

    } catch (err) {
      // If we have a response in the error message, try to parse it
      try {
        const match = err.message.match(/Response: (.*)/s);
        if (match) {
          const responseData = JSON.parse(match[1]);
          
          // Check if this was actually a successful deletion
          if (!responseData.error && responseData.meta && responseData.meta[0]) {
            const meta = responseData.meta[0];
            if (meta.deleted) {
              return color.green(`Successfully removed [${args.path}]`);
            }
            if (meta.deleted_timestamp) {
              return color.dim(`Path [${args.path}] was already deleted`);
            }
          }
        }
      } catch (parseError) {
        // If we can't parse the response, continue with original error
      }
      
      // For actual errors
      throw new Error(`Cannot delete path (${args.path || 'undefined'}): ${err.message}`);
    }
  }
};

module.exports = command;
