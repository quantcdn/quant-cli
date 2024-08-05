/**
 * Get a file list for a given directory.
 */

const fs = require('fs');
const {promisify} = require('util');
const {resolve} = require('path');
const readdir = promisify(fs.readdir);
const stat = promisify(fs.stat);

/**
 * Get files from a directory.
 *
 * @param {string} dir
 *   The directory from which to get files.
 * @param {array} exclusions
 *   A list of exclusions.
 *
 * @return {array}
 *   An array of files.
 */
const getFiles = async function(dir, exclusions = []) {
  const subdirs = await readdir(dir);
  let files = await Promise.all(
      subdirs.map(async (subdir) => {
        const res = resolve(dir, subdir);
        return (await stat(res)).isDirectory() ? getFiles(res) : res;
      }),
  );

  // Ensure that quant.json is always excluded.
  exclusions.push('quant.json');
  const matcher = new RegExp(exclusions.join('|'), 'gi');
  files = files.filter((i) => matcher.test(i) === false);
  return files.reduce((a, f) => a.concat(f), []);
};

module.exports = function() {
  return module.exports.getFiles.apply(this, arguments);  
};
module.exports.getFiles = getFiles;
