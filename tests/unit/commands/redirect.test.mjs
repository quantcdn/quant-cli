import { expect } from 'chai';
import sinon from 'sinon';
import _fs from 'fs';
import _path from 'path';
import mockClient from '../../mocks/quant-client.mjs';

const redirect = (await import('../../../src/commands/redirect.js')).default;
const config = (await import('../../../src/config.js')).default;

describe('Redirect Command', () => {
  let mockConfig;
  let mockClientInstance;

  beforeEach(() => {
    // Reset config state
    config.set({});

    // Create mock config
    mockConfig = {
      set: sinon.stub(),
      get: (key) => ({
        endpoint: 'mock://api.quantcdn.io/v1',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      })[key],
      fromArgs: sinon.stub().resolves(true),
      save: sinon.stub()
    };

    // Create mock client instance
    mockClientInstance = mockClient(mockConfig);

    // Stub console methods
    sinon.stub(console, 'log');
    sinon.stub(console, 'error');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('handler', () => {
    it('should create a redirect', async () => {
      const context = {
        config: mockConfig,
        client: () => mockClientInstance
      };

      const args = {
        from: '/old-path',
        to: '/new-path',
        status: 301,
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await redirect.handler.call(context, args);
      expect(result).to.include('Created redirect from /old-path to /new-path (301)');
      expect(mockClientInstance._history.post.length).to.equal(1);
    });

    it('should handle MD5 match errors', async () => {
      const errorClientInstance = mockClient(mockConfig);
      errorClientInstance.redirect = async () => {
        throw {
          response: {
            data: {
              errorMsg: 'Published version already has md5: abc123'
            }
          }
        };
      };

      const context = {
        config: mockConfig,
        client: () => errorClientInstance
      };

      const args = {
        from: '/old-path',
        to: '/new-path',
        status: 301,
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await redirect.handler.call(context, args);
      expect(result).to.include('Skipped redirect from /old-path to /new-path (already exists)');
    });

    it('should handle missing args', async () => {
      const context = {
        config: mockConfig,
        client: () => mockClientInstance,
        promptArgs: async () => null
      };

      try {
        await redirect.handler.call(context, null);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).to.equal('Operation cancelled');
      }
    });

    it('should handle config fromArgs failure', async () => {
      const exit = process.exit;
      process.exit = (_code) => {
        process.exit = exit;
        throw new Error('Process exited with code 1');
      };

      const context = {
        config: {
          ...mockConfig,
          fromArgs: async () => false
        }
      };

      const args = {
        from: '/old-path',
        to: '/new-path',
        status: 301
      };

      try {
        await redirect.handler.call(context, args);
        expect.fail('Process exited with code 1');
      } catch (err) {
        expect(err.message).to.equal('Process exited with code 1');
      } finally {
        process.exit = exit;
      }
    });

    it('should handle general errors', async () => {
      const errorClientInstance = mockClient(mockConfig);
      errorClientInstance.redirect = async () => {
        throw new Error('Failed to create redirect');
      };

      const context = {
        config: mockConfig,
        client: () => errorClientInstance
      };

      const args = {
        from: '/old-path',
        to: '/new-path',
        status: 301,
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      try {
        await redirect.handler.call(context, args);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).to.include('Failed to create redirect');
      }
    });

    it('should use default status code if not provided', async () => {
      const context = {
        config: mockConfig,
        client: () => mockClientInstance
      };

      const args = {
        from: '/old-path',
        to: '/new-path'
      };

      const result = await redirect.handler.call(context, args);
      expect(result).to.include('Created redirect from /old-path to /new-path (302)');
      expect(mockClientInstance._history.post.length).to.equal(1);
      const [call] = mockClientInstance._history.post;
      expect(call.headers['Quant-Status']).to.equal(302);
    });
  });
});
