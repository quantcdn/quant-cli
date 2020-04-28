/**
 * Provide info for the current configuration.
 *
 * @usage
 *    quant-cli info
 */

const chalk = require('chalk');
const ping = require('../ping');
const config = require('../config');

/**
 * Print quant info.
 *
 * @param {object} argv
 *   CLI parameters.
 *
 * @return {boolean}
 *   The success status.
 */
module.exports = function(argv) { // eslint-disable-line
  console.log(chalk.bold.green('*** Quant info ***'));

  if (!config.load()) {
    return console.error(chalk.yellow('Quant is not configured, run init.'));
  }

  console.log(`Endpoint: ${config.get('endpoint')}`);
  console.log(`Customer: ${config.get('clientid')}`);
  console.log(`Token: ****`);

  ping(config);
};
