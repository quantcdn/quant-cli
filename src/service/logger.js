/**
 * Standardise log output for the quant CLI tool.
 */

const chalk = require('chalk');
const Table = require('cli-table');

/**
 * Print a title.
 *
 * @param {string} string
 *   The title text.
 */
function title(string) {
  string = chalk.bold.green(`*** Quant ${string} ***`);
  console.log(string);
  console.log(chalk.bold.green('-'.repeat(string.length)));
}
/**
 * Print info to the console.
 *
 * @param {string} string
 *   The info string.
 */
function info(string) {
  string = chalk.yellow(string);
  console.log(string);
}

/**
 * Log information.
 *
 * @param {string} string
 *   The string to log.
 */
function log(string) {
  console.log(chalk(string));
}

/**
 * Print a success message.
 *
 * @param {string} string
 *   The success string.
 */
function success(string) {
  string = chalk.bold.green(`✅ ${string}`);
  console.log(string);
}

/**
 * Print a table to the console.
 *
 * @param {array} keys
 *   The keys for the table.
 * @param {array} values
 *   An array of values.
 */
function table(keys, values) {
  const table = new Table();

  /* eslint-disable guard-for-in */
  for (const k in keys) {
    table.push(
        {[keys[k]]: values[k]},
    );
  }
  /* eslint-enable guard-for-in */

  console.log(table.toString());
}

/**
 * Print a warning.
 *
 * @param {string} string
 */
function warn(string) {
  string = chalk.bgYellow.black(string);
  console.log(string);
}

/**
 * Print an error.
 *
 * @param {string} string
 *   The error text.
 */
function error(string) {
  string = chalk.red(string);
  console.error(string);
}

/**
 * Print a fatal error.
 *
 * @param {string} string
 *   The error message.
 */
function fatal(string) {
  string = chalk.bold.white.bgRed(string);
  console.error(string);
}

module.exports = {
  title,
  info,
  log,
  success,
  table,
  warn,
  error,
  fatal,
};
