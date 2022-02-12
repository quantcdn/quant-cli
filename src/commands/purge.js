/**
 * Purge the cache for a given url.
 *
 * @usage
 *   quant unpublish <path>
 */
const chalk = require('chalk');
const client = require('../quant-client');
const config = require('../config');

const command = {};

command.command = 'purge <path>';
command.describe = 'Purge the cache for a given url';
command.builder = {};

command.handler = function(argv) {
  console.log(chalk.bold.green('*** Quant purge ***'));

  // config.fromArgs(argv);
  if (!config.fromArgs(argv)) {
    return console.error(chalk.yellow('Quant is not configured, run init.'));
  }

  client(config)
      .purge(argv.path)
      .then(response => console.log(chalk.green('Success:') + ` Purged ${argv.path}`)) // eslint-disable-line
      .catch((err) => console.log(chalk.red.bold('Error:') + ` ${err}`));
};

module.exports = command;
