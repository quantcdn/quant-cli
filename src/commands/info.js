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
                let pub;
                if (data.meta[path].published) {
                  pub = chalk.green('published');
                } else {
                  pub = chalk.yellow('unpublished');
                }
                console.log(` - ${path} (${pub})`);
              }
              /* eslint-enable guard-for-in */
            })
            .catch((err) => {
              console.log('No content has been deployed to Quant.');
            });
      })
      .catch((err) => console.log(chalk.bold.red(`Unable to connect to quant ${err.message}`))); // eslint-disable-line max-len
};
