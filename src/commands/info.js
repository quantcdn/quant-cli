/**
 * Provide info for the current configuration.
 *
 * @usage
 *    quant info
 */
const chalk = require('chalk');
const client = require('../quant-client');
const config = require('../config');

const command = {};

command.command = 'info';
command.describe = 'Give info based on current configuration';
command.builder = {};

command.handler = function(argv) { // eslint-disable-line
  console.log(chalk.bold.green('*** Quant info ***'));

  if (!config.fromArgs(argv)) {
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
                const totals = {'content': 0, 'redirects': 0};

                if (data.records) {
                  data.records.map(async (item) => {
                    if (item.type && item.type == 'redirect') {
                      totals.redirects++;
                    } else {
                      totals.content++;
                    }
                  });
                  console.log(`  - content: ${totals.content}`);
                  console.log(`  - redirects: ${totals.redirects}`);
                }
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

module.exports = command;
