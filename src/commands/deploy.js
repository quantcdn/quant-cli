
const chalk = require('chalk');
const config = require('../config');
const client = require('../quant-client');

const fs = require('fs');
const {promisify} = require('util');
const {resolve} = require('path');
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

/**
 * Deploy a directory to a configured quant account.
 *
 * @param {object} argv
 *   The CLI arguments.
 */
module.exports = function(argv) {
  console.log(chalk.bold.green('*** Quant deploy ***'));

  // Make sure configuration is loaded.
  config.load();
  const dir = argv.dir || config.get('dir');

  /**
   * Get files from a directory.
   *
   * @param {string} dir
   *   The directory from which to get files.
   *
   * @return {array}
   *   An array of files.
   */
  async function getFiles(dir) {
    const subdirs = await readdir(dir);
    const files = await Promise.all(
        subdirs.map(async (subdir) => {
          const res = resolve(dir, subdir);
          return (await stat(res)).isDirectory() ? getFiles(res) : res;
        }),
    );
    return files.reduce((a, f) => a.concat(f), []);
  }

  const path = require('path');
  const p = path.resolve(process.cwd(), dir);

  getFiles(p)
      .then((files) => {
      /* eslint-disable guard-for-in */
        for (file in files) {
          const filepath = path.relative(p, files[file]);
          // Treat index.html files as route.
          if (filepath.endsWith('index.html')) {
            client(config)
                .markup(files[file])
                .then((data) => {
                  console.log(chalk.bold.green('✅') + ` ${filepath}`);
                })
                .catch((err) => {
                  console.error(
                      chalk.yellow(err.message + ` (${filepath})`),
                  );
                });
          } else {
            client(config)
                .file(files[file])
                .then((data) => {
                  console.log(chalk.bold.green('✅') + ` ${filepath}`);
                })
                .catch((err) => {
                  console.error(chalk.yellow(err.message + ` (${filepath})`));
                });
          }
        }
      /* eslint-enable guard-for-in */
      })
      .catch((e) => console.error(e));
};
