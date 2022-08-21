/**
 * Delete content from the Quant API.
 *
 * @usage
 *   quant delete <url>
 */

const config = require('../config');
const client = require('../quant-client');
const yargs = require('yargs');
const io = require('../io');
const inquirer = require('inquirer');

const command = {};

command.command = 'delete <path> [force]';
command.describe = 'Delete a deployed path from Quant';
command.builder = (yargs) => {
  yargs.positional('path', {
    describe: 'Deployed asset path to remove',
    type: 'string',
  });
  yargs.option('force', {
    alias: 'f',
    type: 'boolean',
    description: 'Delete the asset without interaction.',
  });
};

command.handler = async (argv) => {
  const path = argv.path;

  // Make sure configuration is loaded.
  if (!config.fromArgs(argv)) {
    io.login();
    yargs.exit(1);
  }

  io.title('delete');

  if (!argv.force) {
    const accept = await inquirer.prompt({
      type: 'confirm',
      name: 'delete',
      default: false,
      message: 'This will delete all revisions of an asset from QuantCDN',
    });

    if (!accept.delete) {
      io.skip(`delete skipped for (${path})`);
      yargs.exit(0);
    }
  }

  const quant = client(config);

  try {
    await quant.delete(path);
  } catch (err) {
    io.critical(`Cannot delete path (${path})\n` + err.message);
    yargs.exit(1);
  }

  io.success(`Successfully removed [${path}]`);
};

module.exports = command;
