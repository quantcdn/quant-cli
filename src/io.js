const chalk = require('chalk');

const io = {
  verbosity: 1,

  status: {
    nil: -1,
    ok: 1,
    skipped: 2,
    error: 3,
  },

  /**
   * Print a success message.
   *
   * @param {string} str
   *   The success message.
   * @param {int} emphasis
   *   The number of check marks.
   */
  success: (str, emphasis = 1) => {
    if (io.verbosity>0) {
      console.log(chalk.green(`${'✅'.repeat(emphasis)} ${str}`));
    }
  },

  /**
   * Print a string in info style.
   *
   * @param {string} str
   *   The string to print.
   */
  info: (str) => {
    if (io.verbosity>0) {
      console.log(chalk.yellow(`${str}`));
    }
  },

  /**
   * Print a notice message.
   *
   * @param {string} str
   *   The message to show.
   */
  notice: (str) => {
    if (io.verbosity>0) {
      console.log(chalk.blue(`${str}`));
    }
  },

  /**
   * Print an update formatted message.
   *
   * @param {string} str
   *   The message to show.
   * @param {int} status
   *   The status to use.
   */
  update: (str, status = io.status.ok) => {
    switch (status) {
      case io.status.ok:
        str = chalk.bold.green('✔') + ` ${str}`;
        break;
      case io.status.error:
        str = chalk.bold.red('✘') + ` ${str}`;
    }

    if (io.verbosity>0) {
      console.log(str);
    }
  },

  /**
   * Print a string in skip style.
   *
   * @param {string} str
   *   The message to show.
   */
  skip: (str) => {
    if (io.verbosity>0) {
      console.log(chalk.yellow('[skip]:') + str);
    }
  },

  /**
   * Print a string in warn style.
   *
   * @param {string} str
   *   The string to print.
   */
  warn: (str) => {
    if (io.verbosity>0) {
      console.log(chalk.red(`[warning]: ${str}`));
    }
  },

  /**
   * Print a string in critical style.
   *
   * @param {string} str
   *   The string to print.
   */
  critical: (str) => {
    if (io.verbosity>-1) {
      console.log(chalk.bgRed.white.bold(`[error]: ${str}`));
    }
  },

  /**
   * The login message for all commands.
   */
  login: () => {
    console.log(chalk.red('Please run [login] to configure QuantCLI'));
  },

  /**
   * Print a string in title style.
   *
   * @param {string} str
   *   The string to format.
   */
  title: (str) => {
    if (io.verbosity>0) {
      console.log();
      console.log(chalk.bold(`Quant ${str}`));
      console.log(chalk.bold('='.repeat(`Quant ${str}`.length)));
    }
  },

  /**
   * Print a string in dimmed style.
   *
   * @param {string} str
   *   The string to print.
   */
  dimmed: (str) => {
    if (io.verbosity>0) {
      str = chalk.grey.italic(str);
      console.log(str);
    }
  },

  spinner: (str, status) => {
  },
};

module.exports = io;
