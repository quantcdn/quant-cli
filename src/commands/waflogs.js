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
  command: 'waf:logs',
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

  async promptArgs(providedArgs = {}) {
    // If all is provided, skip that prompt
    let fetchAll = providedArgs.all;
    if (typeof fetchAll !== 'boolean') {
      fetchAll = await confirm({
        message: 'Fetch all logs from the server?',
        initialValue: false
      });
      if (isCancel(fetchAll)) return null;
    }

    // If size is provided, skip that prompt
    let size = providedArgs.size;
    if (!size) {
      const sizeInput = await text({
        message: 'Number of logs to return per request',
        defaultValue: '10',
        validate: value => {
          const num = parseInt(value);
          if (isNaN(num) || num < 1) {
            return 'Please enter a valid number';
          }
        }
      });
      if (isCancel(sizeInput)) return null;
      size = parseInt(sizeInput);
    }

    // If fields is provided, skip that prompt
    let fields = providedArgs.fields;
    if (fields === undefined) {
      fields = await text({
        message: 'Enter comma-separated field names to show (optional)',
      });
      if (isCancel(fields)) return null;
      // Don't return empty string
      fields = fields || null;
    }

    // If output is provided, skip that prompt
    let output = providedArgs.output;
    if (output === undefined) {
      output = await text({
        message: 'Location to write CSV output (optional)',
      });
      if (isCancel(output)) return null;
      // Don't return empty string
      output = output || null;
    }

    return {
      all: fetchAll,
      size,
      fields: fields ? (typeof fields === 'string' ? fields.split(',') : fields) : null,
      output: output || null
    };
  },

  async handler(args) {
    if (!args) {
      throw new Error('Operation cancelled');
    }

    // Check for optional arguments and prompt if not provided
    if (!args.fields && !args.output && args.all === undefined && !args.size) {
      const promptedArgs = await this.promptArgs(args);
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

      let allLogs = [];
      let currentPage = 1;
      let totalPages = 1;

      do {
        const response = await quant.wafLogs(args.all, { 
          page_size: args.size,
          page: currentPage 
        });

        if (response === -1) {
          throw new Error('Invalid credentials provided, please check your token has access');
        }

        allLogs = allLogs.concat(response.records);
        totalPages = response.total_pages;
        currentPage++;

        if (args.all && currentPage <= totalPages) {
          console.log(`Fetching page ${currentPage} of ${totalPages}...`);
        }
      } while (args.all && currentPage <= totalPages);

      if (args.output) {
        try {
          fs.writeFileSync(args.output, papa.unparse(allLogs));
          return `Logs saved to ${args.output}`;
        } catch (err) {
          throw new Error(`Failed to write output file: ${err.message}`);
        }
      }

      // Format the logs output
      if (!allLogs || allLogs.length === 0) {
        return 'No logs found';
      }

      let output = `Found ${allLogs.length} logs\n`;
      
      if (args.fields) {
        const fields = typeof args.fields === 'string' ? args.fields.split(',') : args.fields;
        allLogs.forEach(log => {
          output += '\n---\n';
          fields.forEach(field => {
            if (log[field] !== undefined) {
              output += `${field}: ${log[field]}\n`;
            }
          });
        });
      } else {
        allLogs.forEach(log => {
          output += '\n---\n';
          Object.entries(log).forEach(([key, value]) => {
            if (key === 'meta') {
              try {
                const meta = JSON.parse(value);
                Object.entries(meta).forEach(([metaKey, metaValue]) => {
                  output += `${metaKey}: ${metaValue}\n`;
                });
              } catch (e) {
                output += `${key}: ${value}\n`;
              }
            } else {
              output += `${key}: ${value}\n`;
            }
          });
        });
      }

      return output;

    } catch (err) {
      // Format a user-friendly error message
      let errorMessage = 'Failed to fetch WAF logs: ';
      if (err.code === 'ECONNREFUSED') {
        errorMessage += 'Could not connect to the API server';
      } else if (err.response && err.response.data) {
        errorMessage += `${err.message}\nResponse: ${JSON.stringify(err.response.data, null, 2)}`;
      } else {
        errorMessage += err.message;
      }

      throw new Error(errorMessage);
    }
  }
};

module.exports = command;
