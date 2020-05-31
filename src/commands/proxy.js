/**
 * Proxy a route in QuantCDN to an origin.
 *
 * @usage
 *   quant proxy -p /path -o http://origin-domain.com
 */

const logger = require('../service/logger')();
const config = require('../config');
const client = require('../quant-client');

module.exports = function(argv) {
  const url = argv.path;
  const dest = argv.origin;
  const status = argv.status || true;
  const user = argv.basicAuthUser;
  const pass = argv.basicAuthPass;

  // @TODO: Accept argv.dir.
  config.load();

  logger.title('Proxy');

  client(config).proxy(url, dest, status, user, pass)
      .then((body) => logger.success(`Added proxy for ${url} to ${dest}`))
      .catch((err) => logger.fatal(` ${err}`));
};
