/**
 * A quant client.
 */

const request = require('request');
const util = require('util');
const fs = require('fs');
const path = require('path');

module.exports = function(config) {
  const req = util.promisify(request); // eslint-disable-line
  const get = util.promisify(request.get);
  const post = util.promisify(request.post);

  const headers = {
    'User-Agent': 'Quant (+http://api.quantcdn.io)',
    'Quant-Token': config.get('token'),
    'Quant-Customer': config.get('clientid'),
    'Content-Type': 'application/json',
  };

  /**
   * Handle the response.
   *
   * @param {string} response
   *   Response body from the Quant API.
   *
   * @return {object}
   *   The API response.
   */
  const handleResponse = function(response) {
    if (response.statusCode > 400) {
      // @TODO: this is generally if the content is
      // streamed to the endpoint 4xx and 5xx are thrown
      // similarly, the API should respond with errors
      // otherwise.
      throw new Error('Critical error...');
    }

    const body = typeof response.body == 'string' ? JSON.parse(response.body) : response.body; // eslint-disable-line max-len

    if (body.error) {
      throw new Error(body.errorMsg);
    }

    return body;
  };

  return {
    /**
     * Ping the quant API.
     *
     * @return {string}
     *   The project name that was connected to.
     *
     * @throws Error
     */
    ping: async function() {
      const options = {
        url: `${config.get('endpoint')}/ping`,
        headers,
      };

      const res = await get(options);
      const body = JSON.parse(res.body);

      if (body.error) {
        throw new Error(body.errorMsg);
      }

      return body.project;
    },

    /**
     * Upload markup.
     *
     * @param {string} file
     *   The path to the file.
     * @param {string} location
     *   The path the location.
     * @param {bool} published
     *   The status.
     * @param {string} encoding
     *   The encoding type.
     *
     * @return {object}
     *   The API response.
     */
    markup: async function(file, location, published = true, encoding = 'utf-8') { // eslint-disable-line max-len
      if (!location) {
        const p = path.resolve(process.cwd(), config.get('dir'));
        // If a location isn't given, calculate it.
        location = path.relative(p, file);
      }

      if (!file.endsWith('index.html')) {
        throw new Error('Can only upload an index.html file.');
      }

      const options = {
        url: `${config.get('endpoint')}`,
        json: true,
        body: {
          url: `/${location}`,
          content: fs.readFileSync(file, {encoding}),
          published,
        },
        headers,
      };

      const res = await post(options);
      return handleResponse(res);
    },

    /**
     * Send a file to the Quant API.
     *
     * @param {string} local
     *  File path on disk.
     * @param {string} location
     *   Accessible location.
     *
     * @return {object}
     *   The successful payload.
     *
     * @throws Error
     */
    file: async function(local, location) {
      if (!location) {
        const p = path.resolve(process.cwd(), config.get('dir'));
        // If a location isn't given, calculate it.
        location = path.relative(p, local);
      }

      if (!fs.existsSync(local)) {
        throw new Error(`${local} is not accessible.`);
      }

      const formData = {
        data: fs.createReadStream(local),
      };

      const options = {
        url: config.get('endpoint'),
        headers: {
          ...headers,
          'Content-Type': 'multipart/form-data',
          'Quant-File-Url': `/${location}/${path.basename(local)}`,
        },
        formData,
      };

      const res = await post(options);
      return handleResponse(res);
    },

    /**
     * Change the status of an asset.
     *
     * @param {string} location
     *   The URL location of the content.
     * @param {bool} status
     *   Published status of a node.
     *
     * @return {object}
     *   API payload.
     *
     * @throws Error.
     */
    publish: async function(location, status = true) {
      // @TODO: this is likely handled by markup().
      throw new Error('Not implemented yet.');
    },

    /**
     *
     * @param {string} from
     *   The URL to redirect form.
     * @param {string} to
     *   The URL to redirect to.
     * @param {string} author
     *   (Optional) Author.
     * @param {int} status
     *   HTTP status code.
     *
     * @return {object}
     *   API payload.
     *
     * @throws Error.
     */
    redirect: async function(from, to, author, status = 302) {
      const options = {
        url: `${config.get('endpoint')}/redirect`,
        headers: {
          ...headers,
        },
        json: true,
        body: {
          url: from,
          redirect_url: to,
          redirect_http_code: status,
          published: true,
        },
      };

      if (author) {
        options.body.author = author;
      }

      const res = await post(options);
      return handleResponse(res);
    },

    /**
     * Create a proxy with the Quant API.
     *
     * @param {string} url
     *   The relative URL to proxy.
     * @param {string} destination
     *   The absolute FQDN/path to proxy to.
     * @param {bool} published
     *   If the proxy is published
     * @param {string} username
     *   Basic auth user.
     * @param {string} password
     *   Basic auth password.
     *
     * @return {object}
     *   The response.
     *
     * @throws Error.
     */
    proxy: async function(url, destination, published = true, username, password) { // eslint-disable-line max-len
      const options = {
        url: `${config.get('endpoint')}/proxy`,
        headers: {
          ...headers,
        },
        json: true,
        body: {
          url,
          destination,
          published,
        },
      };

      if (username) {
        options.body.basic_auth_user = username;
        options.body.basic_auth_pass = password;
      }

      const res = await post(options);
      return handleResponse(res);
    },
  };
};
