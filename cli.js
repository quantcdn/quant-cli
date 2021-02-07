#!/usr/bin/env node

require('yargs/yargs')(process.argv.slice(2))
    .strict()
    .help()
    .commandDir('src/commands')
    // Global options that can be used by all commands
    // options provided will be used over quant.json.
    .option('clientid', {
      alias: 'c',
      describe: 'Project customer id for QuantCDN',
      type: 'string',
    })
    .option('project', {
      alias: 'p',
      describe: 'Project name for QuantCDN',
      type: 'string',
    })
    .option('token', {
      alias: 't',
      describe: 'Project token for QuantCDN',
      type: 'string',
    })
    .option('endpoint', {
      alias: 'e',
      describe: 'API endpoint for QuantCDN',
      type: 'string',
      default: 'https://api.quantcdn.io',
    })
    .demandCommand()
    .wrap(100)
    .argv;
