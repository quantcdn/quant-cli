/**
 * Manage a resume state.
 */

import chalk from 'chalk';
import fs from 'fs';
import { homedir } from 'os';

const outputDir = `${homedir()}/.quant`;

/**
 * Write the resume state.
 *
 * @param {simplecrawler} crawl
 *   A crawler instance.
 * @param {string} resumeFile
 *   The name of the resume file.
 */
export function write(crawl, resumeFile = 'quant-resume') {
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
    const join = idx !== arr.length - 1 ? ',' : '\n';
    fs.writeSync(fd, `${JSON.stringify(item, null, 2)}${join}`);
  });
  fs.writeSync(fd, ']');

  console.log(chalk.bold.green('✅ DONE: Wrote resume state to ' + resumeFile));
}

export default {
  write
};
