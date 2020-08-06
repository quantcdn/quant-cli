#!/usr/bin/env node --max-old-space-size=8192
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
      project: {
        description: 'Optionally provide project',
        alias: 'p',
        type: 'string',
      },
      endpoint: {
        description: 'Optionally provide QuantCDN API endpoint',
        alias: 'e',
        type: 'string',
      },
      project: {
        description: 'Optionally provide the project',
        alias: 'p',
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
        description: 'Path to the index.html file to send to Quant.',
        alias: 'f',
        type: 'string',
      },
      location: {
        description: 'Relative location the file will be accessible from',
        alias: 'l',
        type: 'string',
      },
      timestamp: {
        description: 'Timestamp to publish the transition',
        alias: 't',
        type: 'string',
      },
    })
    .command('file', 'Deploy a single asset to QuantCDN', {
      filepath: {
        description: 'Path to the asset to send to Quant.',
        alias: 'f',
        type: 'string',
      },
      location: {
        description: 'Relative location the file will be accessible from',
        alias: 'l',
        type: 'string',
      },
    })
    .command('redirect', 'Create a redirect in QuantCDN', {
      to: {
        description: 'Path to redirect to',
        alias: 't',
        type: 'string',
      },
      from: {
        description: 'Path to redirect from',
        alias: 'f',
        type: 'string',
      },
      status: {
        description: 'If the proxy is enabled.',
        alias: 's',
        type: 'int',
      },
    })
    .command('proxy', 'Create a proxy in QuantCDN', {
      path: {
        description: 'Path to proxy',
        alias: 'p',
        type: 'string',
      },
      origin: {
        description: 'Origin location',
        alias: 'o',
        type: 'string',
      },
      status: {
        description: 'If the proxy is enabled.',
        alias: 's',
        type: 'int',
      },
      basicAuthUser: {
        description: 'Username to use for basic auth',
        alias: 'u',
        type: 'string',
      },
      basicAuthPass: {
        description: 'Password for basic auth',
        alias: 'u',
        type: 'string',
      },
    })
    .command('unpublish', 'Unpublish a published route in QuantCDN', { // eslint-disable-line max-len
      url: {
        description: 'The published URL to transition',
        alias: 'u',
        type: 'string',
      },
    })
    .command('crawl', 'Crawl and push entire website to QuantCDN', { // eslint-disable-line max-len
      domain: {
        description: 'The website domain to crawl',
        alias: 'd',
        type: 'string',
      },
    })
    .help()
    .alias('help', 'h').argv;

// Command loader...
const commands = [
  'init',
  'info',
  'deploy',
  'page',
  'file',
  'proxy',
  'redirect',
  'unpublish',
  'crawl',
];

for (let i = 0; i < commands.length; i++) {
  if (!argv._.includes(commands[i])) {
    continue;
  }
  const command = require(`./src/commands/${commands[i]}`);
  return command(argv);
}

const c = chalk.yellow(argv._[0]);
console.error(chalk.red.bold(`QuantCLI: Unknown command [${c}]`));
