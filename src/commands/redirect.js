/**
 * Redirect a QuantCDN path to another.
 *
 * @usage
 *   quant redirect -f /path/from -t /path/to
 *   quant redirect -f /path/from -t /path/to -s false
 */

const chalk = require('chalk');
const config = require('../config');
const client = require('../quant-client');

module.exports = function(argv) {
  console.log(chalk.bold.green('*** Quant redirect ***'));

  const status = argv.status || 302;
  const author = argv.author || null;
  const from = argv.from;
  const to = argv.to;

  // @TODO: Accept argv.dir.
  config.load();

  client(config).proxy(from, to, author, status)
    .then((body) => console.log(chalk.green('Success: ') + ` Added redirect ${from} to ${to}`)) // eslint-disable-line
      .catch((err) => console.log(chalk.red.bold('Error:') + ` ${err}`));
};

