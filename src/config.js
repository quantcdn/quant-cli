const fs = require('fs');

const filename = 'quant.json';
const config = {
  dir: 'build',
  endpoint: 'http://quantcdn.io',
  clientid: null,
  token: null,
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
  return config[key];
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
  return true;
};

module.exports = {
  save,
  load,
  set,
  get,
};
