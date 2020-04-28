/**
 * Ping the Quant API.
 */
const request = require('request');
const chalk = require('chalk');

/**
 * Ping the quant API.
 *
 * @param {object} config
 *   A quant config object.
 */
module.exports = function(config) {
  const options = {
    url: `${config.get('endpoint')}/ping`,
    headers: {
      'Content-Type': 'application/json',
      'Quant-Customer': config.get('clientid'),
      'Quant-Token': config.get('token'),
    },
  };

  request(options, (err, res, body) => {
    body = JSON.parse(body);
    if (body.error) {
      // @TODO: Catch specific API errors.
      return console.log(chalk.bold.red('Unable to connect to API'));
    }
    console.log(chalk.bold.green(`✅✅✅ Successfully connected to API using project: ${body.project}`)); // eslint-disable-line max-len
  });
};
