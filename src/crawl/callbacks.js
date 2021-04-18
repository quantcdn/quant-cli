/**
 * Determine if a path needs ot be
 */
const chalk = require('chalk');
const {QuantInfo} = require('../quant-client');

module.exports = {
  redirectHandler: async (quant, queueItem, redirectQueueItem) => {
    let path = queueItem.path;

    // Set up redirect metadata.
    const info = new QuantInfo;
    info.attr('author_name', 'quant-cli');

    if (path.substr(-1) === '/' && path.length > 1) {
      // Strip trailing slashes except if only / is present in the path.
      path = path.substr(0, path.length - 1);
    }

    if (queueItem.path == redirectQueueItem.path) {
      return;
    }

    if (path != queueItem.path) {
      console.log(chalk.bold.green('✅ REDIRECT:') + ` ${queueItem.path} => ${path}`);
      try {
        await quant.redirect(queueItem.path, path, queueItem.stateData.code || 301, info);
      } catch (err) {}
    } else {
      const destination = queueItem.host == redirectQueueItem.host ? redirectQueueItem.path : redirectQueueItem.url;
      console.log(chalk.bold.green('✅ REDIRECT:') + ` ${path} => ${destination}`);
      try {
        await quant.redirect(path, destination, redirectQueueItem.stateData.code || 301, info);
      } catch (err) {}
    }
  },
};
