/**
 * Delete content from the Quant API.
 *
 * @usage
 *   quant delete <url>
 */

const chalk = require('chalk');
const config = require('../config');
const client = require('../quant-client');
const yargs = require('yargs');
const prompt = require('prompt');

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

  console.log(chalk.bold.green('*** Quant delete ***'));

  if (!config.fromArgs(argv)) {
    console.log(chalk.yellow('Quant is not configured, run init.'));
    yargs.exit(1);
  }

  if (!argv.force) {
    prompt.start();
    const schema = {
      properties: {
        force: {
          required: true,
          description: 'This will delete all revisions of an asset from QuantCDN',
          pattern: /(y|yes|n|no)/,
          default: 'no',
          message: 'Only yes or no is allowed.',
        },
      },
    };

    const {force} = await prompt.get(schema);
    if (!force) {
      console.log(chalk.yellow('[skip]:') + ` delete skipped for (${path})`);
      yargs.exit(0);
    }
  }

  const quant = client(config);

  try {
    await quant.delete(path);
  } catch (err) {
    console.log(chalk.red('[error]:') + ` Cannot delete path (${path})\n` + err.message);
    yargs.exit(1);
  }

  console.log(chalk.green(`Successfully removed [${path}]`));
};

module.exports = command;
