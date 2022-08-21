/**
 * Deploy a single index.html file to QuantCDN.
 *
 * This allows an optional paramter to define where the asset
 * will be accessible by QuantCDN.
 *
 * @usage
 *   quant page <file> <location>
 */
const config = require('../config');
const client = require('../quant-client');
const chalk = require('chalk');
const io = require('../io');

const command = {};

command.command = 'page <file> <location>';
command.describe = 'Make a local page asset available via Quant';
command.builder = (yargs) => {
  yargs.positional('file', {
    describe: 'Path to local file',
    type: 'string',
  });
  yargs.positional('location', {
    describe: 'The access URI',
    type: 'string',
  });
};

command.handler = function(argv) {
  const filepath = argv.file;
  const location = argv.location;

  // Make sure configuration is loaded.
  if (!config.fromArgs(argv)) {
    io.login();
    yargs.exit(1);
  }

  console.log(chalk.bold.green('*** Quant page ***'));

  client(config).markup(filepath, location)
    .then((body) => console.log(chalk.green('Success: ') + ` Added [${filepath}]`)) // eslint-disable-line
      .catch((err) => console.log(chalk.red.bold('Error:') + ` ${err}`));
};

module.exports = command;
