/**
 * Provide info for the current configuration.
 *
 * @usage
 *    quant info
 */
const chalk = require('chalk');
const client = require('../quant-client');
const config = require('../config');
const io = require('../io');

const command = {};

command.command = 'info';
command.describe = 'Give info based on current configuration';
command.builder = {};

command.handler = function(argv) { // eslint-disable-line
  // Make sure configuration is loaded.
  if (!config.fromArgs(argv)) {
    io.login();
    yargs.exit(1);
  }

  io.title('info');

  io.update(`Endpoint: ${config.get('endpoint')}`, io.status.nil);
  io.update(`Customer: ${config.get('clientid')}`, io.status.nil);
  io.update(`Project: ${config.get('project')}`, io.status.nil);
  io.update(`Token: ****`, io.status.nil);

  const quant = client(config);

  quant.ping()
      .then(async (data) => {
        io.success(`Successfully connected to ${config.get('project')}`);

        quant.meta()
            .then((data) => {
              io.info('\nInfo:');
              if (data && data.total_records) {
                io.update(`Total records: ${data.total_records}`, io.status.nil);
              } else {
                io.update('Use deploy to start seeding!', io.status.nil);
              }
            })
            .catch((err) => {
              io.critical(err.message);
            });
      })
      .catch((err) => io.critical(`Unable to connect to quant ${err.message}`)); // eslint-disable-line max-len
};

module.exports = command;
