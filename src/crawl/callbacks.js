/**
 * Determine if a path needs ot be
 */
const chalk = require('chalk');

module.exports = {
  redirectHandler: (quant, queueItem, redirectQueueItem) => {
    let path = queueItem.path;
    // Strip last slash.
    if (path.substr(-1) === '/') {
      path = path.substr(0, path.length - 1);
    }

    if (queueItem.path == redirectQueueItem.path) {
      return;
    }

    if (path != queueItem.path) {
      console.log(chalk.bold.green('✅ REDIRECT:') + ` ${queueItem.path} => ${path}`);
      quant.redirect(queueItem.path, path, 'quant-cli', queueItem.stateData.code || 301);
    } else {
      console.log(chalk.bold.green('✅ REDIRECT:') + ` ${path} => ${redirectQueueItem.url}`);
      quant.redirect(path, redirectQueueItem.url, 'quant-cli', redirectQueueItem.stateData.code || 301);
    }
  },
};
