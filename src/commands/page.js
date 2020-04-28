/**
 * Send a single index file to Quant.
 */

const fs = require('fs');
const path = require('path');
const config = require('../config');
const chalk = require('chalk');
const request = require('request');

module.exports = function(argv) {
  const filepath = argv.filepath;
  let content;

  console.log(chalk.bold.green("*** Quant page ***"));

  config.load();

  if (!fs.existsSync(filepath)) {
    return console.error(chalk.red.bold(`QuantAPI: ${filepath} is not found.`));
  }

  const p = path.resolve(filepath);

  if (!p.endsWith('index.html')) {
    // @TODO - possible move the contents of a file to index.html
    return console.error(chalk.red.bold(`QuantCLI: Quant only supports index.html files`)); // eslint-disable-line max-len
  }

  try {
    content = fs.readFileSync(p, { encoding: "utf-8" });
  } catch (err) {
    return console.error(chalk.red.bold(`QuantAPI: ${err.message}`));
  }

  let quantPath = filepath;

  if (argv.location) {
    quantPath = `${argv.location}/index.html`;
  }

  const payload = {
    url: `/${quantPath}`,
    published: true,
    content,
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
        return console.error(chalk.yellow(body.errorMsg + ` (${filepath})`)); // eslint-disable-line max-len
      }
      console.log(chalk.bold.green('✅') + ` ${quantPath}`);
    });
  } catch (err) {
    console.log(err);
    console.log(chalk.bold.red(`Error: Unable to upload ${filepath}.`)); // eslint-disable-line max-len
  }
};
