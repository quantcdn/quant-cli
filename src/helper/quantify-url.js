/**
 * Standard way of preparing a URL for Quant.
 *
 * @param {string} str
 *   The url to quantify.
 *
 * @return {string}
 *   The URL.
 */
module.exports = (str) => {
  str = str.indexOf('/') == 0 ? str : `/${str}`;
  str = str.toLowerCase();
  // @todo the quant API has branching logic for this;
  // it can either be <path>.html or <path>,
  // to properly account for this we would have to
  // convert each path to 2 outputs with increases
  // the number of requests to lookup.
  str = str.replace(/\/?index\.html/, '');

  return str;
};
