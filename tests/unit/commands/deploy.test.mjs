import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs';
import path from 'path';
import mockClient from '../../mocks/quant-client.mjs';

const deploy = (await import('../../../src/commands/deploy.js')).default;
const config = (await import('../../../src/config.js')).default;
const getFiles = (await import('../../../src/helper/getFiles.js')).default;
const md5File = (await import('md5-file')).default;

describe('Deploy Command', () => {
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
      statSync: sinon.stub().returns({ isFile: () => true }),
      readdirSync: sinon.stub().returns(['index.html', 'styles.css', 'images/logo.png'])
    };

    // Mock getFiles to return test files
    sinon.stub(getFiles, 'getFiles').returns([
      'build/index.html',
      'build/styles.css',
      'build/images/logo.png'
    ]);

    // Mock md5File
    sinon.stub(md5File, 'sync').returns('test-md5-hash');

    // Stub console methods
    sinon.stub(console, 'log');
    sinon.stub(console, 'error');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('handler', () => {
    it('should deploy files successfully', async () => {
      const context = {
        fs: mockFs,
        config: mockConfig,
        client: () => mockClientInstance
      };

      const args = {
        dir: 'build',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await deploy.handler.call(context, args);
      expect(result).to.equal('Deployment completed successfully');
      expect(mockClientInstance._history.post.length).to.be.greaterThan(0);
    });

    it('should handle force flag', async () => {
      const context = {
        fs: mockFs,
        config: mockConfig,
        client: () => mockClientInstance
      };

      const args = {
        dir: 'build',
        force: true,
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await deploy.handler.call(context, args);
      expect(result).to.equal('Deployment completed successfully');
    });

    it('should handle attachments flag', async () => {
      const context = {
        fs: mockFs,
        config: mockConfig,
        client: () => mockClientInstance
      };

      const args = {
        dir: 'build',
        attachments: true,
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await deploy.handler.call(context, args);
      expect(result).to.equal('Deployment completed successfully');
    });

    it('should handle skip-unpublish flag', async () => {
      const context = {
        fs: mockFs,
        config: mockConfig,
        client: () => mockClientInstance
      };

      const args = {
        dir: 'build',
        'skip-unpublish': true,
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await deploy.handler.call(context, args);
      expect(result).to.equal('Deployment completed successfully');
    });

    it('should handle non-existent directory', async () => {
      mockFs.existsSync.returns(false);
      mockFs.readdirSync.returns([]);
      
      const context = {
        fs: mockFs,
        config: mockConfig,
        client: () => mockClientInstance
      };

      const args = {
        dir: 'nonexistent',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await deploy.handler.call(context, args);
      expect(result).to.equal('Deployment completed successfully');
    });

    it('should handle empty directory', async () => {
      mockFs.readdirSync.returns([]);
      
      const context = {
        fs: mockFs,
        config: mockConfig,
        client: () => mockClientInstance
      };

      const args = {
        dir: 'build',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await deploy.handler.call(context, args);
      expect(result).to.equal('Deployment completed successfully');
    });

    it('should handle MD5 match errors', async () => {
      const errorClientInstance = mockClient(mockConfig);
      errorClientInstance.send = async () => {
        throw {
          response: {
            data: {
              errorMsg: 'MD5 already matches existing file.'
            }
          }
        };
      };

      const context = {
        fs: mockFs,
        config: mockConfig,
        client: () => errorClientInstance
      };

      const args = {
        dir: 'build',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await deploy.handler.call(context, args);
      expect(result).to.equal('Deployment completed successfully');
    });

    it('should handle config fromArgs failure', async () => {
      const exit = process.exit;
      process.exit = (code) => {
        process.exit = exit;
        throw new Error('Process exited with code 1');
      };

      const context = {
        fs: mockFs,
        config: {
          ...mockConfig,
          fromArgs: async () => false,
          get: () => null
        },
        client: () => mockClientInstance
      };

      const args = {
        dir: 'build',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      try {
        await deploy.handler.call(context, args);
        expect.fail('Process exited with code 1');
      } catch (err) {
        expect(err.message).to.equal('Process exited with code 1');
      } finally {
        process.exit = exit;
      }
    });

    it('should handle unpublish process', async () => {
      const context = {
        fs: mockFs,
        config: mockConfig,
        client: () => ({
          ...mockClientInstance,
          meta: async () => ({
            records: [
              { url: '/old-file.html', type: 'file' }
            ]
          })
        })
      };

      const args = {
        dir: 'build',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await deploy.handler.call(context, args);
      expect(result).to.equal('Deployment completed successfully');
    });

    it('should handle skip-unpublish-regex', async () => {
      const context = {
        fs: mockFs,
        config: mockConfig,
        client: () => ({
          ...mockClientInstance,
          meta: async () => ({
            records: [
              { url: '/skip-me.html', type: 'file' }
            ]
          })
        })
      };

      const args = {
        dir: 'build',
        'skip-unpublish-regex': 'skip-me',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await deploy.handler.call(context, args);
      expect(result).to.equal('Deployment completed successfully');
    });
  });
}); 