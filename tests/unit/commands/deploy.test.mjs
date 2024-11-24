import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'fs';
import path from 'path';
import deploy from '../../../src/commands/deploy.js';
import config from '../../../src/config.js';
import client from '../../../src/quant-client.js';

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
    
    // Mock client
    const mockClient = {
      send: sinon.stub().resolves({ success: true }),
      batchMeta: sinon.stub().resolves({ 
        global_meta: { 
          records: [] 
        }
      })
    };
    sinon.stub(client).returns(mockClient);
  });

  afterEach(() => {
    sinon.restore();
  });

  describe('handler', () => {
    it('should deploy files successfully', async () => {
      const result = await deploy.handler({ dir: 'build' });
      expect(result).to.equal('Deployment completed successfully');
    });

    it('should handle force flag', async () => {
      const result = await deploy.handler({ 
        dir: 'build',
        force: true
      });
      expect(result).to.equal('Deployment completed successfully');
      // Verify force flag was respected
      const mockClient = client();
      expect(mockClient.send.firstCall.args[2]).to.be.true;
    });

    it('should handle attachments flag', async () => {
      const result = await deploy.handler({ 
        dir: 'build',
        attachments: true
      });
      expect(result).to.equal('Deployment completed successfully');
      // Verify attachments flag was respected
      const mockClient = client();
      expect(mockClient.send.firstCall.args[3]).to.be.true;
    });

    it('should handle skip-unpublish flag', async () => {
      const result = await deploy.handler({ 
        dir: 'build',
        'skip-unpublish': true
      });
      expect(result).to.equal('Deployment completed successfully');
      // Verify no unpublish operations were attempted
      const mockClient = client();
      expect(mockClient.batchMeta.called).to.be.false;
    });
  });

  describe('promptArgs', () => {
    it('should prompt for directory if not provided', async () => {
      // TODO: Mock @clack/prompts
      // This will need special handling since it's an interactive prompt
    });

    it('should use provided arguments without prompting', async () => {
      const args = await deploy.promptArgs({
        dir: 'build',
        attachments: true,
        'skip-unpublish': false,
        'enable-index-html': false,
        'chunk-size': 10,
        force: false
      });
      
      expect(args).to.deep.equal({
        dir: 'build',
        attachments: true,
        'skip-unpublish': false,
        'enable-index-html': false,
        'chunk-size': 10,
        force: false
      });
    });
  });
}); 