/**
 * Upload a single file.
 */

const upload = require('../upload-file');
const chalk = require('chalk');
const fs = require('fs');
const path = require("path");
const util = require('util');

module.exports = function(argv) {
  const filepath = argv.filepath;
  const location = argv.location;

  console.log(chalk.bold.green("*** Quant file ***"));

  if (!fs.existsSync(filepath)) {
    return console.error(chalk.red.bold(`QuantAPI: ${filepath} is not found.`));
  }

  const p = path.resolve(filepath);

  upload(p, location)
    .then(response => console.log)
    .catch(err => {
      msg = util.format(chalk.yellow('File [%s] exists at locationi (%s)'), filepath, location);
      console.log(msg);
    });
};
