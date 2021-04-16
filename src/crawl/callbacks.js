/**
 * Determine if a path needs ot be
 */
const chalk = require('chalk');

module.exports = {
  redirectHandler: async (quant, queueItem, redirectQueueItem) => {
    let path = queueItem.path;

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
        await quant.redirect(queueItem.path, path, 'quant-cli', queueItem.stateData.code || 301);
      } catch (err) {}
    } else {
      const destination = queueItem.host == redirectQueueItem.host ? redirectQueueItem.path : redirectQueueItem.url;
      console.log(chalk.bold.green('✅ REDIRECT:') + ` ${path} => ${destination}`);
      try {
        await quant.redirect(path, destination, 'quant-cli', redirectQueueItem.stateData.code || 301);
      } catch (err) {}
    }
  },
};
