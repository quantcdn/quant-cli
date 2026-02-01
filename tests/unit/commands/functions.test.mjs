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
    it('should deploy auth functions', async () => {
      const mockJson = [{
        type: 'auth',
        path: './auth.js',
        description: 'Test auth function',
        uuid: 'test-uuid'
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
        description: 'Test filter function'
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
        description: 'Test edge function'
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
        description: 'Invalid function'
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
        expect(err.message).to.include('Invalid function type');
      }
    });
  });
});
