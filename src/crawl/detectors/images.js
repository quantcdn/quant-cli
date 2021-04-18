/**
 * Service to assist with find image patterns in string.
 */

const {decode} = require('html-entities');
const matchAll = require('string.prototype.matchall');
const bgImg = /background(-image)?:.*?url\(\s*(?<url>.*?)\s*\)/gi;
const dataSrc = /data-src(?:\-retina)?=\"(?<url>[^']*?)\"/gi;

module.exports = {
  applies: (response) => {
    return response.headers['content-type'] && (response.headers['content-type'].includes('text/html') || response.headers['content-type'].includes('css'));
  },
  handler: (string, host, protocol = 'https') => {
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
  },
};
