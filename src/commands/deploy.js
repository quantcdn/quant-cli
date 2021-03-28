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
const yargs = require('yargs');
const md5File = require('md5-file');

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
  let metadata;

  console.log(chalk.bold.green('*** Quant deploy ***'));

  // Make sure configuration is loaded.
  if (!config.fromArgs(argv)) {
    console.log(chalk.yellow('Quant is not configured, run init.'));
    yargs.exit(1);
  }

  const dir = argv.dir || config.get('dir');

  const p = path.resolve(process.cwd(), dir);
  const quant = client(config);

  try {
    await quant.ping();
  } catch (err) {
    console.log(chalk.red(err.message));
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

    if (revision) {
      const md5 = md5File.sync(file);
      if (filepath == 'test-cli/index.html') {
        console.log(`rev: ${revision.md5}`);
        console.log(`local: ${md5}`);
      }
      if (md5 == revision.md5) {
        console.log(chalk.blue(`Published version is up-to-date (${filepath})`));
        return;
      }
    }

    try {
      await quant.send(file, filepath);
    } catch (err) {
      console.log(chalk.yellow(err.message + ` (${filepath})`));
      return;
    }
    console.log(chalk.bold.green('✅') + ` ${filepath}`);
  });

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
    const f = item.url.replace('/index.html', '.html');
    if (relativeFiles.includes(item.url) || relativeFiles.includes(f)) {
      return;
    }
    try {
      await quant.unpublish(item.url);
    } catch (err) {
      return console.log(chalk.yellow(err.message + ` (${item.url})`));
    }
    console.log(chalk.bold.green('✅') + ` ${item.url} unpublished.`);
  });

  /* eslint-enable guard-for-in */
};

module.exports = command;
