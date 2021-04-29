const path = require('path');

/**
 * Convert directory separators to posix standard.
 *
 * @param {string} str
 *   The path string.
 * @param {string} sep
 *   A separator string.
 *
 * @return {string}
 *   A normalised path.
 */
module.exports = (str, sep = path.sep) => {
  return str.split(sep).join(path.posix.sep);
};
