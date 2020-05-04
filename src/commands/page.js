/**
 * Send a single index file to Quant.
 */

const config = require('../config');
const client = require('../quant-client');

const chalk = require('chalk');

module.exports = function(argv) {
  const filepath = argv.filepath;
  const location = argv.location;

  console.log(chalk.bold.green('*** Quant page ***'));

  // @TODO: add dir support.
  config.load();

  client(config).markup(filepath, location)
    .then((body) => console.log(chalk.green('Success: ') + ` Added [${filepath}]`)) // eslint-disable-line
      .catch((err) => console.log(chalk.red.bold('Error:') + ` ${err}`));
};
