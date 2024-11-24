/**
 * Mock Quant client for testing.
 */
export default function (config) {
  // Store request history for assertions
  const history = {
    get: [],
    post: [],
    patch: []
  };

  // Mock responses
  const responses = {
    ping: { project: 'test-project' },
    meta: {
      global_meta: {
        records: [
          { url: 'test/index.html' }
        ],
        total_pages: 1,
        total_records: 3
      }
    }
  };

  return {
    // Store request for assertions
    _history: history,

    // Mock API methods
    ping: async function() {
      console.log('Mock client: ping called');
      history.get.push({ url: '/ping' });
      return responses.ping;
    },

    meta: async function() {
      console.log('Mock client: meta called');
      history.get.push({ url: '/global-meta' });
      return responses.meta;
    },

    send: async function(file, url, force = false, findAttachments = false) {
      console.log('Mock client: send called', { file, url, force, findAttachments });
      history.post.push({
        url: '/',
        headers: {
          'Force-Deploy': force,
          'Find-Attachments': findAttachments
        },
        data: { file, url }
      });
      return { success: true };
    },

    batchMeta: async function() {
      console.log('Mock client: batchMeta called');
      history.get.push({ url: '/global-meta' });
      return responses.meta;
    },

    unpublish: async function(url) {
      console.log('Mock client: unpublish called', { url });
      history.post.push({
        url: '/unpublish',
        data: { url }
      });
      return { success: true };
    }
  };
} 