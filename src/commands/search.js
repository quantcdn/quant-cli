/**
 * Perform Search API oprtations.
 *
 * @usage
 *   quant search <index|unindex|clear>
 */
const chalk = require('chalk');
const client = require('../quant-client');
const config = require('../config');
const fs = require('fs');
const glob = require('glob');

const command = {};

command.command = 'search <status|index|unindex|clear>';
command.describe = 'Perform search index operations';
command.builder = (yargs) => {
  // Add/update search records.
  yargs.command('index', '<path>', {
    command: 'index <path>',
    builder: (yargs) => {
      yargs.positional('path', {
        type: 'string',
        describe: 'Path to directory containing JSON files, or an individual JSON file.',
      });
    },
    handler: (argv) => {
      if (!argv.path) {
        console.error(chalk.yellow('No path provided. Provide a path on disk, e.g: --path=/path/to/files'));
        return;
      }

      console.log(chalk.bold.green('*** Add/update search records ***'));

      if (!config.fromArgs(argv)) {
        return console.error(chalk.yellow('Quant is not configured, run init.'));
      }

      let jsonFiles = [];
      fs.stat(argv.path, (error, stats) => {
        // incase of error
        if (error) {
          console.error(error);
          return;
        }

        if (stats.isDirectory()) {
          jsonFiles = glob.sync(argv.path + '/*.json');
        } else {
          jsonFiles = [argv.path];
        }

        for (let i = 0; i < jsonFiles.length; i++) {
          client(config)
              .searchIndex(jsonFiles[i])
              .then(response => console.log(chalk.green('Success:') + ` Successfully posted search records in ${jsonFiles[i]}`)) // eslint-disable-line
              .catch((err) => console.log(chalk.red.bold('Error:') + ` ${err}`));
        }
      });
    },
  });

  // Unindex/remove search record.
  yargs.command('unindex', '<path>', {
    command: 'unindex <path>',
    describe: 'Removes an item from the search index based on URL.',
    builder: (yargs) => {
      yargs.positional('path', {
        type: 'string',
        describe: 'URL path of the item to unindex.',
      });
    },
    handler: (argv) => {
      if (!argv.path) {
        console.error(chalk.yellow('No path provided. Provide a content URL path to remove from index, e.g: /about-us'));
        return;
      }

      console.log(chalk.bold.green('*** Remove search record ***'));

      if (!config.fromArgs(argv)) {
        return console.error(chalk.yellow('Quant is not configured, run init.'));
      }

      client(config)
          .searchRemove(argv.path)
          .then(response => console.log(chalk.green('Success:') + ` Successfully removed search record for ${argv.path}`)) // eslint-disable-line
          .catch((err) => console.log(chalk.red.bold('Error:') + ` ${err}`));
    },
  });

  // Display search index status.
  yargs.command('status', '', {
    command: 'status',
    describe: 'Display search index status',
    builder: (yargs) => {
    },
    handler: (argv) => {
      console.log(chalk.bold.green('*** Search index status ***'));

      if (!config.fromArgs(argv)) {
        return console.error(chalk.yellow('Quant is not configured, run init.'));
      }

      client(config)
          .searchStatus()
          .then(response => { // eslint-disable-line
            console.log(chalk.green('Success:') + ` Successfully retrieved search index status`);
            console.log(response);
          })
          .catch((err) => console.log(chalk.red.bold('Error:') + ` ${err}`));
    },
  });

  // Clear the entire search index.
  yargs.command('clear', '', {
    command: 'clear',
    describe: 'Clears the entire search index',
    builder: (yargs) => {
    },
    handler: (argv) => {
      console.log(chalk.bold.green('*** Clear search index ***'));

      if (!config.fromArgs(argv)) {
        return console.error(chalk.yellow('Quant is not configured, run init.'));
      }

      client(config)
          .searchClearIndex()
          .then(response => console.log(chalk.green('Success:') + ` Successfully cleared search index`)) // eslint-disable-line
          .catch((err) => console.log(chalk.red.bold('Error:') + ` ${err}`));
    },
  });
};

module.exports = command;
