/**
 * Unpublish a QuantCDN url.
 *
 * @usage
 *   quant unpublish <path>
 */
const { text, isCancel } = require('@clack/prompts');
const config = require('../config');
const client = require('../quant-client');

const command = {
  command: 'unpublish <path>',
  describe: 'Unpublish an asset',
  
  builder: (yargs) => {
    return yargs
      .positional('path', {
        describe: 'Path to unpublish',
        type: 'string',
        demandOption: true
      });
  },

  async promptArgs(providedArgs = {}) {
    let path = providedArgs.path;
    if (!path) {
      path = await text({
        message: 'Enter the path to unpublish',
        validate: value => !value ? 'Path is required' : undefined
      });
      if (isCancel(path)) return null;
    }

    return { path };
  },

  async handler(args) {
    if (!args) {
      throw new Error('Operation cancelled');
    }

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
      await quant.unpublish(args.path);
      return `Successfully unpublished [${args.path}]`;
    } catch (err) {
      // Format a user-friendly error message
      if (err.response?.status === 404) {
        throw new Error(`Path [${args.path}] not found`);
      }
      
      // Try to extract error message from response
      const errorMessage = err.response?.data?.errorMsg || err.message;
      const responseData = err.response?.data ? JSON.stringify(err.response.data, null, 2) : 'No response data';
      
      throw new Error(`Failed to unpublish: ${errorMessage}\nResponse: ${responseData}`);
    }
  }
};

module.exports = command;
