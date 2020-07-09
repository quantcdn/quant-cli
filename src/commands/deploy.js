/**
 * Deploy the configured build directory to QuantCDN.
 *
 * @usage
 *  quant deploy
 *  quant deploy -d /path/to/dir
 */

const chalk = require('chalk');
const config = require('../config');
const client = require('../quant-client');
const getFiles = require('../helper/getFiles');
const path = require('path');

module.exports = async function(argv) {
  let files;
  let data;

  console.log(chalk.bold.green('*** Quant deploy ***'));

  // Make sure configuration is loaded.
  config.load();
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

  const relativeFiles = files.map((item) => `/${path.relative(p, item)}`);

  data.records.map(async (item) => {
    if (relativeFiles.includes(item)) {
      // If the URL from quant matches an expected location on disk
      // we assume that this record is still required.
      return;
    }

    try {
      await quant.unpublish(item);
    } catch (err) {
      console.log(chalk.yellow(err.message + ` (${item})`));
    }
    console.log(chalk.bold.green('✅') + ` ${item} unpublished.`);
  });

  /* eslint-enable guard-for-in */
};
