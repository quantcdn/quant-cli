/**
 * Provides access to the WAF logs for a project.
 *
 * @usage
 *   quant waf-logs
 */

const chalk = require('chalk');
const client = require('../quant-client');
const config = require('../config');
const papa = require('papaparse');
const fs = require('fs');

const command = {};

command.command = 'waf:logs';
command.describe = 'Access a projects WAF logs';
command.builder = (yargs) => {
  yargs.option('fields', {
    alias: 'f',
    describe: 'CSV of field names to show for the logs',
    type: 'string',
  });
  yargs.option('output', {
    alias: 'o',
    describe: 'Location to write CSV output',
    type: 'string',
  });
  yargs.option('all', {
    describe: 'Fetch all logs from the server',
    type: 'boolean',
    default: false,
  });
  yargs.option('size', {
    describe: 'Number of logs to return per request',
    type: 'integer',
    default: 10,
  });
};

command.handler = async function(argv) {  
  console.log(chalk.bold.green('*** Quant WAF Logs***'));

  if (!config.fromArgs(argv)) {
    return console.error(chalk.yellow('Quant is not configured, run init.'));
  }

  const quant = client(config);
  let fields = argv.fields;

  if (fields) {
    fields = fields.split(',');
  }

  console.log(chalk.gray('Fetching log data...'));

  logs = await quant.wafLogs(argv.all, {per_page: argv.size});

  if (logs === -1) {
    console.log(chalk.red('Invalid credentials provided, please check your token has access.'));
    return;
  }

  console.table(logs, fields);

  if (argv.output) {
    fs.writeFileSync(argv.output, papa.unparse(logs));
    console.log(`Saved output to ${argv.output}`);
  }
};

module.exports = command;
