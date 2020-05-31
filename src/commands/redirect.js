/**
 * Redirect a QuantCDN path to another.
 *
 * @usage
 *   quant redirect -f /path/from -t /path/to
 *   quant redirect -f /path/from -t /path/to -s false
 */

const logger = require('../service/logger')();
const config = require('../config');
const client = require('../quant-client');

module.exports = function(argv) {
  const status = argv.status || 302;
  const author = argv.author || null;
  const from = argv.from;
  const to = argv.to;

  logger.title('Redirect');

  // @TODO: Accept argv.dir.
  config.load();

  client(config).redirect(from, to, author, status)
      .then((body) => logger.success(`Added redirect ${from} to ${to}`)) // eslint-disable-line
      .catch((err) => logger.fatal(err));
};

