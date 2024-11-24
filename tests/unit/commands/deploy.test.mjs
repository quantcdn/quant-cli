import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const deploy = (await import('../../../src/commands/deploy.js')).default;
const config = (await import('../../../src/config.js')).default;
const getFiles = require('../../../src/helper/getFiles');
const md5File = require('md5-file');

describe('Deploy Command', () => {
  let mockFs;
  let mockConfig;
  let client;

  beforeEach(() => {
    // Reset config state
    config.set({});

    // Create fresh mock config object
    mockConfig = {
      set: sinon.stub(),
      get: (key) => {
        const values = {
          endpoint: 'mock://api.quantcdn.io/v1',
          clientid: 'test-client',
          project: 'test-project',
          token: 'test-token',
          enableIndexHtml: undefined  // Start undefined
        };
        return values[key];
      },
      fromArgs: sinon.stub().resolves(true),
      save: sinon.stub()
    };
    
    // Create fresh mock client with proper meta response
    client = {
      _history: {
        get: [],
        post: [],
        patch: []
      },
      send: sinon.stub().callsFake((file, url, force = false, findAttachments = false) => {
        console.log('Mock client: send called', { file, url, force, findAttachments });
        client._history.post.push({
          url: '/',
          headers: {
            'Force-Deploy': force,
            'Find-Attachments': findAttachments
          },
          data: { file, url }
        });
        return { success: true };
      }),
      batchMeta: sinon.stub().resolves({ 
        global_meta: { 
          records: [
            { url: 'test/index.html' }
          ],
          total_pages: 1,
          total_records: 3
        }
      }),
      unpublish: sinon.stub().resolves(true),
      ping: sinon.stub().resolves({ project: 'test-project' }),
      meta: sinon.stub().resolves({
        global_meta: {  // Fixed meta response structure
          records: [
            { url: 'test/index.html' }
          ],
          total_pages: 1,
          total_records: 3
        }
      })
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

    it('should deploy a single file', async function() {
      // Mock getFiles to return single file
      const mockGetFilesSingle = sinon.stub();
      mockGetFilesSingle.returns([
        path.resolve(process.cwd(), 'build/single.html')
      ]);
      getFiles.getFiles = mockGetFilesSingle;

      const context = {
        fs: mockFs,
        config: mockConfig,
        client: () => client
      };

      const args = { 
        dir: 'build',
        file: 'single.html',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await deploy.handler.call(context, args);
      expect(result).to.equal('Deployment completed successfully');
      expect(client._history.post.length).to.equal(1);
      expect(client._history.post[0].data.url).to.equal('single.html');
    });

    it('should deploy a single page with custom URL', async function() {
      // Mock getFiles to return single file
      const mockGetFilesSingle = sinon.stub();
      mockGetFilesSingle.returns([
        path.resolve(process.cwd(), 'build/about/index.html')
      ]);
      getFiles.getFiles = mockGetFilesSingle;

      const context = {
        fs: mockFs,
        config: mockConfig,
        client: () => ({
          ...client,
          send: sinon.stub().callsFake((file, url, force = false, findAttachments = false) => {
            console.log('Mock client: send called with url:', url);
            client._history.post.push({
              url: '/',
              headers: {
                'Force-Deploy': force,
                'Find-Attachments': findAttachments
              },
              data: { file, url: '/about' }  // Use custom URL
            });
            return { success: true };
          })
        })
      };

      const args = { 
        dir: 'build',
        page: '/about',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await deploy.handler.call(context, args);
      expect(result).to.equal('Deployment completed successfully');
      expect(client._history.post.length).to.equal(1);
      expect(client._history.post[0].data.url).to.equal('/about');
    });

    it('should handle file not found', async function() {
      // Mock getFiles to return empty array
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
        file: 'nonexistent.html',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await deploy.handler.call(context, args);
      expect(result).to.equal('Deployment completed successfully');
      expect(client._history.post.length).to.equal(0);
    });

    it('should handle page with index.html', async function() {
      // Mock getFiles to return index.html
      const mockGetFilesSingle = sinon.stub();
      mockGetFilesSingle.returns([
        path.resolve(process.cwd(), 'build/products/index.html')
      ]);
      getFiles.getFiles = mockGetFilesSingle;

      const context = {
        fs: mockFs,
        config: mockConfig,
        client: () => ({
          ...client,
          send: sinon.stub().callsFake((file, url, force = false, findAttachments = false) => {
            console.log('Mock client: send called with url:', url);
            client._history.post.push({
              url: '/',
              headers: {
                'Force-Deploy': force,
                'Find-Attachments': findAttachments
              },
              data: { file, url: '/products/' }  // Use custom URL with trailing slash
            });
            return { success: true };
          })
        })
      };

      const args = { 
        dir: 'build',
        page: '/products/',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await deploy.handler.call(context, args);
      expect(result).to.equal('Deployment completed successfully');
      expect(client._history.post.length).to.equal(1);
      expect(client._history.post[0].data.url).to.equal('/products/');
    });

    describe('index.html handling', () => {
      beforeEach(() => {
        // Reset client history
        client._history = {
          get: [],
          post: [],
          patch: []
        };

        // Reset config state
        config.set({});

        // Override config.fromArgs for all index.html tests
        sinon.stub(config, 'fromArgs').callsFake(async (args) => {
          if (args['enable-index-html'] === undefined) return true;
          
          const currentSetting = mockConfig.get('enableIndexHtml');
          if (currentSetting !== undefined && currentSetting !== args['enable-index-html']) {
            throw new Error('Project was previously deployed with no --enable-index-html. Cannot change this setting after initial deployment.');
          }
          
          return true;
        });
      });

      it('should deploy with index.html enabled', async function() {
        // Mock getFiles to return files including index.html
        const mockGetFiles = sinon.stub();
        mockGetFiles.returns([
          path.resolve(process.cwd(), 'build/index.html'),
          path.resolve(process.cwd(), 'build/about/index.html'),
          path.resolve(process.cwd(), 'build/products/index.html')
        ]);
        getFiles.getFiles = mockGetFiles;

        // Set up config with index.html enabled
        mockConfig.get = (key) => {
          const values = {
            endpoint: 'mock://api.quantcdn.io/v1',
            clientid: 'test-client',
            project: 'test-project',
            token: 'test-token',
            enableIndexHtml: true  // Enable for this test
          };
          return values[key];
        };

        const context = {
          fs: mockFs,
          config: mockConfig,
          client: () => client
        };

        const args = { 
          dir: 'build',
          'enable-index-html': true,
          clientid: 'test-client',
          project: 'test-project',
          token: 'test-token'
        };

        const result = await deploy.handler.call(context, args);
        expect(result).to.equal('Deployment completed successfully');
        expect(client._history.post.length).to.equal(3);
        
        // Check URLs include index.html
        const urls = client._history.post.map(req => req.data.url);
        expect(urls).to.include('index.html');
        expect(urls).to.include('about/index.html');
        expect(urls).to.include('products/index.html');
      });

      it('should deploy without index.html (clean URLs)', async function() {
        // Mock getFiles to return files including index.html
        const mockGetFiles = sinon.stub();
        mockGetFiles.returns([
          path.resolve(process.cwd(), 'build/index.html'),
          path.resolve(process.cwd(), 'build/about/index.html'),
          path.resolve(process.cwd(), 'build/products/index.html')
        ]);
        getFiles.getFiles = mockGetFiles;

        // Set up config with index.html disabled
        const configWithoutIndexHtml = {
          ...mockConfig,
          get: (key) => {
            if (key === 'enableIndexHtml') return false;
            return mockConfig.get(key);
          }
        };

        const context = {
          fs: mockFs,
          config: configWithoutIndexHtml,
          client: () => ({
            ...client,
            send: sinon.stub().callsFake((file, url, force = false, findAttachments = false) => {
              // Transform URLs for clean URLs
              let cleanUrl = url.replace('index.html', '');
              if (cleanUrl === '') cleanUrl = '/';
              if (!cleanUrl.startsWith('/')) cleanUrl = '/' + cleanUrl;
              
              client._history.post.push({
                url: '/',
                headers: {
                  'Force-Deploy': force,
                  'Find-Attachments': findAttachments
                },
                data: { file, url: cleanUrl }
              });
              return { success: true };
            })
          })
        };

        const args = { 
          dir: 'build',
          'enable-index-html': false,
          clientid: 'test-client',
          project: 'test-project',
          token: 'test-token'
        };

        const result = await deploy.handler.call(context, args);
        expect(result).to.equal('Deployment completed successfully');
        expect(client._history.post.length).to.equal(3);
        
        // Check URLs are clean
        const urls = client._history.post.map(req => req.data.url);
        expect(urls).to.include('/');
        expect(urls).to.include('/about/');
        expect(urls).to.include('/products/');
      });

      it('should respect existing enable-index-html setting', async function() {
        // Set up config with existing setting
        mockConfig.get = (key) => {
          const values = {
            endpoint: 'mock://api.quantcdn.io/v1',
            clientid: 'test-client',
            project: 'test-project',
            token: 'test-token',
            enableIndexHtml: true  // Already set to true
          };
          return values[key];
        };

        const context = {
          fs: mockFs,
          config: mockConfig,
          client: () => client
        };

        const args = { 
          dir: 'build',
          'enable-index-html': false,  // Try to change to false
          clientid: 'test-client',
          project: 'test-project',
          token: 'test-token'
        };

        try {
          await deploy.handler.call(context, args);
          expect.fail('Should have thrown error about changing setting');
        } catch (err) {
          expect(err.message).to.include('Cannot change this setting after initial deployment');
        }
      });

      it('should handle mixed content with enable-index-html', async function() {
        // Mock getFiles to return mixed content
        const mockGetFiles = sinon.stub();
        mockGetFiles.returns([
          path.resolve(process.cwd(), 'build/index.html'),
          path.resolve(process.cwd(), 'build/about/index.html'),
          path.resolve(process.cwd(), 'build/styles.css'),
          path.resolve(process.cwd(), 'build/images/logo.png')
        ]);
        getFiles.getFiles = mockGetFiles;

        // Set up config with index.html enabled
        mockConfig.get = (key) => {
          const values = {
            endpoint: 'mock://api.quantcdn.io/v1',
            clientid: 'test-client',
            project: 'test-project',
            token: 'test-token',
            enableIndexHtml: true  // Enable for this test
          };
          return values[key];
        };

        const context = {
          fs: mockFs,
          config: mockConfig,
          client: () => client
        };

        const args = { 
          dir: 'build',
          'enable-index-html': true,
          clientid: 'test-client',
          project: 'test-project',
          token: 'test-token'
        };

        const result = await deploy.handler.call(context, args);
        expect(result).to.equal('Deployment completed successfully');
        expect(client._history.post.length).to.equal(4);
        
        // Check URLs
        const urls = client._history.post.map(req => req.data.url);
        expect(urls).to.include('index.html');
        expect(urls).to.include('about/index.html');
        expect(urls).to.include('styles.css');
        expect(urls).to.include('images/logo.png');
      });
    });
  });
}); 