const fs = require('fs');

const filename = 'quant.json';

const config = {
  dir: 'build',
  endpoint: 'https://api.quantcdn.io',
  clientid: null,
  project: null,
  token: null,
  bearer: null,
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
  let value = config[key];
  if (key == 'endpoint') {
    value += '/v1';
  }
  return value;
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
const save = function(dir = '.') {
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
 * @return {boolean}
 *   If the configuration is valid.
 */
const validate = function() {
  // Dir is optional as this can be an optional arg to relevant commands.
  const reqKeys = ['clientid', 'project', 'endpoint', 'token'];
  const diff = reqKeys.filter((i) => ! Object.keys(config).includes(i));
  return diff.length == 0;
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
const load = function(dir = '.') {
  let data;

  try {
    data = fs.readFileSync(`${dir}/${filename}`);
  } catch (err) {
    return false;
  }

  data = JSON.parse(data);
  Object.assign(config, data);

  if (!validate()) {
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
    config.clientid = argv.clientid;
  }

  if (argv.project) {
    config.project = argv.project;
  }

  if (argv.token) {
    config.token = argv.token;
  }

  if (argv.endpoint) {
    config.endpoint = argv.endpoint;
  }

  if (argv.bearer) {
    config.bearer = argv.bearer;
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
};
