/**
 * Deploy a single index.html file to QuantCDN.
 *
 * This allows an optional paramter to define where the asset
 * will be accessible by QuantCDN.
 *
 * @usage
 *   quant page -f /path/to/index.html
 *   quant page -f /path/to/index.html-l /path/in/quant
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
