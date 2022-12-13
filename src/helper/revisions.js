const fs = require('fs');
const os = require('os');
const {tmpdir} = require('os');
const {sep} = require('path');

let data = {};
let isEnabled = true;
let loc = tmpdir() + sep + 'quant-revision-log';

/**
 * Check if the sha exists in the revision log.
 *
 * @param {string} path
 *   Revision path to evaluate.
 * @param {string} sha
 *   Revision sha to evaluate.
 *
 * @return {boolean}
 *   If the revision exists.
 */
const has = function(path, sha) {
  if (!isEnabled) {
    // Defaults to false if the local file is not enabled.
    return false;
  }

  if (!data.hasOwnProperty(path)) {
    path = path.startsWith('/') ? path : `/${path}`;
    if (!data.hasOwnProperty(path)) {
      return false;
    }
  }

  return data[path] == sha;
};

/**
 * Load the revision log into memory for this process.
 *
 * @param {string} file
 *  File location that stores the revision log.
 *
 * @return {boolean}
 *   If the log file was found and loaded.
 */
const load = function(file) {
  if (!isEnabled) {
    return;
  }

  let _d;

  if (file) {
    loc = file;
  }

  if (fs.existsSync(loc)) {
    _d = fs.readFileSync(loc);
    try {
      _d = JSON.parse(_d.toString());
    } catch (err) {
      return false;
    }
  }
  data = Object.assign(data, _d);
  return true;
};

/**
 * Store an item in the log.
 *
 * @param {object} item
 *   An item to add to the revision log.
 */
const store = function(item) {
  if (!isEnabled) {
    return;
  }
  const i = {};
  i[item.url] = item.md5;
  data = Object.assign(data, i);
};

/**
 * Save the revision log.
 *
 * @return {boolean}
 *   If the file was saved.
 */
const save = function() {
  if (!isEnabled) {
    return;
  }
  try {
    fs.writeFileSync(loc, JSON.stringify(data) + os.EOL);
  } catch (err) {
    return false;
  }
  return true;
};

/**
 * Get/set the state.
 *
 * @param {boolean} s
 *   The state.
 * @return {boolean}
 *   The state.
 */
const enabled = function(s) {
  if (s) {
    isEnabled = s;
  }
  return isEnabled;
};

module.exports = {
  has,
  store,
  load,
  save,
  enabled,
};
