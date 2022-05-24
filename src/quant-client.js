/**
 * A quant client.
 */

const request = require('request');
const util = require('util');
const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const querystring = require('querystring');

const client = function(config) {
  const req = util.promisify(request); // eslint-disable-line
  const get = util.promisify(request.get);
  const post = util.promisify(request.post);
  const patch = util.promisify(request.patch);
  const del = util.promisify(request.delete);

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
    const body = typeof response.body == 'string' ? JSON.parse(response.body) : response.body; // eslint-disable-line max-len

    if (typeof body.errors != 'undefined') {
      let msg = '';
      for (i in body.errors) { // eslint-disable-line
        msg += body.errors[i].errorMsg + '\n';
      }
      throw new Error(msg);
    }

    if (response.statusCode == 400) {
      // @TODO: this is generally if the content is
      // streamed to the endpoint 4xx and 5xx are thrown
      // similarly, the API should respond with errors
      // otherwise.
      if (typeof body.errorMsg != 'undefined') {
        throw new Error(body.errorMsg);
      }
      throw new Error('Critical error...');
    }

    if (body.error || (typeof body.errorMsg != 'undefined' && body.errorMsg.length > 0)) { // eslint-disable-line max-len
      const msg = typeof body.errorMsg != 'undefined' ? body.errorMsg: body.msg;
      throw new Error(msg);
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
     * @param {bool} unfold
     *   Unfold the record set.
     * @param {object} extend
     *   Additional query parameters to send.
     *
     * @return {object}
     *   The global meta response object.
     *
     * @throws Error.
     *
     * @TODO
     *   - Async iterator for memory 21k items ~ 40mb.
     */
    meta: async function(unfold = false, extend = {}) {
      const records = [];
      const query = Object.assign({
        page_size: 500,
        published: true,
      }, extend);
      const url = `${config.get('endpoint')}/global-meta?${querystring.stringify(query)}`;
      const doUnfold = async function(i) {
        const res = await get({
          url: `${url}&page=${i}`,
          json: true,
          headers,
        });

        if (res.body.global_meta && res.body.global_meta.records) {
          res.body.global_meta.records.map((item) => records.push({url: item.meta.url, md5: item.meta.md5}));
        }
      };

      let page = 1;
      const options = {
        url: `${url}&page=${page}`,
        json: true,
        headers,
      };

      // Seed the record set.
      const res = await get(options);

      if (!res.body.global_meta) {
        // If no records have been published then global_meta is not
        // present in the response.
        return;
      }

      if (res.body.global_meta.records) {
        res.body.global_meta.records.map((item) => records.push({url: item.meta.url, md5: item.meta.md5}));
      }

      if (unfold) {
        page++;
        while (res.body.global_meta.total_pages >= page) {
          await doUnfold(page);
          page++;
        }
      }

      return {
        total_pages: res.body.global_meta.total_pages,
        total_records: res.body.global_meta.total_records,
        records,
      };
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
     * @param {bool} attachments
     *   Should quant find attachments.
     * @param {bool} skipPurge
     *   Skip CDN cache purge.
     * @param {object} extraHeaders
     *   Additional HTTP headers.
     * @param {string} encoding
     *   The encoding type.
     *
     * @return {object}
     *   The API response.
     */
    send: async function(file, location, published = true, attachments = false, skipPurge = false, extraHeaders = {}, encoding = 'utf-8') {
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
        return await this.markup(file, location, published, attachments, extraHeaders, encoding, skipPurge);
      } else {
        return await this.file(file, location, false, extraHeaders, skipPurge);
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
     * @param {bool} attachments
     *   Quant looking for attachments.
     * @param {object} extraHeaders
     *   Additional HTTP headers.
     * @param {string} encoding
     *   The encoding type.
     * @param {bool} skipPurge
     *   Skip CDN cache purge.
     *
     * @return {object}
     *   The API response.
     */
    markup: async function(file, location, published = true, attachments = false, extraHeaders = {}, encoding = 'utf-8', skipPurge = false) { // eslint-disable-line max-len
      if (!Buffer.isBuffer(file)) {
        if (!location) {
          const p = path.resolve(process.cwd(), config.get('dir'));
          // If a location isn't given, calculate it.
          location = path.relative(p, file);
        }
        if (!file.endsWith('index.html') && !location.endsWith('index.html')) {
          throw new Error('Can only upload an index.html file.');
        }
        file = fs.readFileSync(file, [encoding]);
      }

      const content = file.toString('utf8');
      location = location.startsWith('/') ? location : `/${location}`;

      if (skipPurge) {
        headers['Quant-Skip-Purge'] = 'true';
      }

      const options = {
        url: `${config.get('endpoint')}`,
        json: true,
        body: {
          url: location,
          find_attachments: attachments,
          content,
          published,
        },
        headers: {
          ...headers,
        },
      };

      if (Object.entries(extraHeaders).length > 0) {
        options.body.headers = extraHeaders;
      }

      const res = await post(options);
      return handleResponse(res);
    },

    /**
     * Send a file to the Quant API.
     *
     * @param {string} local
     *   File path on disk.
     * @param {string} location
     *   Accessible location.
     * @param {bool} absolute
     *   If the location is an absolute path.
     * @param {object} extraHeaders
     *   Additional HTTP headers.
     * @param {bool} skipPurge
     *   Skip CDN cache purge.
     *
     * @return {object}
     *   The successful payload.
     *
     * @throws Error
     */
    file: async function(local, location, absolute = false, extraHeaders = {}, skipPurge = false) {
      if (!Buffer.isBuffer(local)) {
        if (!location) {
          const p = path.resolve(process.cwd(), config.get('dir'));
          // If a location isn't given, calculate it.
          location = path.relative(p, local);
          location.replace(path.basename(location), '');
        }
        if (!fs.existsSync(local)) {
          throw new Error('File is not accessible.');
        }
        local = fs.createReadStream(local);
      }

      const formData = {
        data: local,
      };

      location = location.startsWith('/') ? location : `/${location}`;

      if (skipPurge) {
        headers['Quant-Skip-Purge'] = 'true';
      }

      const options = {
        url: config.get('endpoint'),
        json: true,
        headers: {
          ...headers,
          'Content-Type': 'multipart/form-data',
          'Quant-File-Url': location,
        },
        formData,
      };

      if (Object.entries(extraHeaders).length > 0) {
        options.headers['Quant-File-Headers'] = JSON.stringify(extraHeaders);
      }

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
        options.body.info = {author_user: author};
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

    /**
     * Delete a path from Quant.
     *
     * @param {string} path
     *
     * @return {object}
     *   The response object.
     *
     * @throw Error.
     */
    delete: async function(path) {
      path = path.replace('index.html', '');

      const options = {
        url: `${config.get('endpoint')}/delete/all`,
        headers: {
          ...headers,
          'Quant-Url': path,
        },
      };

      const res = await del(options);
      return handleResponse(res);
    },

    /**
     * Get the revision history from Quant.
     *
     * @param {string} url
     *   The URL path to get revisions for.
     * @param {string|bool} revision
     *   Retrieve a specific revision.
     *
     * @return {object}
     *   The response.
     *
     * @throws Error.
     */
    revisions: async function(url, revision = false) {
      const path = revision ? revision : 'published';

      url = url.indexOf('/') == 0 ? url : `/${url}`;
      url = url.toLowerCase();
      url = url.replace(/\/?index\.html/, '');

      const options = {
        url: `${config.get('endpoint')}/revisions/${path}`,
        headers: {
          ...headers,
          'Quant-Url': url,
        },
        json: true,
      };
      const res = await get(options);
      return handleResponse(res);
    },

    /**
     * Purge URL patterns from Quants Varnish.
     *
     * @param {string} urlPattern
     *
     * @throws Error
     */
    purge: async function(urlPattern) {
      const options = {
        url: `${config.get('endpoint')}/purge`,
        headers: {
          ...headers,
          'Quant-Url': urlPattern,
        },
      };
      const res = await post(options);
      return handleResponse(res);
    },
  };
};

module.exports = function() {
  return module.exports.client.apply(this, arguments); // eslint-disable-line
};

module.exports.client = client;
