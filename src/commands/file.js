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

const config = require('../config');
const client = require('../quant-client');
const chalk = require('chalk');
const util = require('util');

module.exports = function(argv) {
  const filepath = argv.filepath;
  const location = argv.location;

  // @TODO: Support dir.
  config.load();

  console.log(chalk.bold.green('*** Quant file ***'));

  client(config).file(filepath, location)
      .then((body) => console.log(chalk.green('Success: ') + ` Added [${filepath}]`)) // eslint-disable-line
      .catch((err) => {
        msg = util.format(chalk.yellow('File [%s] exists at location (%s)'), filepath, location); // eslint-disable-line max-len
        console.log(msg);
      });
};
