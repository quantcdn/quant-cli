const { text, password, confirm, isCancel } = require('@clack/prompts');
const color = require('picocolors');
const config = require('../config');
const client = require('../quant-client');
const fs = require('fs');

const command = {
  command: 'init',
  describe: 'Initialize a project in the current directory',
  
  builder: (yargs) => {
    return yargs
      .option('dir', {
        alias: 'd',
        describe: 'Directory containing static assets',
        type: 'string',
        default: 'build'
      })
      .option('clientid', {
        alias: 'c',
        describe: 'Project customer id for QuantCDN',
        type: 'string'
      })
      .option('project', {
        alias: 'p',
        describe: 'Project name for QuantCDN',
        type: 'string'
      })
      .option('token', {
        alias: 't',
        describe: 'Project token for QuantCDN',
        type: 'string'
      });
  },

  async promptArgs() {
    const clientid = await text({
      message: 'Enter QuantCDN client id',
      validate: value => {
        if (!value) return 'Client ID is required';
        if (!/^[a-zA-Z0-9\-\_]+$/.test(value)) {
          return 'Client ID must contain only letters, numbers, underscores or dashes';
        }
      }
    });

    if (isCancel(clientid)) return null;

    const project = await text({
      message: 'Enter QuantCDN project',
      validate: value => {
        if (!value) return 'Project is required';
        if (!/^[a-zA-Z0-9\-]+$/.test(value)) {
          return 'Project must contain only letters, numbers or dashes';
        }
      }
    });

    if (isCancel(project)) return null;

    const token = await password({
      message: 'Enter QuantCDN project token',
      validate: value => !value ? 'Token is required' : undefined
    });

    if (isCancel(token)) return null;

    const bearer = await password({
      message: 'Enter an optional QuantCDN API token (press Enter to skip)',
    });

    if (isCancel(bearer)) return null;

    const dir = await text({
      message: 'Directory containing static assets',
      defaultValue: 'build'
    });

    if (isCancel(dir)) return null;

    return {
      endpoint: endpoint || 'https://api.quantcdn.io',
      clientid,
      project,
      token,
      bearer: bearer || undefined,
      dir
    };
  },

  async handler(args) {
    if (!args) {
      throw new Error('Operation cancelled');
    }

    // If any required fields are missing, go into interactive mode
    if (!args.clientid || !args.project || !args.token) {
      const promptedArgs = await this.promptArgs();
      if (!promptedArgs) {
        throw new Error('Operation cancelled');
      }
      args = { ...args, ...promptedArgs };
    }

    const config_args = {
      endpoint: args.endpoint || 'https://api.quantcdn.io',
      clientid: args.clientid,
      project: args.project,
      token: args.token,
      bearer: args.bearer,
      dir: args.dir || 'build'
    };

    // Validate we have all required fields before saving
    if (!config_args.clientid || !config_args.project || !config_args.token) {
      throw new Error('Missing required configuration fields');
    }

    config.set(config_args);
    config.save();

    const _client = client(config);
    try {
      const message = await _client.ping(config);
      return `Successfully connected to ${message.project}`;
    } catch (error) {
      // If save failed, clean up the incomplete config file
      try {
        fs.unlinkSync('quant.json');
      } catch (e) {
        // Ignore error if file doesn't exist
      }
      throw new Error(`Unable to connect to quant: ${error.message}`);
    }
  }
};

module.exports = command;
