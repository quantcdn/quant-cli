/**
 * Deploy a single file to QuantCDN.
 *
 * This allows an optional paramter to define where the asset
 * will be accessible by QuantCDN.
 *
 * @usage
 *   quant file -f /path/to/asset.jpg
 *   quant file -f /path/to/asset.jpg -l /path/in/quant
 */

const logger = require('../service/logger')();
const config = require('../config');
const client = require('../quant-client');

module.exports = function(argv) {
  const filepath = argv.filepath;
  const location = argv.location;

  // @TODO: Support dir.
  config.load();

  logger.title('File');

  client(config).file(filepath, location)
      .then((body) => logger.success(`Added (${filepath})`))
      .catch((err) => logger.error(`File [${filepath}] exists at location (${location})`)); // eslint-disable-line
};
