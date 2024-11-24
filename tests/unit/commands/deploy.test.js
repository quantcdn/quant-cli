import { expect } from 'chai';
import nock from 'nock';
import fs from 'fs';
import deploy from '../../../src/commands/deploy.js';
import config from '../../../src/config.js';

describe('Deploy Command', () => {
  const testConfig = {
    clientid: 'test-client',
    project: 'test-project',
    token: 'test-token',
    endpoint: 'https://api.quantcdn.io/v1'
  };

  beforeEach(() => {
    // Set up test config
    config.set(testConfig);
    
    // Mock file system
    sinon.stub(fs, 'readdirSync').returns(['index.html']);
    sinon.stub(fs, 'statSync').returns({ isDirectory: () => false });
    sinon.stub(fs, 'readFileSync').returns('test content');
    
    // Clean up any test files
    try {
      fs.unlinkSync('quant.json');
    } catch (e) {
      // Ignore if file doesn't exist
    }
  });

  afterEach(() => {
    nock.cleanAll();
    sinon.restore();
  });

  it('should deploy files successfully', async () => {
    // Mock API responses
    nock('https://api.quantcdn.io/v1')
      .post('/')
      .reply(200, { success: true })
      .get('/global-meta')
      .reply(200, { global_meta: { records: [] } });

    const result = await deploy.handler({ dir: 'build' });
    expect(result).to.include('Deployment completed successfully');
  });

  it('should handle API errors gracefully', async () => {
    nock('https://api.quantcdn.io/v1')
      .post('/')
      .reply(500, { error: true, message: 'Server error' });

    try {
      await deploy.handler({ dir: 'build' });
      expect.fail('Should have thrown error');
    } catch (err) {
      expect(err.message).to.include('Server error');
    }
  });
}); 