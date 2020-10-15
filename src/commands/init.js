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
const {prompt} = require('enquirer');

const config = require('../config');
const client = require('../quant-client');

module.exports = async function(argv) {
  const token = Array.isArray(argv.token) ? argv.token.pop() : argv.token;
  const clientid = Array.isArray(argv.clientid) ? argv.clientid.pop() : argv.clientid;
  const endpoint = Array.isArray(argv.endpoint) ? argv.endpoint.pop() : argv.endpoint;
  const project = Array.isArray(argv.project) ? argv.project.pop() : argv.project;
  const dir = Array.isArray(argv.dir) ? argv.dir.pop() : argv.dir;
  const questions = [];
  const conf = {clientid, project, token, endpoint, dir};


  console.log(chalk.bold.green('*** Initialise Quant ***'));

  if (!endpoint) {
    questions.push({
      type: 'input',
      name: 'endpoint',
      message: 'Enter the QuantCDN endpoint you want to connect to',
      initial: 'https://api.quantcdn.io',
    });
  }

  if (!dir) {
    questions.push({
      type: 'input',
      name: 'dir',
      message: 'Enter the directory path where the static assets will be located',
      initial: 'build',
    });
  }

  if (!token) {
    questions.push({
      type: 'input',
      name: 'token',
      message: 'Enter your QuantCDN token',
      validate: (value) => {
        if (value.indexOf(' ') > -1) {
          return 'API tokens cannot have spaces.';
        }
        return true;
      },
    });
  }

  if (!clientid) {
    questions.push({
      type: 'input',
      name: 'clientid',
      message: 'Enter your QuantCDN client id',
    });
  }

  if (!project) {
    questions.push({
      type: 'input',
      name: 'project',
      message: 'Enter your QuantCDN project name',
    });
  }

  if (questions.length > 0) {
    const response = await prompt(questions);
    for (const key in response) {
      conf[key] = response[key];
    }
  }

  config.set(conf);
  config.save();

  client(config).ping(config)
      .then((message) => console.log(chalk.bold.green(`✅✅✅ Successfully connected to ${message.project}`)))
      .catch((message) => console.log(chalk.bold.red(`Unable to connect to quant ${message.project}`)));
};
