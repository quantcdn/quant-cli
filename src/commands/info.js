/**
 * Provide info for the current configuration.
 *
 * @usage
 *    quant info
 */

const logger = require('../service/logger');
const client = require('../quant-client');
const config = require('../config');

module.exports = async function(argv) { // eslint-disable-line
  let data;

  logger.title('Info');

  if (!config.load()) {
    return logger.info('Quant is not configured, run init.');
  }

  logger.table(
      ['Endpoint', 'Customer', 'Project', 'Token'],
      [
        config.get('endpoint'),
        config.get('clientid'),
        config.get('project'),
        '****',
      ],
  );

  const quant = client(config);

  try {
    await quant.ping();
  } catch (err) {
    logger.fatal(err.message);
    return -1;
  }

  logger.success(`Successfully connected to ${config.get('project')}`);

  try {
    data = await quant.meta();
  } catch (err) {
    if (err.message == 'Global meta not found!') {
      logger.warn('Unable to gather Quant metadata.');
      return -2;
    }
    logger.info('No content has been deployed to Quant.');
    return -3;
  }

  logger.info('Published to your Quant:');

  /* eslint-disable guard-for-in */
  for (const path in data.meta) {
    let pub;
    if (data.meta[path].published) {
      pub = chalk.green('published');
    } else {
      pub = chalk.yellow('unpublished');
    }
    logger.log(` - ${path} (${pub})`);
  }
  /* eslint-enable guard-for-in */

};
