/**
 * Handle sending a file to the API.
 */

const request = require('request');
const util = require('util');
const fs = require('fs');
const config = require('./config');

/**
 * Send a file to the quant API.
 *
 * @param {string} filepath
 *   File path on disk.
 * @param {string} location
 *   Location the file should be accesible from in Quant.
 *
 * @return {bool}
 *   Success of the transaction.
 */
module.exports = async function(filepath, location) {
  const post = util.promisify(request);
  const formData = {
    data: fs.createReadStream(filepath),
  };

  config.load();

  const options = {
    url: config.get("endpoint"),
    method: "POST",
    headers: {
      "Content-Type": "multipart/form-data",
      "User-Agent": "Quant (+http://quantcdn.io)",
      "Quant-File-Url": `/${location}/${filepath.split('/').pop()}`,
      "Quant-Token": config.get("token"),
      "Quant-Customer": config.get("clientid"),
    },
    formData,
  };

  const res = await post(options);

  if (res.statusCode > 400) {
    throw 'Critical error...';
  }

  const body = JSON.parse(res.body);

  if (body.error) {
    throw body.errorMsg;
  }

  return body;
};
