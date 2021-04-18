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
  handler: (dom, opts) => {
    const regex = new RegExp(`http[s]?:\/\/${opts.host}(:\\d+)?`, 'gi');
    return dom.replace(regex, '');
  },
};
