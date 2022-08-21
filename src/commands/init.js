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
const inquirer = require('inquirer');
const yargs = require('yargs');
const config = require('../config');
const io = require('../io');
const client = require('../quant-client');

const command = {};

command.command = 'init';
command.describe = 'Initialize a project in the current directory';

command.builder = (yargs) => {
  yargs.option('dir', {
    alias: 'd',
    describe: 'Built asset directory',
    type: 'string',
    default: 'build',
  });

  return yargs;
};

command.handler = async function(argv) {
  const endpoint = Array.isArray(argv.endpoint) ? argv.endpoint.pop() : argv.endpoint;
  let token = Array.isArray(argv.token) ? argv.token.pop() : argv.token;
  let organization = Array.isArray(argv.organization) ? argv.organization.pop() : argv.organization;
  let project = Array.isArray(argv.project) ? argv.project.pop() : argv.project;
  let dir = Array.isArray(argv.dir) ? argv.dir.pop() : argv.dir;

  io.title('Initialize project deployment');

  if (argv.clientid) {
    io.dimmed('Client ID option is deprecated please use --organization use --help for more information.');
    organization = argv.clientid;
  } else if (!organization) {
    const clientIdAnswer = await inquirer.prompt({
      name: 'value',
      message: 'Enter the organization name',
    });
    organization = clientIdAnswer.value;
  }

  if (!project) {
    const projectAnswer = await inquirer.prompt({
      name: 'value',
      message: 'Enter the project name',
    });
    project = projectAnswer.value;
  }

  if (!token) {
    const tokenAnswer = await inquirer.prompt({
      type: 'password',
      name: 'value',
      message: 'Enter the project token',
    });
    token = tokenAnswer.value;
  }

  if (!dir) {
    const dirAnswer = await inquirer.prompt({
      name: 'value',
      message: 'Enter the build directory for your project',
    });
    dir = dirAnswer.value;
  }

  const cfg = {
    deploy: {token, project, organization, dir},
  };

  if (endpoint) {
    cfg.endpoint = endpoint;
  }

  config.set(cfg);
  config.save();

  try {
    const res = await client(config).ping();
    io.success(`Successfully connected to ${res.project}`);
  } catch (err) {
    io.critical(err);
  }
};

module.exports = command;
