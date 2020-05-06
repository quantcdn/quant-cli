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
 *
 * @return {array}
 *   An array of files.
 */
const getFiles = async function(dir) {
  const subdirs = await readdir(dir);
  const files = await Promise.all(
      subdirs.map(async (subdir) => {
        const res = resolve(dir, subdir);
        return (await stat(res)).isDirectory() ? getFiles(res) : res;
      }),
  );
  return files.reduce((a, f) => a.concat(f), []);
};

module.exports = getFiles;
