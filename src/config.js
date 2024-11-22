const fs = require('fs');
const os = require('os');
const path = require('path');

let config = {};

/**
 * Load configuration from various sources in order of precedence:
 * 1. Command line arguments
 * 2. Environment variables
 * 3. quant.json file
 * 4. Default values
 */
async function fromArgs(args = {}) {
  // First check environment variables
  const envConfig = {
    clientid: process.env.QUANT_CLIENT_ID,
    project: process.env.QUANT_PROJECT,
    token: process.env.QUANT_TOKEN,
    endpoint: process.env.QUANT_ENDPOINT || 'https://api.quantcdn.io/v1',
    bearer: process.env.QUANT_BEARER
  };

  // Then try to load from quant.json
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(fs.readFileSync('quant.json'));
  } catch (err) {
    // File doesn't exist or is invalid JSON - that's ok
  }

  // Merge configs with precedence: args > env > file > defaults
  config = {
    ...config,  // Default values
    ...fileConfig,
    ...Object.fromEntries(
      Object.entries(envConfig).filter(([_, v]) => v !== undefined)
    ),
    ...Object.fromEntries(
      Object.entries(args).filter(([_, v]) => v !== undefined)
    )
  };

  // Ensure required fields are present
  return (
    config.clientid !== undefined &&
    config.project !== undefined &&
    (config.token !== undefined || config.bearer !== undefined)
  );
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
