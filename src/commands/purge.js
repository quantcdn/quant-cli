/**
 * Purge the cache for a given url.
 *
 * @usage
 *   quant unpublish <path>
 */
const chalk = require('chalk');
const client = require('../quant-client');
const config = require('../config');
const io = require('../io');

const command = {};

command.command = 'purge <path>';
command.describe = 'Purge the cache for a given url';
command.builder = {};

command.handler = function(argv) {
  // Make sure configuration is loaded.
  if (!config.fromArgs(argv)) {
    io.login();
    yargs.exit(1);
  }

  console.log(chalk.bold.green('*** Quant purge ***'));

  client(config)
      .purge(argv.path)
      .then(response => console.log(chalk.green('Success:') + ` Purged ${argv.path}`)) // eslint-disable-line
      .catch((err) => console.log(chalk.red.bold('Error:') + ` ${err}`));
};

module.exports = command;
