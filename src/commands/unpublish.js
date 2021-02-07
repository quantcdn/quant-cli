/**
 * Unpublish a QuantCDN url.
 *
 * @usage
 *   quant unpublish <path>
 */
const chalk = require('chalk');
const client = require('../quant-client');
const config = require('../config');

const command = {};

command.command = 'unpublish <path>';
command.describe = 'Unpublish an asset';
command.builder = {};

command.handler = function(argv) {
  console.log(chalk.bold.green('*** Quant unpublish ***'));

  // config.fromArgs(argv);
  if (!config.fromArgs(argv)) {
    return console.error(chalk.yellow('Quant is not configured, run init.'));
  }

  client(config)
      .unpublish(argv.path)
      .then(response => console.log(chalk.green('Success:') + ` Unpublished ${url}`)) // eslint-disable-line
      .catch((err) => console.log(chalk.red.bold('Error:') + ` ${err}`));
};

module.exports = command;
