const request = require('request');
const chalk = require('chalk');
const config = require('../config');
const {promisify} = require('util');
const {resolve} = require('path');
const fs = require('fs');
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

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
            fs.readFile(files[file], {encoding: 'utf-8'}, (err, data) => {
              if (err) throw err;

              const payload = {
                url: `/${filepath}`,
                content: data,
                published: true,
              };

              const options = {
                url: config.get('endpoint'),
                method: 'POST',
                body: JSON.stringify(payload),
                headers: {
                  'Content-Type': 'application/json',
                  'Quant-Customer': config.get('clientid'),
                  'Quant-Token': config.get('token'),
                },
              };
              try {
                request(options, (err, res, body) => {
                  body = JSON.parse(body);
                  if (body.error) {
                    return console.error(
                        chalk.yellow(body.errorMsg + ` (${filepath})`),
                    ); // eslint-disable-line max-len
                  }
                  console.log(chalk.bold.green('✅') + ` ${filepath}`);
                });
              } catch (err) {
                console.log(
                    chalk.bold.red(
                        `Error: Unable to upload ${filepath}.`,
                    ),
                ); // eslint-disable-line max-len
              }
            });
          } else {
            const formData = {
              data: fs.createReadStream(files[file]),
            };

            const options = {
              url: config.get('endpoint'),
              method: 'POST',
              headers: {
                'Content-Type': 'multipart/form-data',
                'User-Agent': 'Quant (+http://quantcdn.io)',
                'Quant-File-Url': `/${filepath}`,
                'Quant-Token': config.get('token'),
                'Quant-Customer': config.get('clientid'),
              },
              formData,
            };

            console.log(options);

            try {
              request(options, function(err, response, body) {
                body = JSON.parse(body);
                if (body.error) {
                  return console.error(
                      chalk.yellow(body.errorMsg + ` (${filepath})`),
                  ); // eslint-disable-line max-len
                }
                console.log(chalk.bold.green('✅') + ` ${filepath}`); // eslint-disable-line max-len
              });
            } catch (err) {
              console.log(chalk.bold.red(`Error: Unable to upload ${filepath}.`)); // eslint-disable-line max-len
            }
          }
        }
      /* eslint-enable guard-for-in */
      })
      .catch((e) => console.error(e));
};
