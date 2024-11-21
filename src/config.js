const fs = require('fs');
const os = require('os');
const path = require('path');
const { confirm } = require('@clack/prompts');
const color = require('picocolors');

let config = {};

/**
 * Load configuration from various sources in order of precedence:
 * 1. Command line arguments
 * 2. Environment variables
 * 3. quant.json file
 */
async function fromArgs(args = {}) {
  // First check environment variables
  const envConfig = {
    clientid: process.env.QUANT_CLIENT_ID,
    project: process.env.QUANT_PROJECT,
    token: process.env.QUANT_TOKEN,
    endpoint: process.env.QUANT_ENDPOINT,
    bearer: process.env.QUANT_BEARER
  };

  // Then try to load from quant.json
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(fs.readFileSync('quant.json'));
  } catch (err) {
    // File doesn't exist or is invalid JSON - that's ok
  }

  // Merge configs with precedence: args > env > file
  config = {
    ...fileConfig,
    ...Object.fromEntries(
      Object.entries(envConfig).filter(([_, v]) => v !== undefined)
    ),
    ...Object.fromEntries(
      Object.entries(args).filter(([_, v]) => v !== undefined)
    )
  };

  // Check if we have required configuration
  const hasConfig = (
    config.clientid !== undefined &&
    config.project !== undefined &&
    (config.token !== undefined || config.bearer !== undefined)
  );

  // If no config is found and this isn't the init command
  if (!hasConfig && args._[0] !== 'init') {
    console.log(color.yellow('No configuration found.'));
    
    const shouldInit = await confirm({
      message: 'Would you like to initialize a new project?',
      initialValue: true
    });

    if (shouldInit) {
      // Load and execute the init command
      const initCommand = require('./commands/init');
      const initArgs = await initCommand.promptArgs();
      if (initArgs) {
        await initCommand.handler(initArgs);
        // Reload config after init
        return fromArgs(args);
      }
    }

    console.log(color.yellow('\nConfiguration required to continue. You can:'));
    console.log(color.yellow('1. Run "quant init" to create a new configuration'));
    console.log(color.yellow('2. Create a quant.json file in this directory'));
    console.log(color.yellow('3. Set environment variables (QUANT_CLIENT_ID, QUANT_PROJECT, QUANT_TOKEN)'));
    console.log(color.yellow('4. Provide configuration via command line arguments\n'));
    
    return false;
  }

  return hasConfig;
}

function get(key) {
  return config[key];
}

function set(values) {
  config = {...config, ...values};
}

function save() {
  const configDir = `${os.homedir()}/.quant`;
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, {recursive: true});
  }

  // Save to both global and local config
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify(config, null, 2)
  );

  fs.writeFileSync('quant.json', JSON.stringify(config, null, 2));
}

module.exports = {
  fromArgs,
  get,
  set,
  save,
};
