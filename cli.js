#!/usr/bin/env node

const chalk = require('chalk');
const log = console.log;
const yargs = require('yargs');
const prompt = require('prompt');
const fs = require('fs');
const configFile = 'quant.json';
const cliProgress = require('cli-progress');
const _colors = require('colors');
const request = require('request');

const argv = yargs
    .usage('usage: $0 <command>')
    .command('init', 'Initialise QuantCDN in current working directory', {
      token: {
        description: 'Optionally provide token',
        alias: 't',
        type: 'string',
      },
      clientid: {
        description: 'Optionally provide client id',
        alias: 'c',
        type: 'string',
      },
      endpoint: {
        description: 'Optionally provide QuantCDN API endpoint',
        alias: 'e',
        type: 'string',
      },
      dir: {
        description: 'Optionally provide static asset directory',
        alias: 'd',
        type: 'string',
      },
    })
    .command('deploy', 'Deploy a static folder to QuantCDN', {
      dir: {
        description: 'Directory containing static assets',
        alias: 'd',
        type: 'string',
      },
    })
    .command('info', 'Give info based on current folder')
    .help()
    .alias('help', 'h')
    .argv;


if (argv._.includes('info')) {
  log(chalk.bold.green('*** Quant info ***'));

  const fs = require('fs');

  fs.readFile(configFile, (err, data) => {
    if (err) throw err;
    const config = JSON.parse(data);
    log(config);

    // Attept connection to API.
    ping(config);
  });
}


if (argv._.includes('deploy')) {
  log(chalk.bold.green('*** Quant deploy ***'));

  const fs = require('fs');

  fs.readFile(configFile, (err, data) => {
    if (err) throw err;
    const config = JSON.parse(data);

    const {promisify} = require('util');
    const {resolve} = require('path');
    const fs = require('fs');
    const readdir = promisify(fs.readdir);
    const stat = promisify(fs.stat);
    const dir = argv.dir || config.dir;

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
      const files = await Promise.all(subdirs.map(async (subdir) => {
        const res = resolve(dir, subdir);
        return (await stat(res)).isDirectory() ? getFiles(res) : res;
      }));
      return files.reduce((a, f) => a.concat(f), []);
    }

    const path = require('path');
    const p = path.resolve(process.cwd(), dir);

    getFiles(p)
        .then((files) => {
          // create new progress bar
          const b1 = new cliProgress.SingleBar({
            format: 'Progress |' + _colors.green('{bar}') + '| {percentage}% || {value}/{total} assets || Speed: {speed}', // eslint-disable-line max-len
            barCompleteChar: '\u2588',
            barIncompleteChar: '\u2591',
            hideCursor: true,
          });

          b1.start(files.length, 0, {
            speed: 'N/A',
          });

          /* eslint-disable guard-for-in */
          for (file in files) {
            const filepath = path.relative(p, files[file]);

            // Treat index.html files as route.
            if (filepath.endsWith('index.html')) {
              fs.readFile(files[file], {encoding: 'utf-8'}, (err, data) => {
                if (err) throw err;

                const payload = {
                  'url': '/'+filepath,
                  'content': data,
                  'published': true,
                };

                const options = {
                  url: config.endpoint,
                  method: 'POST',
                  body: JSON.stringify(payload),
                  headers: {
                    'Content-Type': 'application/json',
                    'Quant-Customer': config.clientid,
                    'Quant-Token': config.token,
                  },
                };

                request(options, (err, res, body) => {
                  body = JSON.parse(body);
                  if (body.error) {
                    return console.error(chalk.yellow(body.errorMsg));
                  }
                  console.log(chalk.bold.green('✅') + ` ${files[file]}`);
                });
              });
            } else {
              const formData = {
                data: fs.createReadStream(files[file]),
              };

              const options = {
                url: config.endpoint,
                method: 'POST',
                headers: {
                  'Content-Type': 'multipart/form-data',
                  'User-Agent': 'Quant (+http://quantcdn.io)',
                  'Quant-File-Url': `/${filepath}`,
                  'Quant-Token': config.token,
                  'Quant-Customer': config.clientid,
                },
                formData,
              };

              request(options, function(err, response, body) {
                body = JSON.parse(body);
                if (body.error) {
                  return console.error(chalk.yellow(body.errorMsg));
                }
                console.log(chalk.bold.green('✅') + ` ${files[file]}`);
              });
            }

            b1.increment();
          }
          /* eslint-enable guard-for-in */

          b1.stop();
        })
        .catch((e) => console.error(e));
  });
}

if (argv._.includes('init')) {
  const token = argv.token;
  const clientid = argv.clientid;
  const endpoint = argv.endpoint;
  const dir = argv.dir;

  log(chalk.bold.green('*** Initialise Quant ***'));

  if (!token || !clientid) {
    const schema = {
      properties: {
        endpoint: {
          required: true,
          description: 'Enter QuantCDN endpoint',
          default: 'https://api.quantcdn.io',
        },
        clientid: {
          pattern: /^[a-zA-Z0-9\-]+$/,
          message: 'Client id must be only letters, numbers or dashes',
          required: true,
          description: 'Enter QuantCDN client id',
        },
        token: {
          hidden: true,
          replace: '*',
          required: true,
          description: 'Enter QuantCDN token',
        },
        dir: {
          required: true,
          description: 'Directory containing static assets',
          default: 'build',
        },
      },
    };
    prompt.start();
    prompt.get(schema, function(err, result) {
      init(result.clientid, result.token, result.endpoint, result.dir);
    });
  } else {
    init(clientid, token, endpoint, dir);
  }
}

/**
 * Create a quant configuration file and test the connection.
 *
 * @param {string} clientid
 *   The client ID.
 * @param {string} token
 *   The client token.
 * @param {string} endpoint
 *   The Quant upload API endpoint.
 * @param {string} dir
 *   The source directory.
 */
function init(clientid, token, endpoint, dir) {
  endpoint = endpoint || 'https://api.quantcdn.io';
  dir = dir || 'build';

  const config = {
    clientid: clientid,
    token: token,
    endpoint: endpoint,
    dir: dir,
  };

  const data = JSON.stringify(config, null, 2);

  // @todo: Read existing config/update
  fs.writeFile(configFile, data, (err) => {
    if (err) throw err;
    console.log('Wrote quant.json config');
  });

  // Test API connectivity
  ping(config);
}

/**
 * Test the API connection.
 *
 * @param {object} config
 *   The quant configuration object.
 */
function ping(config) {
  const options = {
    url: `${config.endpoint}/ping`,
    headers: {
      'Content-Type': 'application/json',
      'Quant-Customer': config.clientid,
      'Quant-Token': config.token,
    },
  };

  request(options, (err, res, body) => {
    body = JSON.parse(body);
    if (body.error) {
      // @TODO: Catch specific API errors.
      return log(chalk.bold.red('Unable to connect to API'));
    }
    log(chalk.bold.green(`✅✅✅ Successfully connected to API using project: ${body.project}`)); // eslint-disable-line max-len
  });
}

