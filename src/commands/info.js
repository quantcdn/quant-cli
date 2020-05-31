/**
 * Provide info for the current configuration.
 *
 * @usage
 *    quant info
 */

const {title, success, info, log, table, fatal, warn} = require('../service/logger');
const client = require('../quant-client');
const config = require('../config');

module.exports = function(argv) { // eslint-disable-line

  title('Info');

  if (!config.load()) {
    return info('Quant is not configured, run init.');
  }

  table(
      ['Endpoint', 'Customer', 'Project', 'Token'],
      [
        config.get('endpoint'),
        config.get('clientid'),
        config.get('project'),
        '****',
      ],
  );

  const quant = client(config);

  quant.ping()
      .then((data) => {
        success(
            `Successfully connected to ${config.get('project')}`,
        ); // eslint-disable-line max-len
        quant.meta()
            .then((data) => {
              info('Published to your Quant:');
              /* eslint-disable guard-for-in */
              for (const path in data.meta) {
                let pub;
                if (data.meta[path].published) {
                  pub = chalk.green('published');
                } else {
                  pub = chalk.yellow('unpublished');
                }
                log(` - ${path} (${pub})`);
              }
              /* eslint-enable guard-for-in */
            })
            .catch((err) => {
              if (err.message == 'Global meta not found!') {
                return warn('Unable to gather Quant metadata.');
              }
              info('No content has been deployed to Quant.');
            });
      })
      .catch((err) => fatal(`Unable to connect to quant ${err.message}`)); // eslint-disable-line max-len
};
