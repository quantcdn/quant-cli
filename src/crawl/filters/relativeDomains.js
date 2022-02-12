/**
 * The string buffer of a response.
 *
 * @param {string} dom
 *   The DOM string for markup.
 * @param {object} opts
 *   The options.
 *
 * @return {string}
 *   The manipulated string.
 */
module.exports = {
  option: 'rewrite',
  handler: (dom, opts, argv = []) => {
    const regex = new RegExp(`http[s]?:\/\/${opts.host}(:\\d+)?\/[\/]?`, 'gi');
    let body = dom.replace(regex, '/');

    if ('extra-domains' in argv) {
      let r;
      const extraDomains = argv['extra-domains'].split(',').map((d) => d.trim());

      for (let i = 0; i < extraDomains.length; i++) {
        r = new RegExp(`http[s]?:\/\/${extraDomains[i]}(:\\d+)?\/[\/]?`, 'gi');
        body = body.replace(r, '/');
      }
    }

    return body;
  },
};
