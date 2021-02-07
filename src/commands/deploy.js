/**
 * Deploy the configured build directory to QuantCDN.
 *
 * @usage
 *  quant deploy <dir>
 */
const chalk = require('chalk');
const config = require('../config');
const client = require('../quant-client');
const getFiles = require('../helper/getFiles');
const path = require('path');

const command = {};

command.command = 'deploy [dir]';
command.describe = 'Deploy the output of a static generator';
command.builder = (yargs) => {
  yargs.positional('dir', {
    describe: 'Optional location of build artefacts ',
    type: 'string',
    default: null,
  });
};

command.handler = async function(argv) {
  let files;
  let data;

  console.log(chalk.bold.green('*** Quant deploy ***'));

  // Make sure configuration is loaded.
  if (!config.fromArgs(argv)) {
    return console.error(chalk.yellow('Quant is not configured, run init.'));
  }

  const dir = argv.dir || config.get('dir');

  const p = path.resolve(process.cwd(), dir);
  const quant = client(config);

  try {
    files = await getFiles(p);
  } catch (err) {
    return console.log(err);
  }

  /* eslint-disable guard-for-in */
  for (const file in files) {
    const filepath = path.relative(p, files[file]);

    try {
      await quant.send(files[file]);
    } catch (err) {
      console.log(chalk.yellow(err.message + ` (${filepath})`));
      continue;
    }

    console.log(chalk.bold.green('✅') + ` ${filepath}`);
  }

  try {
    data = await quant.meta(true);
  } catch (err) {
    console.log(chalk.yellow(err.message));
  }

  // Quant meta returns relative paths, so we map our local filesystem
  // to relative URL paths so that we can do a simple [].includes to
  // determine if we need to unpublish the URL.
  const relativeFiles = files.map((item) => `/${path.relative(p, item)}`);

  if (!data || ! 'records' in data) {
    // The API doesn't return meta data if nothing has previously been
    // pushed for the project.
    return;
  }

  data.records.map(async (item) => {
    if (relativeFiles.includes(item)) {
      return;
    }
    try {
      await quant.unpublish(item);
    } catch (err) {
      return console.log(chalk.yellow(err.message + ` (${item})`));
    }
    console.log(chalk.bold.green('✅') + ` ${item} unpublished.`);
  });

  /* eslint-enable guard-for-in */
};

module.exports = command;
