/**
 * Update the quant configuration for an active org.
 */

const io = require('../io');
const config = require('../config');
const yargs = require('yargs');
const inquirer = require('inquirer');
const client = require('../quant-client');

const command = {};

command.command = 'active:project';
command.describe = 'Change the active project';
command.builder = (yargs) => {
  yargs.options('project', {
    alias: 'p',
    describe: 'A project machine name',
    type: 'string',
  });
  return yargs;
};

command.handler = async (argv) => {
  // Make sure configuration is loaded.
  if (!config.fromArgs(argv)) {
    io.login();
    yargs.exit(1);
  }

  const quant = client(config);
  let projects;
  let project;

  io.title('Active project');
  try {
    const res = await quant.projects();
    projects = res.data.projects.map((i) => i.machine_name);
  } catch (err) {
    io.warn(`Unable to fetch projects, please log in again.`);
    yargs.exit(1);
  }

  if (projects.length == 0) {
    io.info('There are no projects available for this organization.');
    return;
  }

  if (projects.includes(argv.project)) {
    project = argv.project;
  } else if (projects.length == 1) {
    project = projects[0];
  } else {
    console.log(projects);
    const ask = await inquirer.prompt({
      type: 'list',
      choices: projects,
      message: 'Select a project to use',
      name: 'project',
    });
    project = ask.project;
  }

  config.set({activeProject: project});
  config.save();
  io.success(`Set the active project to [${project}]`);
};

module.exports = command;
