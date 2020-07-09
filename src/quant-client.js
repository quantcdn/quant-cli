/**
 * A quant client.
 */

const request = require('request');
const util = require('util');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const md5 = require('md5-file');

const client = function(config) {
  const req = util.promisify(request); // eslint-disable-line
  const get = util.promisify(request.get);
  const post = util.promisify(request.post);
  const patch = util.promisify(request.patch);

  const headers = {
    'User-Agent': 'Quant (+http://api.quantcdn.io)',
    'Quant-Token': config.get('token'),
    'Quant-Customer': config.get('clientid'),
    'Quant-Project': config.get('project'),
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
    // console.log(response);
    if (response.statusCode == 400) {
      // @TODO: this is generally if the content is
      // streamed to the endpoint 4xx and 5xx are thrown
      // similarly, the API should respond with errors
      // otherwise.
      if (typeof response.body.errorMsg != 'undefined') {
        throw new Error(response.body.errorMsg);
      }
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
     * @return {object}
     *   The response object.
     *
     * @throws Error.
     */
    ping: async function() {
      const options = {
        url: `${config.get('endpoint')}/ping`,
        json: true,
        headers,
      };

      const res = await get(options);
      return handleResponse(res);
    },

    /**
     * Access the global meta for the project.
     *
     * @return {object}
     *   The global meta response object.
     *
     * @throws Error.
     */
    meta: async function() {
      const options = {
        url: `${config.get('endpoint')}/global-meta`,
        json: true,
        headers,
      };

      const res = await get(options);
      return handleResponse(res);
    },

    /**
     * Send a file to the server.
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
    send: async function(file, location, published = true, encoding = 'utf-8') {
      const mimeType = mime.lookup(file);

      if (mimeType == 'text/html') {
        if (!location) {
          const p = path.resolve(process.cwd(), config.get('dir'));
          // If a location isn't given, calculate it.
          location = path.relative(p, file);
        }

        if (!file.endsWith('index.html')) {
          // Some static site generators don't output files
          // in the way that Quant is expecting to handle them
          // this forces the location to a quant valid path
          // and creates a redirect form the file location.
          from = location.startsWith('/') ? location : `/${location}`;
          location = location.replace('.html', '/index.html');
          to = location.startsWith('/') ? location : `/${location}`;
          try {
            await this.redirect(from, to.replace('/index.html', ''));
          } catch (err) {
            // Fail silently if this has been created already.
          };
        }

        return await this.markup(file, location, published, encoding);
      } else {
        return await this.file(file, location);
      }
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

      if (!file.endsWith('index.html') && !location.endsWith('index.html')) {
        throw new Error('Can only upload an index.html file.');
      }

      const hash = md5.sync(file);

      const options = {
        url: `${config.get('endpoint')}`,
        json: true,
        body: {
          url: `/${location}`,
          content: fs.readFileSync(file, {encoding}),
          published,
          hash,
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
        location.replace(path.basename(location), '');
      } else {
        location = `${location}/${path.basename(local)}`;
      }

      if (!fs.existsSync(local)) {
        throw new Error(`${local} is not accessible.`);
      }

      const formData = {
        data: fs.createReadStream(local),
      };

      const hash = md5.sync(local);

      location = location.startsWith('/') ? location : `/${location}`;

      const options = {
        url: config.get('endpoint'),
        json: true,
        headers: {
          ...headers,
          'Content-Type': 'multipart/form-data',
          'Quant-File-Url': location,
          'Quant-Hash': hash,
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
     * Unpublish a URL.
     *
     * @param {string} url
     *   The URL to unpublish.
     *
     * @return {object}
     *
     * @throws Error.
     */
    unpublish: async function(url) {
      // Ensure that we don't have index.html in the URL as Quant
      // expects to obfuscate this.
      url = url.replace('/index.html', '');

      const options = {
        url: `${config.get('endpoint')}/unpublish`,
        headers: {
          ...headers,
          'Quant-Url': url,
        },
        json: true,
      };

      const res = await patch(options);
      return handleResponse(res);
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

      if (status < 300 || status > 400) {
        throw new Error('A valid redirect status code is required');
      }

      if (author) {
        options.body.info = {author};
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

module.exports = function() {
  return module.exports.client.apply(this, arguments); // eslint-disable-line
};
module.exports.client = client;
