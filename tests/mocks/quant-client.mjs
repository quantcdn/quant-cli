/**
 * Mock Quant client for testing.
 */
export default function (config) {
  const history = {
    get: [],
    post: [],
    patch: []
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

    send: async function(filePath, location, force = false, findAttachments = false) {
      history.post.push({
        url: '/send',
        headers: {
          'Quant-File-Url': location,
          'Force-Deploy': force,
          'Find-Attachments': findAttachments
        },
        data: filePath
      });
      return { success: true };
    },

    meta: async function() {
      history.get.push({ url: '/meta' });
      return {
        records: [],
        total_pages: 0,
        total_records: 0
      };
    },

    ping: async function() {
      history.get.push({ url: '/ping' });
      return { project: 'test-project' };
    },

    unpublish: async function(url) {
      history.post.push({
        url: '/unpublish',
        headers: { 'Quant-Url': url }
      });
      return { success: true };
    }
  };

  return client;
} 