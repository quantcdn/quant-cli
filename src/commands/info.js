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

  const quant = client(config);

  quant.ping()
      .then((data) => {
        console.log(chalk.bold.green(`✅✅✅ Successfully connected to ${data.project}`)); // eslint-disable-line max-len
        quant.meta()
            .then((data) => {
              console.log(chalk.yellow('\nPublished to your Quant:'));
              /* eslint-disable guard-for-in */
              for (const path in data.meta) {
                console.log(` - ${path}`);
              }
              /* eslint-enable guard-for-in */
            })
            .catch((err) => {
              console.log('No content has been deployed to Quant.');
            });
      })
      .catch((err) => console.log(chalk.bold.red(`Unable to connect to quant ${err.message}`))); // eslint-disable-line max-len
};
