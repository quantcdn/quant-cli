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

const logger = require('../service/logger');
const config = require('../config');
const client = require('../quant-client');

module.exports = async function(argv) {
  const filepath = argv.filepath;
  const location = argv.location;

  // @TODO: Support passing config directory.
  config.load();

  logger.title('File');

  try {
    await client(config).file(filepath, location);
  } catch(err) {
    logger.error(`File [${filepath}] exists at location (${location})`);
    return 1;
  }

  logger.success(`Added (${filepath})`);
};
