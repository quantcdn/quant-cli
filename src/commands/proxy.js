/**
 * Proxy a route in QuantCDN to an origin.
 *
 * @usage
 *   quant proxy <path> <origin> --status --basicAuthUser --basicAuthPass
 */
const chalk = require('chalk');
const config = require('../config');
const client = require('../quant-client');

const command = {};

command.command = 'proxy <path> <origin> [status] [basicAuthUser] [basicAuthPass]';
command.describe = 'Create a proxy to allow traffic directly to origin';
command.builder = (yargs) => {
  yargs.positional('path', {
    describe: 'The path that end users will see',
    type: 'string',
  });

  yargs.positional('origin', {
    describe: 'FQDN including path to proxy to',
    type: 'string',
  });

  yargs.positional('status', {
    describe: 'If the proxy is enabled',
    type: 'boolean',
    default: true,
  });

  yargs.positional('basicAuthUser', {
    describe: 'User between edge and origin',
    type: 'string',
    default: null,
  });

  yargs.positional('basicAuthPass', {
    describe: 'Password between edge and origin',
    type: 'string',
    default: null,
  });

  return yargs;
};

command.handler = function(argv) {
  const url = argv.path;
  const dest = argv.origin;
  const status = argv.status;
  const user = argv.basicAuthUser;
  const pass = argv.basicAuthPass;

  // @TODO: Accept argv.dir.
  if (!config.fromArgs(argv)) {
    return console.error(chalk.yellow('Quant is not configured, run init.'));
  }

  console.log(chalk.bold.green('*** Quant proxy ***'));

  client(config).proxy(url, dest, status, user, pass)
    .then((body) => console.log(chalk.green('Success: ') + ` Added proxy for ${url} to ${dest}`)) // eslint-disable-line
      .catch((err) => console.log(chalk.red.bold('Error:') + ` ${err}`));
};

module.exports = command;
