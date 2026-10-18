import { expect } from 'chai';
import sinon from 'sinon';
import _fs from 'fs';
import _path from 'path';
import mockClient from '../../mocks/quant-client.mjs';

const functions = (await import('../../../src/commands/functions.js')).default;
const config = (await import('../../../src/config.js')).default;

describe('Functions Command', () => {
  let mockConfig;
  let mockClientInstance;
  let readFileSync;

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

    // Mock fs.readFileSync
    readFileSync = sinon.stub(_fs, 'readFileSync');
    sinon.stub(_fs, 'existsSync').returns(true);

    // Stub console methods
    sinon.stub(console, 'log');
    sinon.stub(console, 'error');
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('handler', () => {
    it('uploads each function with the uuid the manifest names', async () => {
      readFileSync.returns(JSON.stringify([{ id: 'api', type: 'function', path: './api.js', description: 'API', uuid: '43aec1f0-095b-4a76-a9c8-934bf3d49d59' }]));
      const edgeFunction = sinon.stub().resolves({});
      await functions.handler.call({ config: mockConfig, client: () => ({ edgeFunction }) }, { file: 'functions.json' });
      expect(edgeFunction.firstCall.args).to.deep.equal(['./api.js', 'API', '43aec1f0-095b-4a76-a9c8-934bf3d49d59']);
    });

    it('refuses an entry without a uuid before the first upload, naming the entry', async () => {
      readFileSync.returns(JSON.stringify([
        { type: 'function', path: './ok.js', description: 'OK', uuid: '43aec1f0-095b-4a76-a9c8-934bf3d49d59' },
        { id: 'api', type: 'function', path: './api.js', description: 'API' }
      ]));
      const edgeFunction = sinon.stub().resolves({});
      try {
        await functions.handler.call({ config: mockConfig, client: () => ({ edgeFunction }) }, { file: 'quant/edge-functions.json' });
        expect.fail('a missing uuid must fail');
      } catch (error) {
        expect(error.message).to.include('quant/edge-functions.json is not a valid function manifest');
        expect(error.message).to.include('Entry 1 (api.js): uuid is required');
      }
      expect(edgeFunction.called).to.equal(false);
    });

    it('rejects duplicate function ids before the first upload', async () => {
      readFileSync.returns(JSON.stringify([
        { id: 'api', type: 'function', path: './a.js', description: 'A', uuid: '43aec1f0-095b-4a76-a9c8-934bf3d49d59' },
        { id: 'api', type: 'function', path: './b.js', description: 'B', uuid: '00310c2c-c598-4d98-8a64-1e14955284d0' }
      ]));
      const edgeFunction = sinon.stub();
      try {
        await functions.handler.call({ config: mockConfig, client: () => ({ edgeFunction }) }, { file: 'functions.json' });
        expect.fail('duplicate must fail');
      } catch (error) { expect(error.message).to.include('id is used by another entry'); }
      expect(edgeFunction.called).to.equal(false);
    });

    it('checks every file exists before the first upload', async () => {
      readFileSync.returns(JSON.stringify([
        { type: 'function', path: './a.js', description: 'A', uuid: '43aec1f0-095b-4a76-a9c8-934bf3d49d59' },
        { type: 'function', path: './gone.js', description: 'B', uuid: '00310c2c-c598-4d98-8a64-1e14955284d0' }
      ]));
      _fs.existsSync.callsFake(path => path !== './gone.js');
      const edgeFunction = sinon.stub().resolves({});
      try {
        await functions.handler.call({ config: mockConfig, client: () => ({ edgeFunction }) }, { file: 'functions.json' });
        expect.fail('a missing file must fail');
      } catch (error) { expect(error.message).to.include('Function file not found: ./gone.js'); }
      expect(edgeFunction.called).to.equal(false);
    });

    it('should deploy auth functions', async () => {
      const mockJson = [{
        type: 'auth',
        path: './auth.js',
        description: 'Test auth function',
        uuid: '43aec1f0-095b-4a76-a9c8-934bf3d49d59'
      }];

      readFileSync.returns(JSON.stringify(mockJson));

      const context = {
        config: mockConfig,
        client: () => mockClientInstance
      };

      const args = {
        file: 'functions.json',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await functions.handler.call(context, args);
      expect(result).to.include('All functions processed successfully');
      expect(mockClientInstance._history.post.length).to.equal(1);
    });

    it('should deploy filter functions', async () => {
      const mockJson = [{
        type: 'filter',
        path: './filter.js',
        description: 'Test filter function',
        uuid: '00310c2c-c598-4d98-8a64-1e14955284d0'
      }];

      readFileSync.returns(JSON.stringify(mockJson));

      const context = {
        config: mockConfig,
        client: () => mockClientInstance
      };

      const args = {
        file: 'functions.json',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await functions.handler.call(context, args);
      expect(result).to.include('All functions processed successfully');
      expect(mockClientInstance._history.post.length).to.equal(1);
    });

    it('should deploy edge functions', async () => {
      const mockJson = [{
        type: 'edge',
        path: './edge.js',
        description: 'Test edge function',
        uuid: '04e76c20-1e36-4e62-b7a4-38037e49ca86'
      }];

      readFileSync.returns(JSON.stringify(mockJson));

      const context = {
        config: mockConfig,
        client: () => mockClientInstance
      };

      const args = {
        file: 'functions.json',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      const result = await functions.handler.call(context, args);
      expect(result).to.include('All functions processed successfully');
      expect(mockClientInstance._history.post.length).to.equal(1);
    });

    it('should handle missing file', async () => {
      readFileSync.throws(new Error('ENOENT: no such file or directory'));

      const context = {
        config: mockConfig,
        client: () => mockClientInstance
      };

      const args = {
        file: 'nonexistent.json',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      try {
        await functions.handler.call(context, args);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).to.include('Failed to read functions file');
      }
    });

    it('should handle invalid JSON', async () => {
      readFileSync.returns('invalid json');

      const context = {
        config: mockConfig,
        client: () => mockClientInstance
      };

      const args = {
        file: 'functions.json',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      try {
        await functions.handler.call(context, args);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).to.include('Failed to read functions file');
      }
    });

    it('should handle invalid function type', async () => {
      const mockJson = [{
        type: 'invalid',
        path: './invalid.js',
        description: 'Invalid function',
        uuid: '04e76c20-1e36-4e62-b7a4-38037e49ca86'
      }];

      readFileSync.returns(JSON.stringify(mockJson));

      const context = {
        config: mockConfig,
        client: () => mockClientInstance
      };

      const args = {
        file: 'functions.json',
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      };

      try {
        await functions.handler.call(context, args);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).to.include('type must be function, edge, auth or filter');
      }
    });
  });
});
