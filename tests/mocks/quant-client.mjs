/**
 * Mock Quant client for testing.
 */
export default function (_config) {
  const history = {
    get: [],
    post: [],
    patch: [],
    delete: []
  };

  const client = {
    _history: history,

    file: async function(filePath, location) {
      history.post.push({
        url: '/file',
        headers: {
          'Quant-File-Url': location
        },
        data: filePath
      });
      return { success: true };
    },

    markup: async function(filePath, location) {
      history.post.push({
        url: '/markup',
        headers: {
          'Quant-File-Url': location
        },
        data: filePath
      });
      return { success: true };
    },

    send: async function(filePath, location, force = false, findAttachments = false, skipPurge = false, enableIndexHtml = false) {
      history.post.push({
        url: '/send',
        headers: {
          'Quant-File-Url': location,
          'Force-Deploy': force,
          'Find-Attachments': findAttachments,
          'Skip-Purge': skipPurge,
          'Enable-Index-Html': enableIndexHtml
        },
        data: filePath
      });
      return {
        url: location,
        md5: 'test-md5',
        success: true
      };
    },

    meta: async function(unfold = false, exclude = true, extend = {}) {
      history.get.push({
        url: '/meta',
        params: { unfold, exclude, ...extend }
      });
      return {
        records: [
          { url: '/test.html', type: 'file' },
          { url: '/css/style.css', type: 'file' },
          { url: '/images/logo.png', type: 'file' }
        ],
        total_pages: 1,
        total_records: 3
      };
    },

    ping: async function() {
      return { project: 'test-project' };
    },

    unpublish: async function(url) {
      history.post.push({
        url: '/unpublish',
        headers: { 'Quant-Url': url }
      });
      return { success: true };
    },

    // Additional methods from real client
    batchMeta: async function(urls) {
      history.post.push({
        url: '/batch-meta',
        data: { urls }
      });
      return { success: true };
    },

    purge: async function(url, cacheKeys, options = {}) {
      history.post.push({
        url: '/purge',
        headers: {
          'Quant-Url': url,
          'Cache-Keys': cacheKeys,
          'Soft-Purge': options.softPurge
        }
      });
      return { success: true };
    },

    searchIndex: async function(data) {
      history.post.push({
        url: '/search',
        data
      });
      return { success: true };
    },

    searchRemove: async function(url) {
      history.delete.push({
        url: '/search',
        headers: { 'Quant-Url': url }
      });
      return { success: true };
    },

    redirect: async function(from, to, _headers = null, status = 302) {
      history.post.push({
        url: '/redirect',
        headers: {
          'Quant-From-Url': from,
          'Quant-To-Url': to,
          'Quant-Status': status
        }
      });
      return { success: true, uuid: 'mock-uuid-123' };
    }
  };

  return client;
} 