import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs';
import path from 'path';
import os from 'os';
import mockClient from '../../mocks/quant-client.mjs';

const deploy = (await import('../../../src/commands/deploy.js')).default;
const config = (await import('../../../src/config.js')).default;
const md5File = (await import('md5-file')).default;

describe('Deploy Command', () => {
  let mockConfig;
  let mockClientInstance;
  let tempDir;

  beforeEach(() => {
    // Reset config state
    config.set({});

    // Create a temporary directory with test files for getFiles to find
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-test-'));
    fs.writeFileSync(path.join(tempDir, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(tempDir, 'styles.css'), 'body {}');
    fs.mkdirSync(path.join(tempDir, 'images'));
    fs.writeFileSync(path.join(tempDir, 'images', 'logo.png'), 'png-data');

    // Create mock config
    mockConfig = {
      set: sinon.stub(),
      get: (key) => ({
        endpoint: 'mock://api.quantcdn.io/v1',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token',
        dir: tempDir
      }[key]),
      fromArgs: sinon.stub().resolves(true),
      save: sinon.stub()
    };

    // Create mock client instance
    mockClientInstance = mockClient(mockConfig);

    // Mock md5File
    sinon.stub(md5File, 'sync').returns('test-md5-hash');

    // Stub console methods
    sinon.stub(console, 'log');
    sinon.stub(console, 'error');
  });

  afterEach(() => {
    sinon.restore();
    // Clean up temp directory
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('handler', () => {
    it('should deploy files successfully', async () => {
      const context = {
        config: mockConfig,
        client: () => mockClientInstance
      };

      const args = {
        dir: tempDir,
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
        config: mockConfig,
        client: () => mockClientInstance
      };

      const args = {
        dir: tempDir,
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
        config: mockConfig,
        client: () => mockClientInstance
      };

      const args = {
        dir: tempDir,
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
        config: mockConfig,
        client: () => mockClientInstance
      };

      const args = {
        dir: tempDir,
        'skip-unpublish': true,
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await deploy.handler.call(context, args);
      expect(result).to.equal('Deployment completed successfully');
    });

    it('should handle empty directory', async () => {
      // Create an empty temp dir
      const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-empty-'));

      const emptyConfig = {
        ...mockConfig,
        get: (key) => ({
          endpoint: 'mock://api.quantcdn.io/v1',
          clientid: 'test-client',
          project: 'test-project',
          token: 'test-token',
          dir: emptyDir
        }[key])
      };

      const context = {
        config: emptyConfig,
        client: () => mockClientInstance
      };

      const args = {
        dir: emptyDir,
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await deploy.handler.call(context, args);
      expect(result).to.equal('Deployment completed successfully');

      // Clean up
      fs.rmSync(emptyDir, { recursive: true, force: true });
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
        config: mockConfig,
        client: () => errorClientInstance
      };

      const args = {
        dir: tempDir,
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await deploy.handler.call(context, args);
      expect(result).to.equal('Deployment completed successfully');
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
          fromArgs: async () => false,
          get: () => null
        },
        client: () => mockClientInstance
      };

      const args = {
        dir: tempDir,
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
        dir: tempDir,
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await deploy.handler.call(context, args);
      expect(result).to.equal('Deployment completed successfully');
    });

    it('should handle skip-unpublish-regex', async () => {
      const context = {
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
        dir: tempDir,
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
