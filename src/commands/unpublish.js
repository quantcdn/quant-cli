const chalk = require('chalk');
const client = require('../quant-client');
const config = require('../config');

module.exports = function(argv) {
  console.log(chalk.bold.green('*** Quant unpublish ***'));

  // @TODO: Accept argv.dir.
  config.load();

  const url = argv.url;

  if (!url) {
    return console.log(chalk.red.bold('Error:') + ` Missing parameter [url].`);
  }

  client(config)
      .unpublish(url)
      .then(response => console.log(chalk.green('Success:') + ` Unpublished ${url}`)) // eslint-disable-line
      .catch((err) => console.log(chalk.red.bold('Error:') + ` ${err}`));
};
