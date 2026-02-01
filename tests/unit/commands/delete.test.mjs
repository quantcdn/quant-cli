import { expect } from 'chai';
import sinon from 'sinon';
import _fs from 'fs';
import _path from 'path';
import mockClient from '../../mocks/quant-client.mjs';

const deleteCommand = (await import('../../../src/commands/delete.js')).default;
const config = (await import('../../../src/config.js')).default;

describe('Delete Command', () => {
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
    it('should delete a path with force flag', async () => {
      const context = {
        config: mockConfig,
        client: () => mockClientInstance
      };

      const args = {
        path: '/about',
        force: true,
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await deleteCommand.handler.call(context, args);
      expect(result).to.include('Successfully removed [/about]');
      expect(mockClientInstance._history.delete.length).to.equal(1);
      const [call] = mockClientInstance._history.delete;
      expect(call.headers['Quant-Url']).to.equal('/about');
    });

    it('should handle missing args', async () => {
      const context = {
        config: mockConfig,
        client: () => mockClientInstance,
        promptArgs: async () => null
      };

      try {
        await deleteCommand.handler.call(context, null);
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
        force: true,
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      try {
        await deleteCommand.handler.call(context, args);
        expect.fail('Process exited with code 1');
      } catch (err) {
        expect(err.message).to.equal('Process exited with code 1');
      } finally {
        process.exit = exit;
      }
    });

    it('should handle already deleted paths', async () => {
      const errorClientInstance = mockClient(mockConfig);
      errorClientInstance.delete = async () => ({
        meta: [{
          deleted_timestamp: '2024-01-01'
        }]
      });

      const context = {
        config: mockConfig,
        client: () => errorClientInstance
      };

      const args = {
        path: '/already-deleted',
        force: true,
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await deleteCommand.handler.call(context, args);
      expect(result).to.include('was already deleted');
    });

    it('should handle general errors', async () => {
      const errorClientInstance = mockClient(mockConfig);
      errorClientInstance.delete = async () => {
        throw new Error('Failed to delete');
      };

      const context = {
        config: mockConfig,
        client: () => errorClientInstance
      };

      const args = {
        path: '/about',
        force: true,
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      try {
        await deleteCommand.handler.call(context, args);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).to.include('Cannot delete path');
      }
    });
  });
});
