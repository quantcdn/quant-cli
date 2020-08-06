/**
 * Service to assist with find image patterns in string.
 */
const matchAll = require('string.prototype.matchall');
const REGEX = /background(-image)?:.*?url\(\s*(?<url>.*?)\s*\)/gi;

/**
 * Attempt to find all images in a given string.
 *
 * @param {String} string
 *   The string to search for images.
 * @param {string} host
 *   A host string.
 * @param {string} protocol
 *   Protocol for the urls.
 *
 * @return {Array}
 *   An array of found images.
 */
const detectImages = async (string, host = null, protocol = 'https') => {
  if (Buffer.isBuffer(string)) {
    string = string.toString();
  }

  const items = [...matchAll(string, REGEX)];

  if (items.length < 0) {
    return [];
  }

  return items.map((item) => {
    let img = item.groups.url.replace(/'|\"/g, '');
    if (host) {
      img = `${protocol}://${host}${img}`;
    }
    return img;
  });
};

module.exports = detectImages;
