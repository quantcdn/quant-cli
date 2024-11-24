import { expect } from 'chai';
import * as sinon from 'sinon';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const deploy = (await import('../../../src/commands/deploy.js')).default;
const getFiles = require('../../../src/helper/getFiles');
const md5File = require('md5-file');
const mockClientFactory = (await import('../../mocks/quant-client.mjs')).default;

describe('Deploy Command', () => {
  let mockFs;
  let mockConfig;
  let client;

  beforeEach(() => {
    // Create mock config object
    mockConfig = {
      set: sinon.stub(),
      get: (key) => {
        const values = {
          endpoint: 'mock://api.quantcdn.io/v1',
          clientid: 'test-client',
          project: 'test-project',
          token: 'test-token'
        };
        return values[key];
      },
      fromArgs: sinon.stub().resolves(true),
      save: sinon.stub()
    };
    
    // Mock file system operations
    mockFs = {
      readdirSync: () => ['index.html'],
      statSync: () => ({ isDirectory: () => false }),
      readFileSync: () => 'test content',
      existsSync: () => true,
      mkdirSync: () => {},
      writeFileSync: () => {},
      createReadStream: () => 'test content'
    };

    // Create mock client instance
    client = mockClientFactory(mockConfig);

    // Mock getFiles function
    const mockGetFiles = sinon.stub();
    mockGetFiles.returns([
      path.resolve(process.cwd(), 'build/index.html'),
      path.resolve(process.cwd(), 'build/styles.css'),
      path.resolve(process.cwd(), 'build/images/logo.png')
    ]);
    getFiles.getFiles = mockGetFiles;

    // Mock md5File
    sinon.stub(md5File, 'sync').returns('test-md5-hash');

    // Stub console methods
    sinon.stub(console, 'error');
    sinon.stub(console, 'warn');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('handler', () => {
    it('should deploy files successfully', async function() {
      const context = {
        fs: mockFs,
        config: mockConfig,
        client: () => client
      };

      const args = { 
        dir: 'build',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await deploy.handler.call(context, args);
      expect(result).to.equal('Deployment completed successfully');
      expect(client._history.post.length).to.equal(3); // Should deploy all 3 files
      expect(client._history.post[0].data.url).to.include('index.html');
      expect(client._history.post[1].data.url).to.include('styles.css');
      expect(client._history.post[2].data.url).to.include('logo.png');
    });

    it('should handle force flag', async function() {
      const context = {
        fs: mockFs,
        config: mockConfig,
        client: () => client
      };

      const args = { 
        dir: 'build',
        force: true,
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      await deploy.handler.call(context, args);
      expect(client._history.post.length).to.equal(3);
      client._history.post.forEach(request => {
        expect(request.headers['Force-Deploy']).to.be.true;
      });
    });

    it('should handle attachments flag', async function() {
      const context = {
        fs: mockFs,
        config: mockConfig,
        client: () => client
      };

      const args = { 
        dir: 'build',
        attachments: true,
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      await deploy.handler.call(context, args);
      expect(client._history.post.length).to.equal(3);
      client._history.post.forEach(request => {
        expect(request.headers['Find-Attachments']).to.be.true;
      });
    });

    it('should handle skip-unpublish flag', async function() {
      const context = {
        fs: mockFs,
        config: mockConfig,
        client: () => client
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
      expect(client._history.get.filter(req => req.url === '/global-meta').length).to.equal(0);
    });

    it('should handle non-existent directory', async function() {
      // Mock fs module directly
      const existsSyncStub = sinon.stub(fs, 'existsSync').callsFake((dir) => {
        console.log('existsSync called with:', dir);
        return false;
      });

      // Mock getFiles to return empty array
      const mockGetFilesEmpty = sinon.stub().callsFake((dir) => {
        console.log('getFiles called with:', dir);
        return [];
      });
      getFiles.getFiles = mockGetFilesEmpty;

      const context = {
        fs: mockFs,  // We can keep this as is since we're mocking fs directly
        config: mockConfig,
        client: () => client
      };

      const args = { 
        dir: 'nonexistent',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await deploy.handler.call(context, args);
      
      // Verify no files were deployed
      expect(client._history.post.length).to.equal(0);
      expect(result).to.equal('Deployment completed successfully');
      
      // Verify directory check was made
      const existsSyncCalls = existsSyncStub.getCalls();
      console.log('existsSync was called', existsSyncCalls.length, 'times');
      existsSyncCalls.forEach((call, i) => {
        console.log(`Call ${i + 1}:`, call.args[0]);
      });

      expect(existsSyncStub.called, 'existsSync should have been called').to.be.true;
      expect(mockGetFilesEmpty.called, 'getFiles should have been called').to.be.true;
    });

    it('should handle empty directory', async function() {
      const mockGetFilesEmpty = sinon.stub();
      mockGetFilesEmpty.returns([]);
      getFiles.getFiles = mockGetFilesEmpty;

      const context = {
        fs: mockFs,
        config: mockConfig,
        client: () => client
      };

      const args = { 
        dir: 'build',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await deploy.handler.call(context, args);
      expect(result).to.equal('Deployment completed successfully');
      expect(client._history.post.length).to.equal(0);
    });
  });
}); 