const chalk = require('chalk');
const client = require('../quant-client');
const config = require('../config');

module.exports = function(argv) {
  console.log(chalk.bold.green('*** Quant transition ***'));

  // @TODO: Accept argv.dir.
  config.load();

  const file = argv.file;
  const location = argv.location || false;
  const published = argv.status == 'true';

  client(config)
      .markup(file, location, published)
    .then(response => console.log(chalk.green('Success:') + ` changed the status of ${file}`)) // eslint-disable-line
      .catch((err) => console.log(chalk.red.bold('Error:') + ` ${err}`));
};
