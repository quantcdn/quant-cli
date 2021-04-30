/**
 * Manage a resume state.
 */

const chalk = require('chalk');
const fs = require('fs');
const {homedir} = require('os');

const outputDir = `${homedir()}/.quant`;

/**
 * Write the resume state.
 *
 * @param {simplecrawler} crawl
 *   A crawler instance.
 * @param {string} resumeFile
 *   The name of the resume file.
 */
const write = (crawl, resumeFile = `quant-resume`) => {
  console.log(chalk.bold.blue('Stopping crawl...'));
  crawl.stop();
  console.log(chalk.bold.blue('Writing resume state to disk...'));

  resumeFile = `${outputDir}/${resumeFile}`;

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  if (fs.existsSync(resumeFile)) {
    // Clean up the resume file.
    fs.unlinkSync(resumeFile);
  }

  const fd = fs.openSync(resumeFile, 'w');

  fs.writeSync(fd, '[');
  crawl.queue.forEach((item, idx, arr) => {
    item.status = item.fetched !== true ? 'queued' : item.status;
    join = idx !== arr.length - 1 ? ',' : '\n';
    fs.writeSync(fd, `${JSON.stringify(item, null, 2)}${join}`);
  });
  fs.writeSync(fd, ']');

  console.log(chalk.bold.green('✅ DONE: Wrote resume state to ' + resumeFile));
};

module.exports = {
  write,
  default: {
    write,
  },
};
