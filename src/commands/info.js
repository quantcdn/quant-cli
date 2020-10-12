/**
 * Provide info for the current configuration.
 *
 * @usage
 *    quant info
 */

const chalk = require('chalk');
const client = require('../quant-client');
const config = require('../config');

module.exports = function(argv) { // eslint-disable-line
  console.log(chalk.bold.green('*** Quant info ***'));

  if (!config.load()) {
    return console.error(chalk.yellow('Quant is not configured, run init.'));
  }

  console.log(`Endpoint: ${config.get('endpoint')}`);
  console.log(`Customer: ${config.get('clientid')}`);
  console.log(`Project: ${config.get('project')}`);
  console.log(`Token: ****`);

  const quant = client(config);

  quant.ping()
      .then(async (data) => {
        console.log(chalk.bold.green(`✅✅✅ Successfully connected to ${config.get('project')}`)); // eslint-disable-line max-len

        quant.meta()
            .then((data) => {
              console.log(chalk.yellow('\nInfo:'));
              if (data && data.total_records) {
                console.log(`Total records: ${data.total_records}`);
              } else {
                console.log('Use deploy to start seeding!');
              }
            })
            .catch((err) => {
              console.error(chalk.red(err.message));
            });
      })
      .catch((err) => console.log(chalk.bold.red(`Unable to connect to quant ${err.message}`))); // eslint-disable-line max-len
};
