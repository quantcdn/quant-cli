const chalk = require('chalk');
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

  console.log(chalk.bold.green('*** Quant proxy ***'));

  client(config).proxy(url, dest, status, user, pass)
    .then((body) => console.log(chalk.green('Success: ') + ` Added proxy for ${url} to ${dest}`)) // eslint-disable-line
      .catch((err) => console.log(chalk.red.bold('Error:') + ` ${err}`));
};
