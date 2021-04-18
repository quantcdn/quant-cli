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
const getFiles = require('../helper/getFiles');
const path = require('path');
const md5File = require('md5-file');

const command = {};

command.command = 'scan';
command.describe = 'Validate file checksums';

command.handler = async function(argv) {
  config.fromArgs(argv);
  const quant = client(config);

  // Determine local file path.
  const dir = argv.dir || config.get('dir');
  const p = path.resolve(process.cwd(), dir);

  console.log(chalk.bold.green('*** Quant scan ***'));

  try {
    data = await quant.meta(true);
  } catch (err) {
    console.log('Something is not right.');
    yargs.exit(1);
  }

  try {
    files = await getFiles(p);
  } catch (err) {
    console.log(chalk.red(err.message));
    yargs.exit(1);
  }

  files.map(async (file) => {
    const filepath = path.relative(p, file);
    let revision = false;

    try {
      revision = await quant.revisions(filepath);
    } catch (err) {}

    if (!revision) {
      console.log(`[info]: Unable to find ${filepath} in source.`);
      return;
    }

    const localmd5 = md5File.sync(file);

    if (revision.md5 == localmd5) {
      console.log(chalk.green(`[info]: ${filepath} is up-to-date`));
    } else {
      console.log(chalk.yellow(`[info]: ${filepath} is different.`));
    }
  });
};

module.exports = command;
