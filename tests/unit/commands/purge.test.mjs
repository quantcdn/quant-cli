import { expect } from 'chai';
import sinon from 'sinon';
import _fs from 'fs';
import _path from 'path';
import mockClient from '../../mocks/quant-client.mjs';

const purge = (await import('../../../src/commands/purge.js')).default;
const config = (await import('../../../src/config.js')).default;

describe('Purge Command', () => {
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
    it('should purge a single path', async () => {
      const context = {
        config: mockConfig,
        client: () => mockClientInstance
      };

      const args = {
        path: '/about',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await purge.handler.call(context, args);
      expect(result).to.equal('Successfully purged /about');
      expect(mockClientInstance._history.post.length).to.equal(1);
      const [call] = mockClientInstance._history.post;
      expect(call.headers['Quant-Url']).to.equal('/about');
    });

    it('should handle soft purge option', async () => {
      const context = {
        config: mockConfig,
        client: () => mockClientInstance
      };

      const args = {
        path: '/about',
        'soft-purge': true,
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await purge.handler.call(context, args);
      expect(result).to.equal('Successfully purged /about');
      expect(mockClientInstance._history.post.length).to.equal(1);
      const [call] = mockClientInstance._history.post;
      expect(call.headers['Soft-Purge']).to.be.true;
    });

    it('should handle cache keys', async () => {
      const context = {
        config: mockConfig,
        client: () => mockClientInstance
      };

      const args = {
        'cache-keys': 'key1 key2',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await purge.handler.call(context, args);
      expect(result).to.equal('Successfully purged cache keys: key1 key2');
      expect(mockClientInstance._history.post.length).to.equal(1);
      const [call] = mockClientInstance._history.post;
      expect(call.headers['Cache-Keys']).to.equal('key1 key2');
    });

    it('should handle missing args', async () => {
      const context = {
        config: mockConfig,
        client: () => mockClientInstance,
        promptArgs: async () => null
      };

      try {
        await purge.handler.call(context, null);
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
        path: '/about',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      try {
        await purge.handler.call(context, args);
        expect.fail('Process exited with code 1');
      } catch (err) {
        expect(err.message).to.equal('Process exited with code 1');
      } finally {
        process.exit = exit;
      }
    });

    it('should handle general errors', async () => {
      const errorClientInstance = mockClient(mockConfig);
      errorClientInstance.purge = async () => {
        throw new Error('Failed to purge');
      };

      const context = {
        config: mockConfig,
        client: () => errorClientInstance
      };

      const args = {
        path: '/about',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      try {
        await purge.handler.call(context, args);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).to.include('Failed to purge');
      }
    });
  });
}); 