/**
 * Deploy the configured build directory to QuantCDN.
 *
 * @usage
 *  quant deploy
 *  quant deploy -d /path/to/dir
 */

const logger = require('../service/logger');
const config = require('../config');
const client = require('../quant-client');
const getFiles = require('../helper/getFiles');
const path = require('path');

module.exports = async function(argv) {
  let files;
  let data;

  logger.title('Deploy');

  // Make sure configuration is loaded.
  config.load();
  const dir = argv.dir || config.get('dir');

  const p = path.resolve(process.cwd(), dir);
  const quant = client(config);

  try {
    files = await getFiles(p);
  } catch (err) {
    return logger.fatal(err.message);
  }

  /* eslint-disable guard-for-in */
  for (const file in files) {
    const filepath = path.relative(p, files[file]);
    const method = filepath.endsWith('index.html') ? 'markup' : 'file';

    try {
      await quant[method](files[file]);
    } catch (err) {
      logger.error(`${err.message} ${filepath}`);
      continue;
    }
    logger.success(filepath);
  }

  try {
    data = await quant.meta();
  } catch (err) {
    // If we don't get the meta data back from quant
    // we should return.
    logger.info('Meta data is unavailable, we cannot automatically unpublish data.'); // eslint-disable-line
    return 1001;
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
    if (typeof data.meta[bare] != 'undefined' && !data.meta[bare].published) {
      continue;
    }

    try {
      await quant.unpublish(key);
    } catch (err) {
      logger.error(`${err.message} (${key})`);
      continue;
    }

    logger.success(`${key} unpublished`);
  }
  /* eslint-enable guard-for-in */
};
