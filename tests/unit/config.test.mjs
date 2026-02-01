import { expect } from 'chai';
import fs from 'fs';
import sinon from 'sinon';

const config = (await import('../../src/config.js')).default;

describe('Config', () => {
  beforeEach(() => {
    // Reset config to empty state
    config.set({});

    // Clean up any test config files
    try {
      fs.unlinkSync('quant.json');
    } catch (_e) {
      // Ignore if file doesn't exist
    }

    // Clean up any environment variables
    delete process.env.QUANT_CLIENT_ID;
    delete process.env.QUANT_PROJECT;
    delete process.env.QUANT_TOKEN;
    delete process.env.QUANT_ENDPOINT;
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('fromArgs', () => {
    it('should set defaults when no args provided', async () => {
      await config.fromArgs({}, true);
      expect(config.get('endpoint')).to.equal('https://api.quantcdn.io/v1');
      expect(config.get('dir')).to.equal('build');
    });

    it('should load from environment variables', async () => {
      process.env.QUANT_CLIENT_ID = 'test-client';
      process.env.QUANT_PROJECT = 'test-project';
      process.env.QUANT_TOKEN = 'test-token';

      await config.fromArgs({}, true);

      expect(config.get('clientid')).to.equal('test-client');
      expect(config.get('project')).to.equal('test-project');
      expect(config.get('token')).to.equal('test-token');
    });

    it('should load from quant.json file', async () => {
      const testConfig = {
        clientid: 'json-client',
        project: 'json-project',
        token: 'json-token',
        endpoint: 'https://custom.api.com/v1'
      };

      sinon.stub(fs, 'readFileSync').returns(JSON.stringify(testConfig));

      await config.fromArgs({}, true);

      expect(config.get('clientid')).to.equal('json-client');
      expect(config.get('project')).to.equal('json-project');
      expect(config.get('token')).to.equal('json-token');
      expect(config.get('endpoint')).to.equal('https://custom.api.com/v1');
    });

    it('should prioritize CLI args over environment variables', async () => {
      // Set env vars
      process.env.QUANT_CLIENT_ID = 'env-client';
      process.env.QUANT_PROJECT = 'env-project';

      // Set CLI args
      const args = {
        clientid: 'cli-client',
        project: 'cli-project'
      };

      await config.fromArgs(args, true);

      expect(config.get('clientid')).to.equal('cli-client');
      expect(config.get('project')).to.equal('cli-project');
    });

    it('should prioritize CLI args over quant.json', async () => {
      // Set quant.json
      const fileConfig = {
        clientid: 'json-client',
        project: 'json-project'
      };
      sinon.stub(fs, 'readFileSync').returns(JSON.stringify(fileConfig));

      // Set CLI args
      const args = {
        clientid: 'cli-client',
        project: 'cli-project'
      };

      await config.fromArgs(args, true);

      expect(config.get('clientid')).to.equal('cli-client');
      expect(config.get('project')).to.equal('cli-project');
    });

    it('should prioritize environment variables over quant.json', async () => {
      // Set quant.json
      const fileConfig = {
        clientid: 'json-client',
        project: 'json-project'
      };
      sinon.stub(fs, 'readFileSync').returns(JSON.stringify(fileConfig));

      // Set env vars
      process.env.QUANT_CLIENT_ID = 'env-client';
      process.env.QUANT_PROJECT = 'env-project';

      await config.fromArgs({}, true);

      expect(config.get('clientid')).to.equal('env-client');
      expect(config.get('project')).to.equal('env-project');
    });

    it('should track enableIndexHtml setting', async () => {
      // First deployment sets the setting
      await config.fromArgs({ 'enable-index-html': true }, true);
      expect(config.get('enableIndexHtml')).to.be.true;

      // Second deployment with same setting works
      await config.fromArgs({ 'enable-index-html': true }, true);
      expect(config.get('enableIndexHtml')).to.be.true;

      // Different setting throws error
      try {
        await config.fromArgs({ 'enable-index-html': false }, true);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).to.equal('Cannot disable index.html URLs - this project was deployed with index.html URLs enabled');
      }
    });

    it('should handle enableIndexHtml false setting', async () => {
      // First deployment sets the setting to false
      await config.fromArgs({ 'enable-index-html': false }, true);
      expect(config.get('enableIndexHtml')).to.be.false;

      // Try to enable it later
      try {
        await config.fromArgs({ 'enable-index-html': true }, true);
        expect.fail('Should have thrown error');
      } catch (err) {
        expect(err.message).to.equal('Cannot enable index.html URLs - this project was deployed with index.html URLs disabled');
      }
    });

    it('should accept short form CLI arguments', async () => {
      const args = {
        c: 'test-client',
        p: 'test-project',
        t: 'test-token',
        e: 'http://custom.api/v1'
      };

      await config.fromArgs(args, true);

      expect(config.get('clientid')).to.equal('test-client');
      expect(config.get('project')).to.equal('test-project');
      expect(config.get('token')).to.equal('test-token');
      expect(config.get('endpoint')).to.equal('http://custom.api/v1');
    });

    it('should accept long form CLI arguments', async () => {
      const args = {
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token',
        endpoint: 'http://custom.api/v1'
      };

      await config.fromArgs(args, true);

      expect(config.get('clientid')).to.equal('test-client');
      expect(config.get('project')).to.equal('test-project');
      expect(config.get('token')).to.equal('test-token');
      expect(config.get('endpoint')).to.equal('http://custom.api/v1');
    });

    it('should prioritize long form over short form arguments', async () => {
      const args = {
        clientid: 'long-client',
        c: 'short-client',
        project: 'long-project',
        p: 'short-project'
      };

      await config.fromArgs(args, true);

      expect(config.get('clientid')).to.equal('long-client');
      expect(config.get('project')).to.equal('long-project');
    });
  });

  describe('save', () => {
    it('should save config to quant.json', () => {
      const writeStub = sinon.stub(fs, 'writeFileSync');

      config.set({
        clientid: 'test-client',
        project: 'test-project',
        token: 'test-token'
      });

      config.save();

      expect(writeStub.calledWith('quant.json')).to.be.true;
      const savedConfig = JSON.parse(writeStub.firstCall.args[1]);
      expect(savedConfig.clientid).to.equal('test-client');
      expect(savedConfig.project).to.equal('test-project');
      expect(savedConfig.token).to.equal('test-token');
    });

  });
});
