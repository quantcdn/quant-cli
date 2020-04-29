/**
 * Ping the Quant API.
 */

const request = require('request');
const util = require('util');

/**
 * Ping the quant API.
 *
 * @param {object} config
 *   A quant config object.
 *
 * @return {array}
 *   The status of the request.
 */
module.exports = async function(config) {
  const req = util.promisify(request.get);

  const options = {
    url: `${config.get('endpoint')}/ping`,
    headers: {
      'Content-Type': 'application/json',
      'Quant-Customer': config.get('clientid'),
      'Quant-Token': config.get('token'),
    },
  };

  const res = await req(options);
  const body = JSON.parse(res.body);

  if (body.error) {
    throw (body.errorMsg);
  }

  return body.project;
};
