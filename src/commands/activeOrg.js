/**
 * Update the quant configuration for an active org.
 */

const io = require('../io');
const config = require('../config');
const yargs = require('yargs');
const inquirer = require('inquirer');
const client = require('../quant-client');

const command = {};

command.command = 'active:organization';
command.describe = 'Change the active organization';
command.builder = () => {};

command.handler = async (argv) => {
  // Make sure configuration is loaded.
  if (!config.fromArgs(argv)) {
    io.login();
    yargs.exit(1);
  }

  const quant = client(config);
  let orgs;
  let org;

  io.title('Active org');

  try {
    const res = await quant.organizations();
    orgs = res.data.organisations.map((i) => i.machine_name);
  } catch (err) {
    io.critical('Unable to fetch organizations, please login.');
    yargs.exit(1);
  }

  if (orgs.includes(argv.org)) {
    org = argv.org;
  } else if (orgs.length == 1) {
    org = orgs[0];
  } else {
    const askOrg = await inquirer.prompt({
      type: 'list',
      choices: org,
      message: 'Select an organization to use',
      name: 'org',
    });
    org = askOrg.org;
  }

  config.set({activeOrg: org});
  config.save();
  io.success(`Set the active org to [${org}]`);
};

module.exports = command;
