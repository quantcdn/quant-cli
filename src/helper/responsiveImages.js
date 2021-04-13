/**
 * Service to parse and support responsive images.
 */

const matchAll = require('string.prototype.matchall');


/**
 * Format the source set to something that we can work with.
 *
 * @param {string} src
 *   The string to format.
 *
 * @return {string}
 *   Formatted source set.
 */
function prepare(src) {
  return src.trim().split(' ')[0].replace(/^\//, '');
}

module.exports = (string, host, protocol = 'https') => {
  let retval = [];

  const picp = new RegExp(/<picture[^<]*>[^<]*(?:[^<]*)*[^<]*(?:<[^<]*)*<\/picture>/gi);
  const imgp = new RegExp(/<img\s[^>]*?src\s*=\s*['\"]([^'\"]*?)['\"][^>]*?>/gi);
  const srcs = new RegExp(/(?:srcset|src)="(?<attr>.[^"]+)"/gi);

  if (Buffer.isBuffer(string)) {
    string = string.toString();
  }

  const items = [...matchAll(string, picp), ...matchAll(string, imgp)];

  if (items.length < 0) {
    return retval;
  }

  items.map((item) => {
    let imgs = [...matchAll(item[0], srcs)];
    imgs.map((i) => {
      i.groups.attr.split(',').map((a) => {
        a = prepare(a);
        a = (host) ? `${protocol}://${host}/${a}` : a;
        if (retval.indexOf(a) === -1) {
          retval.push(a);
        }
      });
    });
  });

  return retval;
};
