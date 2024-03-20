/**
 * Unpublish a QuantCDN url.
 *
 * @usage
 *   quant publish <path>
 */
const chalk = require('chalk');
const client = require('../quant-client');
const config = require('../config');

const command = {};

command.command = 'publish <path>';
command.describe = 'Publish an asset';
command.builder = (yargs) => {
  yargs.options('revision', {
    describe: 'The revision id to publish',
    alias: 'r',
    type: 'string',
    default: 'latest',
  });
};

command.handler = function(argv) {
  console.log(chalk.bold.green('*** Quant publish ***'));

  // config.fromArgs(argv);
  if (!config.fromArgs(argv)) {
    return console.error(chalk.yellow('Quant is not configured, run init.'));
  }

  const _client = client(config)

  if (argv.revision == 'latest') {
    _client.revisions(argv.path)
        .then((res) => {
          const revisionIds = Object.keys(res.revisions);
          const latestRevision = Math.max(...revisionIds);
          _client.publish(argv.path, latestRevision)
              .then((res) => console.log(chalk.green('Success:') + ` Published successfully`)) // eslint-disable-line
              .catch((err) => console.log(chalk.red.bold('Error:') + ` ${err}`));
        })
        .catch((err) => console.log(chalk.red.bold('Error:') + ` ${err}`))
  } else {
    _client.publish(argv.path, argv.revision)
        .then((res) => console.log(chalk.green('Success:') + ` Published successfully`)) // eslint-disable-line
        .catch((err) => console.log(chalk.red.bold('Error:') + ` ${err}`));
  }
};

module.exports = command;
