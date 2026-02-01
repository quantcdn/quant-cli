import fs from 'fs';
import os from 'os';
import path from 'path';
import color from 'picocolors';

let config = {};

/**
 * Load configuration from various sources in order of precedence:
 * 1. Command line arguments
 * 2. Environment variables
 * 3. quant.json file
 * 4. Default values
 */
async function fromArgs(args = {}, silent = false) {
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
  } catch (_err) {
    // Silent fail - we'll handle missing config later
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

  // Handle CLI args and their aliases
  if (args.dir) config.dir = args.dir;
  if (args.endpoint || args.e) config.endpoint = args.endpoint || args.e;
  if (args.clientid || args.c) config.clientid = args.clientid || args.c;
  if (args.project || args.p) config.project = args.project || args.p;
  if (args.token || args.t) config.token = args.token || args.t;

  // Handle enable-index-html setting
  if (args['enable-index-html'] !== undefined) {
    const enableIndexHtml = args['enable-index-html'] === true || args['enable-index-html'] === '';

    // If setting exists in config, ensure it matches
    if (config.enableIndexHtml !== undefined &&
        config.enableIndexHtml !== enableIndexHtml) {
      const currentSetting = config.enableIndexHtml ? 'enabled' : 'disabled';
      const requestedSetting = enableIndexHtml ? 'enable' : 'disable';
      throw new Error(
        `Cannot ${requestedSetting} index.html URLs - this project was deployed with index.html URLs ${currentSetting}`
      );
    }

    // Store the setting if it's the first time
    if (config.enableIndexHtml === undefined) {
      config.enableIndexHtml = enableIndexHtml;
      save();
    }
  }

  // Check required config
  const missingConfig = [];
  if (!config.clientid) missingConfig.push('clientid');
  if (!config.project) missingConfig.push('project');
  if (!config.token) missingConfig.push('token');

  if (missingConfig.length > 0 && !silent) {
    console.log(color.red('Missing required configuration:'));
    console.log(color.yellow(`Missing: ${missingConfig.join(', ')}`));
    console.log('\nYou can provide configuration in several ways:');
    console.log('1. Run "quant init" to create a new configuration');
    console.log('2. Create a quant.json file in this directory');
    console.log('3. Set environment variables:');
    console.log('   - QUANT_CLIENT_ID');
    console.log('   - QUANT_PROJECT');
    console.log('   - QUANT_TOKEN');
    console.log('4. Provide via command line arguments:');
    console.log('   --clientid, -c');
    console.log('   --project, -p');
    console.log('   --token, -t');
  }

  return missingConfig.length === 0;
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

  const saveConfig = {...config};

  // Save to both global and local config
  fs.writeFileSync(
    path.join(configDir, 'config.json'),
    JSON.stringify(saveConfig, null, 2)
  );

  fs.writeFileSync('quant.json', JSON.stringify(saveConfig, null, 2));
}

export default {
  fromArgs,
  get,
  set,
  save
};
