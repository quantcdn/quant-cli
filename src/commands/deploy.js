
const chalk = require('chalk');
const config = require('../config');
const client = require('../quant-client');
const getFiles = require('../helper/getFiles');
const path = require('path');

/**
 * Deploy a directory to a configured quant account.
 *
 * @param {object} argv
 *   The CLI arguments.
 */
module.exports = async function(argv) {
  console.log(chalk.bold.green('*** Quant deploy ***'));
  let files;
  let data;

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
    const method = filepath.endsWith('index.html') ? 'markup' : 'file';

    try {
      await quant[method](files[file]);
    } catch (err) {
      console.log(chalk.yellow(err.message + ` (${filepath})`));
      continue;
    }
    console.log(chalk.bold.green('✅') + ` ${filepath}`);
  }

  try {
    data = await quant.meta();
  } catch (err) {
    console.log(chalk.yellow(err.message));
  }

  const relativeFiles = files.map((item) => `/${path.relative(p, item)}`);

  for (const key in data.meta) {
    if (!data.meta[key].published || relativeFiles.includes(key)) {
      continue;
    }

    // Check the non-index.html meta.
    const bare = key.replace('/index.html', '');

    // @TODO: Quant API unpublishes the bare route but the
    // global meta doesn't update the index.html file so if we
    // don't do this it will attempt to unpublish paths every
    // time. We can't unpublish /path/to/index.html either
    // as this is invalid within the API.
    if (typeof data.meta[bare] == 'undefined' || !data.meta[bare].published) {
      continue;
    }

    try {
      await quant.unpublish(key);
    } catch (err) {
      console.log(chalk.yellow(err.message + ` (${key})`));
      continue;
    }
    console.log(chalk.bold.green('✅') + ` ${key} unpublished.`);
  }
  /* eslint-enable guard-for-in */
};
