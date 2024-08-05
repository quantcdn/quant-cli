/**
 * Deploy a single file to QuantCDN.
 *
 * This allows an optional paramter to define where the asset
 * will be accessible by QuantCDN.
 *
 * @usage
 *   quant file <file> <location>
 */
const config = require('../config');
const client = require('../quant-client');
const chalk = require('chalk');
const util = require('util');

const command = {};

command.command = 'file <file> <location>';
command.describe = 'Deploy a single asset';
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

  // @TODO: Support dir.
  if (!config.fromArgs(argv)) {
    return console.error(chalk.yellow('Quant is not configured, run init.'));
  }

  console.log(chalk.bold.green('*** Quant file ***'));

  client(config).file(filepath, location)
      .then((body) => console.log(chalk.green('Success: ') + ` Added [${filepath}]`))  
      .catch((err) => {
        msg = util.format(chalk.yellow('File [%s] exists at location (%s)'), filepath, location);  
        console.log(msg);
      });
};

module.exports = command;
