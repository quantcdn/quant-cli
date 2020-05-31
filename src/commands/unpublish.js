/**
 * Unpublish a QuantCDN url.
 *
 * @usage
 *   quant unpublish -u /path/to/upublish
 */

const logger = require('../service/logger')();
const client = require('../quant-client');
const config = require('../config');

module.exports = function(argv) {
  const url = argv.url;

  // @TODO: Accept argv.dir.
  config.load();

  logger.title('Unpublish');


  if (!url) {
    return logger.fatal('Missing parameter [url].');
  }

  client(config)
      .unpublish(url)
      .then((response) => logger.success(`Unpublished ${url}`))
      .catch((err) => logger.error(err.message));
};
