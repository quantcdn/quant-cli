import { expect } from 'chai';
import _fs from 'fs';
import _path from 'path';
import sinon from 'sinon';
import mockClient from '../../mocks/quant-client.mjs';

const file = (await import('../../../src/commands/file.js')).default;
const config = (await import('../../../src/config.js')).default;

describe('File Command', () => {
  let mockFs;
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
        token: 'test-token',
        dir: 'build'
      }[key]),
      fromArgs: sinon.stub().resolves(true),
      save: sinon.stub()
    };

    // Create mock client instance
    mockClientInstance = mockClient(mockConfig);

    // Mock file system
    mockFs = {
      readFileSync: sinon.stub().returns('test content'),
      existsSync: sinon.stub().returns(true),
      createReadStream: sinon.stub().returns('test content'),
      statSync: sinon.stub().returns({ isFile: () => true })
    };
  });

  describe('handler', () => {
    it('should deploy a single file', async function() {
      const context = {
        fs: mockFs,
        config: mockConfig,
        client: () => mockClientInstance
      };

      const args = {
        file: 'test.css',
        location: '/css/test.css',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await file.handler.call(context, args);
      expect(result).to.equal('Added [test.css]');
      expect(mockClientInstance._history.post.length).to.equal(1);
      
      const [call] = mockClientInstance._history.post;
      expect(call.headers['Quant-File-Url']).to.equal('/css/test.css');
    });

    it('should prompt for missing file and location', async function() {
      const context = {
        fs: mockFs,
        config: mockConfig,
        client: () => mockClientInstance,
        promptArgs: async () => ({
          file: 'prompted.css',
          location: '/css/prompted.css'
        })
      };

      const args = {
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await file.handler.call(context, args);
      expect(result).to.equal('Added [prompted.css]');
      
      const [call] = mockClientInstance._history.post;
      expect(call.headers['Quant-File-Url']).to.equal('/css/prompted.css');
    });

    it('should handle cancelled prompt', async function() {
      const context = {
        fs: mockFs,
        config: mockConfig,
        client: () => mockClientInstance,
        promptArgs: async () => null
      };

      const args = {
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      try {
        await file.handler.call(context, args);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).to.equal('Operation cancelled');
      }
    });

    it('should handle file already exists error', async function() {
      const errorClientInstance = mockClient(mockConfig);
      errorClientInstance.file = async () => {
        throw new Error('File exists');
      };

      const context = {
        fs: mockFs,
        config: mockConfig,
        client: () => errorClientInstance
      };

      const args = {
        file: 'test.css',
        location: '/css/test.css',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      try {
        await file.handler.call(context, args);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).to.include('exists at location');
      }
    });

    it('should handle missing args', async function() {
      const context = {
        fs: mockFs,
        config: mockConfig,
        client: () => mockClientInstance,
        promptArgs: async () => null
      };

      try {
        await file.handler.call(context, null);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).to.equal('Operation cancelled');
      }
    });

    it('should handle config fromArgs failure', async function() {
      const exit = process.exit;
      process.exit = (_code) => {
        process.exit = exit;
        throw new Error('Process exited with code 1');
      };

      const context = {
        fs: mockFs,
        config: {
          ...mockConfig,
          fromArgs: async () => false
        },
        promptArgs: async () => null,
        client: () => {
          throw new Error('Client factory should not be called when config fails');
        }
      };

      const args = {
        file: 'test.css',
        location: '/css/test.css',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      try {
        await file.handler.call(context, args);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).to.equal('Process exited with code 1');
      } finally {
        process.exit = exit;
      }
    });
  });
}); 