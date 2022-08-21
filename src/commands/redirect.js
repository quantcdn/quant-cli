/**
 * Redirect a QuantCDN path to another.
 *
 * @usage
 *   quant redirect <from> <to> --status
 */
const chalk = require('chalk');
const config = require('../config');
const io = require('../io');
const client = require('../quant-client');

const command = {};

command.command = 'redirect <from> <to> [status] [author]';
command.describe = 'Create a redirect';
command.builder = (yargs) => {
  yargs.default('status', 302);
  yargs.default('author', null);
  return yargs;
};

command.handler = function(argv) {
  // Make sure configuration is loaded.
  if (!config.fromArgs(argv)) {
    io.login();
    yargs.exit(1);
  }

  console.log(chalk.bold.green('*** Quant redirect ***'));

  // @TODO: Accept argv.dir.
  if (!config.fromArgs(argv)) {
    return console.error(chalk.yellow('Quant is not configured, run init.'));
  }

  client(config).redirect(argv.from, argv.to, argv.author, argv.status)
    .then((body) => console.log(chalk.green('Success: ') + ` Added redirect ${from} to ${to}`)) // eslint-disable-line
      .catch((err) => console.log(chalk.red.bold('Error:') + ` ${err}`));
};

module.exports = command;
