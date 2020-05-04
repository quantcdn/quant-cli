/**
 * Provide info for the current configuration.
 *
 * @usage
 *    quant-cli info
 */

const chalk = require('chalk');
const client = require('../quant-client');
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

  client(config).ping()
      .then((message) => console.log(chalk.bold.green(`✅✅✅ Successfully connected to ${message}`))) // eslint-disable-line max-len
      .catch((message) => console.log(chalk.bold.red(`Unable to connect to quant ${message}`))); // eslint-disable-line max-len
};
