const fs = require('fs');

const filename = '.quant.json';
const os = require('os');

const config = {
  endpoint: 'https://api.quantcdn.io/v1',
  deploy: {
    dir: 'build',
    organization: null,
    project: null,
    token: null,
  },
  tokens: [],
  activeToken: false,
  activeOrg: false,
  activeProject: false,
};

/**
 * Set the configuration values.
 *
 * @param {object} results
 *
 * @return {boolean}
 *   If the configuration was updated.
 */
const set = function(results) {
  Object.assign(config, results);
  return true;
};

/**
 * Getter for the configuration.
 *
 * @param {string} key
 *   The configuration key.
 *
 * @return {string}
 *   The configuration value.
 */
const get = function(key) {
  return key.split('.').reduce((a, b) => a[b], config);
};

/**
 * Get the active API token.
 *
 * @return {string}
 */
const getApiToken = function() {
  const idx = config.activeToken ? config.activeToken : 0;
  return config.tokens[idx];
};

/**
 * Save the configuration to file.
 *
 * @param {string} dir
 *   The directory to save to.
 *
 * @return {boolean}
 *   If the file was saved.
 */
const save = function(dir = os.homedir) {
  const data = JSON.stringify(config, null, 2);
  try {
    fs.writeFileSync(`${dir}/${filename}`, data);
  } catch (err) {
    return false;
  }
  return true;
};

/**
 * Validate the loaded configuration.
 *
 * @param {string} type
 *   The type of configuration to validate.
 *
 * @return {boolean}
 *   If the configuration is valid.
 */
const validate = function(type = 'deploy') {
  let valid = false;

  switch (type) {
    case 'tokens':
      // Validate the schema of all tokens that are added to the configuration object.
      valid = true;
      break;
    default:
      // Validate the deployer configuration.
      const reqKeys = ['organization', 'project', 'token'];
      const diff = reqKeys.filter((i) => ! Object.keys(config.deploy).includes(i));
      valid = diff.length == 0;
      break;
  }

  return valid;
};

/**
 * Load the configuration to memory.
 *
 * @param {string} dir
 *   The directory to load from.
 *
 * @return {boolean}
 *   If the file was loaded.
 */
const load = function(dir = os.homedir) {
  let data;

  try {
    data = fs.readFileSync(`${dir}/${filename}`);
  } catch (err) {
    return false;
  }

  data = JSON.parse(data);
  Object.assign(config, data);

  if (!validate('deploy')) {
    return false;
  }

  return true;
};

/**
 * Load a configuration object from argv.
 *
 * @param {yargs} argv
 *   yargs argv object.
 *
 * @return {boolean}
 *   If config is valid.
 */
const fromArgs = function(argv) {
  load();

  if (argv.clientid) {
    config.deploy.organization = argv.clientid;
  } else if (argv.organization) {
    config.deploy.organization = argv.organization;
  }

  if (argv.project) {
    config.deploy.project = argv.project;
  }

  if (argv.token) {
    config.deploy.token = argv.token;
  }

  if (argv.endpoint) {
    config.endpoint = argv.endpoint;
  }

  if (!validate()) {
    return false;
  }

  return true;
};

module.exports = {
  save,
  load,
  set,
  get,
  fromArgs,
  getApiToken,
};
