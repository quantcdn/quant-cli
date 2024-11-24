import { expect } from 'chai';
import * as sinon from 'sinon';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const deploy = (await import('../../../src/commands/deploy.js')).default;
const getFiles = require('../../../src/helper/getFiles');
const md5File = require('md5-file');

// Import our mock client instead of the real one
const mockClientFactory = (await import('../../mocks/quant-client.mjs')).default;

describe('Deploy Command', () => {
  let mockFs;
  let mockConfig;
  let client;

  beforeEach(() => {
    console.log('Setting up test...');
    
    // Create mock config object
    mockConfig = {
      set: sinon.stub(),
      get: (key) => {
        const values = {
          endpoint: 'mock://api.quantcdn.io/v1',  // Use mock:// endpoint
          clientid: 'test-client',
          project: 'test-project',
          token: 'test-token'
        };
        console.log('Config.get called with:', key, 'returning:', values[key]);
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
    console.log('Created mock client:', client);

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

    // Only stub error and warn to keep debug output
    sinon.stub(console, 'error');
    sinon.stub(console, 'warn');
  });

  afterEach(() => {
    console.log('Test cleanup...');
    sinon.restore();
  });

  describe('handler', () => {
    it('should deploy files successfully', async function() {
      this.timeout(5000);
      console.log('Running deploy files test...');

      const context = {
        fs: mockFs,
        config: mockConfig,
        client: () => {
          console.log('Client factory called');
          return client;
        }
      };

      const args = { 
        dir: 'build',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      console.log('Calling deploy handler with args:', args);
      const result = await deploy.handler.call(context, args);
      console.log('Deploy result:', result);
      
      expect(result).to.equal('Deployment completed successfully');
      expect(client._history.post.length).to.be.greaterThan(0);
    });

    it('should handle force flag', async function() {
      this.timeout(5000);

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
      expect(client._history.post.length).to.be.greaterThan(0);
      const postRequest = client._history.post[0];
      expect(postRequest.headers['Force-Deploy']).to.be.true;
    });

    it('should handle attachments flag', async function() {
      this.timeout(5000);

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
      expect(client._history.post.length).to.be.greaterThan(0);
      const postRequest = client._history.post[0];
      expect(postRequest.headers['Find-Attachments']).to.be.true;
    });

    it('should handle skip-unpublish flag', async function() {
      this.timeout(5000);

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
  });
}); 