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

const command = {};

command.command = 'init';
command.describe = 'Initialise a project in the current directory';

command.builder = (yargs) => {
  yargs.option('dir', {
    alias: 'd',
    describe: 'Built asset directory',
    type: 'string',
    default: 'build',
  });

  return yargs;
};

command.handler = function(argv) {
  const token = Array.isArray(argv.token) ? argv.token.pop() : argv.token;
  const clientid = Array.isArray(argv.clientid) ? argv.clientid.pop() : argv.clientid;
  const endpoint = Array.isArray(argv.endpoint) ? argv.endpoint.pop() : argv.endpoint;
  const project = Array.isArray(argv.project) ? argv.project.pop() : argv.project;
  const dir = Array.isArray(argv.dir) ? argv.dir.pop() : argv.dir;

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
          pattern: /^[a-zA-Z0-9\-\_]+$/,
          message: 'Client id must be only letters, numbers, underscores or dashes',
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
          description: 'Enter QuantCDN project token',
        },
        bearer: {
          hidden: true,
          replace: '*',
          required: false,
          description: 'Enter an optional QuantCDN API token',
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
          .then((message) => console.log(chalk.bold.green(`✅✅✅ Successfully connected to ${message.project}`)))  
          .catch((message) => console.log(chalk.bold.red(`Unable to connect to quant ${message.project}`)));  
    });
  } else {
    config.set({clientid, project, token, endpoint, dir});
    config.save();
    client(config).ping(config)
        .then((message) => console.log(chalk.bold.green(`✅✅✅ Successfully connected to ${message.project}`)))  
        .catch((message) => console.log(chalk.bold.red(`Unable to connect to quant ${message.project}`)));  
  }
};

module.exports = command;
