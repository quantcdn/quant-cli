/**
 * Provides access to the WAF logs for a project.
 *
 * @usage
 *   quant waf-logs
 */

const { text, confirm, isCancel, select } = require('@clack/prompts');
const color = require('picocolors');
const config = require('../config');
const client = require('../quant-client');
const papa = require('papaparse');
const fs = require('fs');

const command = {
  command: 'waf-logs',
  describe: 'Access project WAF logs',
  
  builder: (yargs) => {
    return yargs
      .option('fields', {
        alias: 'f',
        describe: 'CSV of field names to show for the logs',
        type: 'string'
      })
      .option('output', {
        alias: 'o',
        describe: 'Location to write CSV output',
        type: 'string'
      })
      .option('all', {
        describe: 'Fetch all logs from the server',
        type: 'boolean',
        default: false
      })
      .option('size', {
        describe: 'Number of logs to return per request',
        type: 'number',
        default: 10
      });
  },

  async promptArgs() {
    const fetchAll = await confirm({
      message: 'Fetch all logs from the server?',
      initialValue: false
    });

    if (isCancel(fetchAll)) return null;

    const size = await text({
      message: 'Number of logs to return per request',
      defaultValue: '10',
      validate: value => {
        const num = parseInt(value);
        if (isNaN(num) || num < 1) {
          return 'Please enter a valid number';
        }
      }
    });

    if (isCancel(size)) return null;

    const fields = await text({
      message: 'Enter comma-separated field names to show (optional)',
    });

    if (isCancel(fields)) return null;

    const outputFile = await text({
      message: 'Location to write CSV output (optional)',
    });

    if (isCancel(outputFile)) return null;

    return {
      all: fetchAll,
      size: parseInt(size),
      fields: fields ? fields.split(',') : undefined,
      output: outputFile || undefined
    };
  },

  async handler(args) {
    if (!args) {
      throw new Error('Operation cancelled');
    }

    // Check for optional arguments and prompt if not provided
    if (!args.fields && !args.output && !args.all && !args.size) {
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
    const logs = await quant.wafLogs(args.all, { per_page: args.size });

    if (logs === -1) {
      throw new Error('Invalid credentials provided, please check your token has access');
    }

    if (args.output) {
      fs.writeFileSync(args.output, papa.unparse(logs));
    }

    return {
      logs,
      fields: args.fields,
      savedTo: args.output
    };
  }
};

module.exports = command;
