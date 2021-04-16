/**
 * Service to assist with find image patterns in string.
 */

const {decode} = require('html-entities');
const matchAll = require('string.prototype.matchall');
const bgImg = /background(-image)?:.*?url\(\s*(?<url>.*?)\s*\)/gi;
const dataSrc = /data-src(?:\-retina)?=\"(?<url>[^']*?)\"/gi;

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

  const items = [...matchAll(string, bgImg), ...matchAll(string, dataSrc)];

  if (items.length < 0) {
    return [];
  }

  return items.map((item) => {
    let img = decode(item.groups.url).replace(/'|\"/g, '');
    if (host) {
      img = `${protocol}://${host}${img}`;
    }
    return img;
  }).filter((item, index, arr) => arr.indexOf(item) === index);
};

module.exports = detectImages;
