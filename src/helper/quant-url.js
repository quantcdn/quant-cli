/**
 * Prepare URLs for quant.
 */

module.exports = {

  /**
   * Prepare a URI to work with Quant.
   *
   * @param {string} uri
   *   The URI to prepare.
   *
   * @return {string}
   *   The prepared URI
   */
  prepare: (uri) => {
    uri = uri.startsWith('/') ? uri : `/${uri}`;
    uri = uri.toLowerCase();
    uri = uri.replace(/(\/)index\.html/, '$1');

    if (uri.length > 1) {
      return uri.endsWith('/') ? uri.slice(0, -1) : uri;
    }
    return uri;
  },

};
