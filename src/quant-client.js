/**
 * A quant client.
 */

const axios = require("axios");
const util = require("util");
const fs = require("fs");
const path = require("path");
const mime = require("mime-types");
const querystring = require("querystring");
const quantURL = require("./helper/quant-url");

const client = function (config) {
  const req = axios;
  const get = axios.get;
  const post = axios.post;
  const patch = axios.patch;
  const del = axios.delete;

  const headers = {
    "User-Agent": "Quant (+http://api.quantcdn.io)",
    "Quant-Token": config.get("token"),
    "Quant-Customer": config.get("clientid"),
    "Quant-Organisation": config.get("clientid"),
    "Quant-Project": config.get("project"),
    "Content-Type": "application/json",
  };

  if (config.get("bearer")) {
    headers.Authorization = `Bearer ${config.get("bearer")}`;
  }

  /**
   * Handle the response.
   *
   * @param {string} response
   *   Response body from the Quant API.
   *
   * @return {object}
   *   The API response.
   */
  const handleResponse = function (response) {
    const body =
      typeof response.data == "string"
        ? JSON.parse(response.data)
        : response.data;

    if (typeof body.errors != "undefined") {
      let msg = "";
      for (i in body.errors) {
        msg += body.errors[i].errorMsg + "\n";
      }
      throw new Error(msg);
    }

    if (response.statusCode == 400) {
      // @TODO: this is generally if the content is
      // streamed to the endpoint 4xx and 5xx are thrown
      // similarly, the API should respond with errors
      // otherwise.
      if (typeof body.errorMsg != "undefined") {
        throw new Error(body.errorMsg);
      }
      throw new Error("Critical error...");
    }

    if (body.error || (typeof body.errorMsg != "undefined" && body.errorMsg.length > 0)) {
      const msg = typeof body.errorMsg != "undefined" ? body.errorMsg : body.msg;
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
    ping: async function () {
      const url = `${config.get("endpoint")}/ping`;
      const res = await get(url, { headers });
      return handleResponse(res);
    },

    /**
     * Access the global meta for the project.
     *
     * @param {bool} unfold
     *   Unfold the record set.
     * @param {bool} exclude
     *   Exclude delete objects from the meta result.
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
    meta: async function (unfold = false, exclude = true, extend = {}) {
      const records = [];
      const query = Object.assign(
        {
          page_size: 500,
          published: true,
          deleted: false,
          sort_field: "last_modified",
          sort_direction: "desc",
        },
        extend,
      );
      const url = `${config.get("endpoint")}/global-meta?${querystring.stringify(query)}`;
      const doUnfold = async function (i) {
        const res = await get(`${url}&page=${i}`, { headers });
        if (res.data.global_meta && res.data.global_meta.records) {
          res.data.global_meta.records.map((item) =>
            records.push({
              url: item.meta.url,
              md5: item.meta.md5,
              type: item.meta.type,
            }),
          );
        }
      };

      let page = 1;
      // Seed the record set.
      const res = await get(`${url}&page=${page}`, { headers });

      if (!res.data.global_meta) {
        // If no records have been published then global_meta is not
        // present in the response.
        return;
      }

      if (res.data.global_meta.records) {
        res.data.global_meta.records.map((item) =>
          records.push({
            url: item.meta.url,
            md5: item.meta.md5,
            type: item.meta.type,
          }),
        );
      }

      if (unfold) {
        page++;
        while (res.data.global_meta.total_pages >= page) {
          await doUnfold(page);
          page++;
        }
      }

      return {
        total_pages: res.data.global_meta.total_pages,
        total_records: res.data.global_meta.total_records,
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
     * @param {bool} includeIndex
     *   Include index.html suffix on HTML assets.
     * @param {object} extraHeaders
     *   Additional HTTP headers.
     * @param {string} encoding
     *   The encoding type.
     *
     * @return {object}
     *   The API response.
     */
    send: async function (
      file,
      location,
      published = true,
      attachments = false,
      skipPurge = false,
      includeIndex = false,
      extraHeaders = {},
      encoding = "utf-8",
    ) {
      const mimeType = mime.lookup(file);
      if (mimeType == "text/html") {
        if (!location) {
          const p = path.resolve(process.cwd(), config.get("dir"));
          // If a location isn't given, calculate it.
          location = path.relative(p, file);
        }

        location = quantURL.prepare(location);

        if (!location.endsWith(".html") && includeIndex) {
          location = `${location}/index.html`;
          location = location.replace(/^\/\//, "/");
        }

        return await this.markup(
          file,
          location,
          published,
          attachments,
          extraHeaders,
          encoding,
          skipPurge,
        );
      } else {
        return await this.file(file, location, false, extraHeaders, skipPurge);
      }
    },

    /**
     * Upload markup.
     *
     * @param {string} file
     *   Filepath on disk.
     * @param {string} location
     *   The web accessible destination.
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
    markup: async function (
      file,
      location,
      published = true,
      attachments = false,
      extraHeaders = {},
      encoding = "utf-8",
      skipPurge = false,
    ) {
      if (!Buffer.isBuffer(file)) {
        if (!location) {
          const p = path.resolve(process.cwd(), config.get("dir"));
          // If a location isn't given, calculate it.
          location = path.relative(p, file);
        }
        file = fs.readFileSync(file, [encoding]);
      }

      const content = file.toString("utf8");
      location = location.startsWith("/") ? location : `/${location}`;

      if (skipPurge) {
        headers["Quant-Skip-Purge"] = "true";
      }

      const options = {
        url: `${config.get("endpoint")}`,
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

      const res = await post(options.url, options.body, {
        headers: options.headers,
      });
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
    file: async function (
      local,
      location,
      absolute = false,
      extraHeaders = {},
      skipPurge = false,
    ) {
      if (!Buffer.isBuffer(local)) {
        if (!location) {
          const p = path.resolve(process.cwd(), config.get("dir"));
          // If a location isn't given, calculate it.
          location = path.relative(p, local);
          location.replace(path.basename(location), "");
        }
        if (!fs.existsSync(local)) {
          throw new Error("File is not accessible.");
        }
        local = fs.createReadStream(local);
      }

      const formData = {
        data: local,
      };

      location = location.startsWith("/") ? location : `/${location}`;

      if (skipPurge) {
        headers["Quant-Skip-Purge"] = "true";
      }

      const options = {
        url: config.get("endpoint"),
        json: true,
        headers: {
          ...headers,
          "Content-Type": "multipart/form-data",
          "Quant-File-Url": location,
        },
        formData,
      };

      if (Object.entries(extraHeaders).length > 0) {
        options.headers["Quant-File-Headers"] = JSON.stringify(extraHeaders);
      }

      const res = await post(options.url, options.formData, {
        headers: options.headers,
      });
      return handleResponse(res);
    },

    /**
     * Change the status of an asset.
     *
     * @param {string} location
     *   The URL location of the content.
     * @param {string} revision
     *   The revision to publish.
     *
     * @return {object}
     *   API payload.
     *
     * @throws Error.
     */
    publish: async function (location, revision) {
      const url = quantURL.prepare(location);

      if (!revision) {
        throw Error("Invalid revision ID provided.");
      }

      const options = {
        url: `${config.get("endpoint")}/publish/${revision}`,
        headers: {
          ...headers,
          "Quant-Url": url,
        },
        json: true,
      };
      const res = await patch(options.url, {}, { headers: options.headers });
      return handleResponse(res);
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
    unpublish: async function (url) {
      url = quantURL.prepare(url);

      const options = {
        url: `${config.get("endpoint")}/unpublish`,
        headers: {
          ...headers,
          "Quant-Url": url,
        },
        json: true,
      };

      const res = await patch(options.url, {}, { headers: options.headers });
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
    redirect: async function (from, to, author, status = 302) {
      const options = {
        url: `${config.get("endpoint")}/redirect`,
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
        throw new Error("A valid redirect status code is required");
      }

      if (author) {
        options.body.info = { author_user: author };
      }

      const res = await post(options.url, options.body, {
        headers: options.headers,
      });
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
    proxy: async function (
      url,
      destination,
      published = true,
      username,
      password,
    ) {
      const options = {
        url: `${config.get("endpoint")}/proxy`,
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

      const res = await post(options.url, options.body, {
        headers: options.headers,
      });
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
    delete: async function (path) {
      path = path.replace("index.html", "");

      const options = {
        url: `${config.get("endpoint")}/delete/all`,
        headers: {
          ...headers,
          "Quant-Url": path,
        },
      };

      const res = await del(options.url, { headers: options.headers });
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
    revision: async function (url, revision = false) {
      const path = revision ? revision : "published";

      url = url.indexOf("/") == 0 ? url : `/${url}`;
      url = url.toLowerCase();
      url = url.replace(/\/?index\.html/, "");

      const options = {
        url: `${config.get("endpoint")}/revisions/${path}`,
        headers: {
          ...headers,
          "Quant-Url": url,
        },
      };
      const res = await get(options.url, { headers: options.headers });
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
    revisions: async function (url) {
      url = url.indexOf("/") == 0 ? url : `/${url}`;
      url = url.toLowerCase();
      url = url.replace(/\/?index\.html/, "");

      const options = {
        url: `${config.get("endpoint")}/revisions`,
        headers: {
          ...headers,
          "Quant-Url": url,
        },
      };
      const res = await get(options.url, { headers: options.headers });
      return handleResponse(res);
    },

    /**
     * Purge URL patterns from Quants Varnish.
     *
     * @param {string} urlPattern
     *
     * @throws Error
     */
    purge: async function (urlPattern) {
      const options = {
        url: `${config.get("endpoint")}/purge`,
        headers: {
          ...headers,
          "Quant-Url": urlPattern,
        },
      };
      const res = await post(options.url, {}, { headers: options.headers });
      return handleResponse(res);
    },

    /**
     * Add/update items in search index.
     *
     * @param {string} filePath
     *
     * @throws Error
     */
    searchIndex: async function (filePath) {
      let data = "";

      // filePath is a JSON file we send the raw content of.
      try {
        data = JSON.parse(fs.readFileSync(filePath, "utf8"));
      } catch (err) {
        console.error(err);
        return;
      }

      const options = {
        url: `${config.get("endpoint")}/search`,
        headers: {
          ...headers,
        },
        body: data,
      };
      const res = await post(options.url, options.body, {
        headers: options.headers,
      });

      return handleResponse(res);
    },

    /**
     * Remove item from search index.
     *
     * @param {string} url
     *
     * @throws Error
     */
    searchRemove: async function (url) {
      const options = {
        url: `${config.get("endpoint")}/search`,
        headers: {
          ...headers,
          "Quant-Url": url,
        },
      };
      const res = await del(options.url, { headers: options.headers });

      return handleResponse(res);
    },

    /**
     * Clear search index.
     *
     * @throws Error
     */
    searchClearIndex: async function () {
      const options = {
        url: `${config.get("endpoint")}/search/all`,
        headers: {
          ...headers,
        },
        json: true,
      };
      const res = await del(options.url, { headers: options.headers });

      return handleResponse(res);
    },

    /**
     * Retrieve search index status.
     *
     * @throws Error
     */
    searchStatus: async function () {
      const options = {
        url: `${config.get("endpoint")}/search`,
        headers: {
          ...headers,
        },
        json: true,
      };
      const res = await get(options.url, { headers: options.headers });

      return handleResponse(res);
    },

    /**
     * Access WAF logs for the project.
     *
     * @param {bool} unfold
     *   Unfold the record set.
     * @param {object} extend
     *   Additional query parameters to set for the request.
     *
     * @return {object}
     *   A list of all WAF logs.
     */
    wafLogs: async function (unfold = false, extend = {}) {
      const logs = [];
      const url = `${config.get("endpoint")}/waf/logs`;
      const query = Object.assign(
        {
          per_page: 10,
        },
        extend,
      );
      const doUnfold = async function (i) {
        let res;
        query.page = i;
        try {
          res = await get(`${url}?${querystring.stringify(query)}`, {
            headers,
          });
        } catch (err) {
          console.log(err);
          return false;
        }
        if (res.data.data) {
          logs.push(...res.data.data);
        }
        return res.data.next != "";
      };

      const options = {
        url: `${url}?${querystring.stringify(query)}`,
        headers,
      };

      const res = await get(options, url, { headers: options.headers });

      if (res.statusCode == 403) {
        return -1;
      }

      if (
        typeof res.data == "undefined" ||
        typeof res.data.data == "undefined"
      ) {
        return logs;
      }

      logs.push(...res.data.data);
      let page = 1;
      if (unfold && res.data.next != "") {
        let more;
        do {
          page++;
          more = await doUnfold(page);
        } while (more && page <= 100);
      }
      return logs;
    },
  };
};

module.exports = function () {
  return module.exports.client.apply(this, arguments);
};

module.exports.client = client;
