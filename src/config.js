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
    endpoint: process.env.QUANT_ENDPOINT,
    dir: process.env.QUANT_DIR
  };

  // Then try to load from quant.json
  let fileConfig = {};
  try {
    fileConfig = JSON.parse(fs.readFileSync('quant.json'));
  } catch (err) {
    console.log('Debug - No quant.json found or error:', err.message);
  }

  // Set defaults
  const defaults = {
    endpoint: 'https://api.quantcdn.io/v1',
    dir: 'build'
  };

  // Merge configs with precedence: CLI args > env > file > defaults
  config = {
    ...defaults,
    ...fileConfig,
    ...Object.fromEntries(
      Object.entries(envConfig).filter(([_, v]) => v !== undefined)
    )
  };

  // Only merge specific CLI args we care about
  if (args.dir) config.dir = args.dir;
  if (args.endpoint) config.endpoint = args.endpoint;
  if (args.clientid) config.clientid = args.clientid;
  if (args.project) config.project = args.project;
  if (args.token) config.token = args.token;
  
  // Handle enable-index-html setting
  if (args['enable-index-html'] !== undefined) {
    // If setting exists in config, ensure it matches
    if (config.enableIndexHtml !== undefined && 
        config.enableIndexHtml !== args['enable-index-html']) {
      throw new Error(
        'Project was previously deployed with ' + 
        (config.enableIndexHtml ? '--enable-index-html' : 'no --enable-index-html') +
        '. Cannot change this setting after initial deployment.'
      );
    }
  }

  // Ensure endpoint ends with /v1
  if (config.endpoint && !config.endpoint.endsWith('/v1')) {
    config.endpoint = `${config.endpoint}/v1`;
  }

  return (
    config.clientid !== undefined &&
    config.project !== undefined &&
    config.token !== undefined
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

  // Remove /v1 from endpoint when saving to config file
  const saveConfig = {...config};
  if (saveConfig.endpoint && saveConfig.endpoint.endsWith('/v1')) {
    saveConfig.endpoint = saveConfig.endpoint.slice(0, -3);
  }

  // Save to both global and local config
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify(saveConfig, null, 2)
  );

  fs.writeFileSync('quant.json', JSON.stringify(saveConfig, null, 2));
}

module.exports = {
  fromArgs,
  get,
  set,
  save,
};
