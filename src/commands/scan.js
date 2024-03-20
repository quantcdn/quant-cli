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
command.describe = 'Validate local file checksums';
command.builder = (yargs) => {
  yargs.options('diff-only', {
    describe: 'Show only source files different from Quant',
    type: 'boolean',
    default: false,
  });
  yargs.options('unpublish-only', {
    describe: 'Show only the unpublished results',
    type: 'boolean',
    default: false,
  });
  yargs.options('skip-unpublish-regex', {
    describe: 'Skip the unpublish process for specific regex',
    type: 'string',
  });
};

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

  const relativeFiles = [];

  files.map(async (file) => {
    const filepath = path.relative(p, file);
    let revision = false;
    relativeFiles.push(`/${filepath.toLowerCase()}`);

    if (argv['unpublish-only']) {
      return;
    }

    try {
      revision = await quant.revision(filepath);
    } catch (err) {}

    if (!revision) {
      console.log(`[info]: Unable to find ${filepath} in source.`);
      return;
    }

    const localmd5 = md5File.sync(file);

    if (revision.md5 == localmd5) {
      if (!argv['diff-only']) {
        console.log(chalk.green(`[info]: ${filepath} is up-to-date`));
      }
    } else {
      if (argv['diff-only']) {
        console.log(chalk.yellow(`[info]: ${filepath} is different.`));
      }
    }
  });

  data.records.map(async (item) => {
    const f = item.url.replace('/index.html', '.html');

    if (relativeFiles.includes(item.url) || relativeFiles.includes(f)) {
      return;
    }

    if (item.type && item.type == 'redirect') {
      return;
    }

    // Skip unpublish process if skip unpublish regex matches.
    if (argv['skip-unpublish-regex']) {
      const match = item.url.match(argv['skip-unpublish-regex']);
      if (match) {
        return;
      }
    }
    if (!argv['diff-only']) {
      console.log(chalk.magenta(`[info]: ${item.url} is to be unpublished.`));
    }
  });
};

module.exports = command;
