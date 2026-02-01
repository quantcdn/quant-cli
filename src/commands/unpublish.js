/**
 * Unpublish a QuantCDN url.
 *
 * @usage
 *   quant unpublish <path>
 */
import { text, isCancel } from '@clack/prompts';
import color from 'picocolors';
import config from '../config.js';
import client from '../quant-client.js';

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

    const context = {
      config: this.config || config,
      client: this.client || (() => client(config))
    };

    if (!await context.config.fromArgs(args)) {
      process.exit(1);
    }

    const quant = context.client(context.config);

    try {
      const response = await quant.unpublish(args.path);

      // Check if the response indicates success
      if (response && !response.error) {
        return color.green(`Successfully unpublished [${args.path}]`);
      }

      throw new Error(`Unexpected response format: ${JSON.stringify(response, null, 2)}`);
    } catch (err) {
      // If we have a response in the error message, try to parse it
      try {
        if (err.response?.data) {
          const data = err.response.data;

          // Check for specific error messages
          if (data.errorMsg) {
            if (data.errorMsg.includes('not found') || data.errorMsg.includes('does not exist')) {
              return color.dim(`Path [${args.path}] does not exist or is already unpublished`);
            }
            if (data.errorMsg.includes('already unpublished')) {
              return color.dim(`Path [${args.path}] was already unpublished`);
            }
          }

          // If we have a 400 status, it's likely the path doesn't exist
          if (err.response.status === 400) {
            return color.dim(`Path [${args.path}] does not exist or is already unpublished`);
          }

          throw new Error(`Failed to unpublish: ${err.message}\nResponse: ${JSON.stringify(data, null, 2)}`);
        }

        const match = err.message.match(/Response: (.*)/s);
        if (match) {
          const responseData = JSON.parse(match[1]);

          // Check if this was actually a successful unpublish
          if (!responseData.error) {
            return color.green(`Successfully unpublished [${args.path}]`);
          }

          // Check if the path was already unpublished
          if (responseData.errorMsg) {
            if (responseData.errorMsg.includes('not found') || responseData.errorMsg.includes('does not exist')) {
              return color.dim(`Path [${args.path}] does not exist or is already unpublished`);
            }
            if (responseData.errorMsg.includes('already unpublished')) {
              return color.dim(`Path [${args.path}] was already unpublished`);
            }
          }
        }
      } catch (_parseError) {
        // If we can't parse the response, continue with original error
      }

      // For actual errors
      if (err.response?.status === 404) {
        return color.dim(`Path [${args.path}] does not exist or is already unpublished`);
      }

      throw new Error(`Failed to unpublish: ${err.message}`);
    }
  }
};

export default command;
