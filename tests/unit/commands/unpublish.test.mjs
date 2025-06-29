import { expect } from 'chai';
import sinon from 'sinon';
import _fs from 'fs';
import _path from 'path';
import mockClient from '../../mocks/quant-client.mjs';
import stripAnsi from 'strip-ansi';

const unpublish = (await import('../../../src/commands/unpublish.js')).default;
const config = (await import('../../../src/config.js')).default;

describe('Unpublish Command', () => {
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
    it('should unpublish a path', async () => {
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

      const result = await unpublish.handler.call(context, args);
      expect(stripAnsi(result)).to.equal('Successfully unpublished [/about]');
      expect(mockClientInstance._history.post.length).to.equal(1);
      const [call] = mockClientInstance._history.post;
      expect(call.headers['Quant-Url']).to.equal('/about');
    });

    it('should handle missing args', async () => {
      const context = {
        config: mockConfig,
        client: () => mockClientInstance,
        promptArgs: async () => null
      };

      try {
        await unpublish.handler.call(context, null);
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
        await unpublish.handler.call(context, args);
        expect.fail('Process exited with code 1');
      } catch (err) {
        expect(err.message).to.equal('Process exited with code 1');
      } finally {
        process.exit = exit;
      }
    });

    it('should handle already unpublished paths', async () => {
      const errorClientInstance = mockClient(mockConfig);
      errorClientInstance.unpublish = async () => {
        throw {
          response: {
            status: 404,
            data: {
              errorMsg: 'not found'
            }
          }
        };
      };

      const context = {
        config: mockConfig,
        client: () => errorClientInstance
      };

      const args = {
        path: '/already-unpublished',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await unpublish.handler.call(context, args);
      expect(stripAnsi(result)).to.equal('Path [/already-unpublished] does not exist or is already unpublished');
    });

    it('should handle general errors', async () => {
      const errorClientInstance = mockClient(mockConfig);
      errorClientInstance.unpublish = async () => {
        throw new Error('Failed to unpublish');
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
        await unpublish.handler.call(context, args);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).to.include('Failed to unpublish');
      }
    });
  });
}); 