/**
 * Manage a resume state.
 */

const chalk = require('chalk');
const fs = require('fs');
const {tmpdir} = require('os');

/**
 * Write the resume state.
 *
 * @param {simplecrawler} crawl
 *   A crawler instance.
 * @param {string} resumeFile
 *   The name of the resume file.
 */
const write = async (crawl, resumeFile = `${tmpdir()}/quant-resume`) => {
  console.log(chalk.bold.blue('Stopping crawl...'));
  crawl.stop();
  console.log(chalk.bold.blue('Writing resume state to disk...'));

  if (fs.existsSync(resumeFile)) {
    // Clean up the resume file.
    fs.unlinkSync(resumeFile);
  }

  const file = fs.createWriteStream(resumeFile, {flags: 'a'});
  file.write('['); // Add JSON array opener.

  crawl.queue.forEach((item, idx, arr) => {
    item.status = item.fetched !== true ? 'queued' : item.status;
    join = idx !== arr.length - 1 ? ',' : '\n';
    file.write(`${JSON.stringify(item, null, 2)}${join}`);
  });

  file.write(']');
  file.end();

  console.log(chalk.bold.green('✅ DONE: Wrote resume state to ' + resumeFile));
};

/**
 * Attempt to read the resume state.
 *
 * @param {simplecrawler} crawl
 *   A crawler instance.
 * @param {string} resumeFile
 *   The name of the resume file.
 *
 * @return {simplecrawler}
 *   The crawler instance.
 *
 * @throws Error
 */
const read = async (crawl, resumeFile = `${tmpdir()}/quant-resume`) => {
  if (fs.existsSync(resumeFile)) {
    await crawl.queue.defrost(resumeFile, () => {});
    console.log(chalk.bold.green('✅ DONE: Loaded resume state from ' + resumeFile)); // eslint-disable-line max-len
  }
  return crawl;
};

module.exports = {
  write,
  read,
  default: {
    read,
    write,
  },
};
