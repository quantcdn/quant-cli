import { expect } from 'chai';
import sinon from 'sinon';
import _fs from 'fs';
import _path from 'path';
import mockClient from '../../mocks/quant-client.mjs';

const page = (await import('../../../src/commands/page.js')).default;
const config = (await import('../../../src/config.js')).default;

describe('Page Command', () => {
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
        enableIndexHtml: false
      }[key]),
      fromArgs: sinon.stub().resolves(true),
      save: sinon.stub()
    };

    // Create mock client instance using the shared mock
    mockClientInstance = mockClient(mockConfig);

    // Mock file system
    mockFs = {
      readFileSync: sinon.stub().returns('test content'),
      existsSync: sinon.stub().returns(true),
      createReadStream: sinon.stub().returns('test content'),
      statSync: sinon.stub().returns({ isFile: () => true })
    };

    // Stub console methods
    sinon.stub(console, 'log');
    sinon.stub(console, 'error');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('handler', () => {
    it('should deploy a single page', async function() {
      const context = {
        fs: mockFs,
        config: mockConfig,
        client: () => mockClientInstance,
        promptArgs: async () => null
      };

      const args = {
        file: 'about/index.html',
        location: '/about/',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await page.handler.call(context, args);
      expect(result).to.equal('Added [about/index.html]');
      expect(mockClientInstance._history.post.length).to.equal(1);
      const [call] = mockClientInstance._history.post;
      expect(call.headers['Quant-File-Url']).to.equal('/about/');
    });

    it('should handle enable-index-html setting', async function() {
      // Override config for this test
      const testConfig = {
        ...mockConfig,
        get: (key) => ({
          endpoint: 'mock://api.quantcdn.io/v1',
          clientid: 'test-client',
          project: 'test-project',
          token: 'test-token',
          enableIndexHtml: true
        }[key])
      };

      const context = {
        fs: mockFs,
        config: testConfig,
        client: () => mockClientInstance,
        promptArgs: async () => null
      };

      const args = {
        file: 'about/index.html',
        location: '/about/',
        'enable-index-html': true,
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await page.handler.call(context, args);
      expect(result).to.equal('Added [about/index.html]');
      expect(mockClientInstance._history.post.length).to.equal(1);
      const [call] = mockClientInstance._history.post;
      expect(call.headers['Quant-File-Url']).to.equal('/about/index.html');
    });

    it('should handle MD5 match errors', async function() {
      // Create error client instance
      const errorClientInstance = mockClient(mockConfig);
      errorClientInstance.markup = async () => {
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
        client: () => errorClientInstance,
        promptArgs: async () => null
      };

      const args = {
        file: 'about/index.html',
        location: '/about/',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await page.handler.call(context, args);
      expect(result).to.equal('Skipped [about/index.html] (content unchanged)');
    });

    it('should handle errors', async function() {
      // Create error client instance
      const errorClientInstance = mockClient(mockConfig);
      errorClientInstance.markup = async () => {
        throw new Error('Failed to add page');
      };

      const context = {
        fs: mockFs,
        config: mockConfig,
        client: () => errorClientInstance,
        promptArgs: async () => null
      };

      const args = {
        file: 'about/index.html',
        location: '/about/',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      try {
        await page.handler.call(context, args);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).to.include('Failed to add page');
      }
    });

    it('should handle config fromArgs failure', async function() {
      const exit = process.exit;
      process.exit = (code) => {
        console.log('Process.exit called with:', code);
        process.exit = exit; // Restore immediately
        throw new Error('Process exited with code 1');
      };

      const context = {
        fs: mockFs,
        config: {
          ...mockConfig,
          fromArgs: async () => {
            console.log('Mock config.fromArgs returning false');
            return false;
          }
        },
        client: () => {
          throw new Error('Client factory should not be called when config fails');
        },
        promptArgs: async () => null
      };

      const args = {
        file: 'about/index.html',
        location: '/about/',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      try {
        await page.handler.call(context, args);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).to.equal('Process exited with code 1');
      } finally {
        process.exit = exit;
      }
    });
  });
}); 