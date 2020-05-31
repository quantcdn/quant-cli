/**
 * Deploy a single index.html file to QuantCDN.
 *
 * This allows an optional paramter to define where the asset
 * will be accessible by QuantCDN.
 *
 * @usage
 *   quant page -f /path/to/index.html
 *   quant page -f /path/to/index.html-l /path/in/quant
 */

const config = require('../config');
const client = require('../quant-client');
const logger = require('../service/logger')();

module.exports = function(argv) {
  const filepath = argv.filepath;
  const location = argv.location;

  logger.title('Page');

  // @TODO: add dir support.
  config.load();

  client(config).markup(filepath, location)
      .then((body) => logger.success(`Added (${filepath})`))
      .catch((err) => logger.fatal(err.message));
};
