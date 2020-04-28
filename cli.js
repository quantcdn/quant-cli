#!/usr/bin/env node
const chalk = require('chalk');
const yargs = require('yargs');

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
    .command('page', 'Deploy a single page to QuantCDN', {
      filepath: {
        description: 'Path to the file to send to Quant.',
        alias: 'f',
        type: 'string',
      },
      location: {
        description: 'Location the file will be accessible from',
        alias: 'l',
        type: 'string',
      },
    })
    .help()
    .alias('help', 'h').argv;

// Command loader...
const commands = ['init', 'info', 'deploy', 'page'];

for (let i = 0; i < commands.length; i++) {
  if (!argv._.includes(commands[i])) {
    continue;
  }
  const command = require(`./src/commands/${commands[i]}`);
  return command(argv);
}

const c = chalk.yellow(argv._[0]);
console.error(chalk.red.bold(`QuantCLI: Unknown command [${c}]`));
