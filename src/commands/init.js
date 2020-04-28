const chalk = require('chalk');
const prompt = require('prompt');

const config = require('../config');
const ping = require('../ping');

module.exports = function(argv) {
  const token = argv.token;
  const clientid = argv.clientid;
  const endpoint = argv.endpoint;
  const dir = argv.dir;

  console.log(chalk.bold.green('*** Initialise Quant ***'));

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
      config.set(result);
      config.save();
      ping(config);
    });
  } else {
    config.set({clientid, token, endpoint, dir});
    config.save();
    ping(config);
  }
};
