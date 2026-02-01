/**
 * Deploy edge functions from a JSON file.
 *
 * @usage
 *   quant functions <file>
 */
import fs from 'fs';
import config from '../config.js';
import client from '../quant-client.js';
import color from 'picocolors';
import isMD5Match from '../helper/is-md5-match.js';

const command = {
  command: 'functions <file>',
  describe: 'Deploy edge functions from a JSON configuration file',

  builder: (yargs) => {
    return yargs
      .positional('file', {
        describe: 'Path to JSON configuration file',
        type: 'string',
        demandOption: true
      })
      .example('quant functions functions.json', 'Deploy functions from config file');
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

    // Read and parse the JSON file
    let functions;
    try {
      const content = fs.readFileSync(args.file, 'utf8');
      functions = JSON.parse(content);
    } catch (err) {
      throw new Error(`Failed to read functions file: ${err.message}`);
    }

    // Process each function
    for (const func of functions) {
      const { type, path, description, uuid } = func;

      // Validate required fields
      if (!type || !path || !description) {
        throw new Error('Each function must have type, path, and description');
      }

      // Validate file exists
      if (!fs.existsSync(path)) {
        throw new Error(`Function file not found: ${path}`);
      }

      try {
        switch (type.toLowerCase()) {
          case 'auth':
            try {
              await quant.edgeAuth(path, description, uuid);
              console.log(color.green(`Deployed auth function: ${path}`));
            } catch (err) {
              if (isMD5Match(err)) {
                console.log(color.dim(`Skipped auth function: ${path} (content unchanged)`));
              } else {
                throw err;
              }
            }
            break;

          case 'filter':
            try {
              await quant.edgeFilter(path, description, uuid);
              console.log(color.green(`Deployed filter function: ${path}`));
            } catch (err) {
              if (isMD5Match(err)) {
                console.log(color.dim(`Skipped filter function: ${path} (content unchanged)`));
              } else {
                throw err;
              }
            }
            break;

          case 'edge':
          case 'function':
            try {
              await quant.edgeFunction(path, description, uuid);
              console.log(color.green(`Deployed edge function: ${path}`));
            } catch (err) {
              if (isMD5Match(err)) {
                console.log(color.dim(`Skipped edge function: ${path} (content unchanged)`));
              } else {
                throw err;
              }
            }
            break;

          default:
            throw new Error(`Invalid function type: ${type}`);
        }
      } catch (err) {
        throw new Error(`Failed to deploy ${type} function ${path}: ${err.message}`);
      }
    }

    return color.green('All functions processed successfully');
  }
};

export default command;
