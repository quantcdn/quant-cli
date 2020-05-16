/**
 * Prepare the QuantCDN configuration file.
 *
 * This uses a wizard or allows you to pass in with options.
 *
 * @TODO: allow partial options/wizard.
 *
 * @usage
 *   quant init
 *   quant init -t <token> -c <client> -e <url> -d <build dir>
 */

const chalk = require('chalk');
const prompt = require('prompt');

const config = require('../config');
const client = require('../quant-client');

module.exports = function(argv) {
  const token = argv.token;
  const clientid = argv.clientid;
  const endpoint = argv.endpoint;
  const project = argv.project;
  const dir = argv.dir;

  console.log(chalk.bold.green('*** Initialise Quant ***'));

  if (!token || !clientid || !project) {
    const schema = {
      properties: {
        endpoint: {
          required: true,
          description: 'Enter QuantCDN endpoint',
          default: 'https://api.quantcdn.io',
        },
        clientid: {
          pattern: /^[a-zA-Z0-9\-]+$/,
          message: 'Client id must be only letters, numbers or dashes',
          required: true,
          description: 'Enter QuantCDN client id',
        },
        project: {
          pattern: /^[a-zA-Z0-9\-]+$/,
          message: 'Project must be only letters, numbers or dashes',
          required: true,
          description: 'Enter QuantCDN project',
        },
        token: {
          hidden: true,
          replace: '*',
          required: true,
          description: 'Enter QuantCDN token',
        },
        dir: {
          required: true,
          description: 'Directory containing static assets',
          default: 'build',
        },
      },
    };
    prompt.start();
    prompt.get(schema, function(err, result) {
      config.set(result);
      config.save();
      client(config).ping(config)
          .then((message) => console.log(chalk.bold.green(`✅✅✅ Successfully connected to ${message}`))) // eslint-disable-line max-len
          .catch((message) => console.log(chalk.bold.red(`Unable to connect to quant ${message}`))); // eslint-disable-line max-len
    });
  } else {
    config.set({clientid, project, token, endpoint, dir});
    config.save();
    client(config).ping(config)
        .then((message) => console.log(chalk.bold.green(`✅✅✅ Successfully connected to ${message}`))) // eslint-disable-line max-len
        .catch((message) => console.log(chalk.bold.red(`Unable to connect to quant ${message}`))); // eslint-disable-line max-len
  }
};
