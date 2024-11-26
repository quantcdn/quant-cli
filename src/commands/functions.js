/**
 * Deploy edge functions from a JSON file.
 *
 * @usage
 *   quant functions <file>
 */
const fs = require('fs');
const config = require('../config');
const client = require('../quant-client');
const color = require('picocolors');

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
            await quant.edgeAuth(path, description, uuid);
            console.log(color.green(`Deployed auth function: ${path}`));
            break;

          case 'filter':
            await quant.edgeFilter(path, description, uuid);
            console.log(color.green(`Deployed filter function: ${path}`));
            break;

          case 'edge':
          case 'function':
            await quant.edgeFunction(path, description, uuid);
            console.log(color.green(`Deployed edge function: ${path}`));
            break;

          default:
            throw new Error(`Invalid function type: ${type}`);
        }
      } catch (err) {
        throw new Error(`Failed to deploy ${type} function ${path}: ${err.message}`);
      }
    }

    return color.green('All functions deployed successfully');
  }
};

module.exports = command; 