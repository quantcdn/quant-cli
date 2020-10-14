/**
 * Test the deploy command.
 */

const deploy = require('../../src/commands/deploy');

// Testers.
const chai = require('chai');
const sinon = require('sinon');
const expect = chai.expect;
const path = require('path');

// Stubs
const getFiles = require('../../src/helper/getFiles');
const config = require('../../src/config');
const client = require('../../src/quant-client');

describe('Deploy', function() {
  let getFilesStub;
  let configGetStub;
  let clientStub;
  let meta;
  let unpublish;

  beforeEach(function() {
    unpublish = sinon.stub();
    send = sinon.stub();

    configGetStub = sinon.stub(config, 'get');
    configGetStub.withArgs('endpoint').returns('http://localhost:8081');
    configGetStub.withArgs('clientid').returns('dev');
    configGetStub.withArgs('token').returns('test');

    getFilesStub = sinon.stub(getFiles, 'getFiles');
  });

  afterEach(function() {
    configGetStub.restore();
    getFilesStub.restore();
    clientStub.restore();
  });

  describe('Publish', function() {
    beforeEach(function() {
      meta = sinon.stub().returns();
      clientStub = sinon.stub(client, 'client').returns({
        meta,
        unpublish,
        send,
      });
    });

    it('should deploy built html files', async function() {
      const dir = process.cwd() + 'test/fixtures';
      const f = `${dir}/test/index.html`;

      getFilesStub
          .withArgs(dir)
          .returns([f]);

      await deploy({dir});

      expect(send.calledOnceWith(f)).to.be.true;
    });

    it('should deploy built css files', async function() {
      const dir = process.cwd() + 'test/fixtures';
      const f = `${dir}/test/test.css`;

      getFilesStub
          .withArgs(dir)
          .returns([f]);

      await deploy({dir});

      expect(send.calledOnceWith(f)).to.be.true;
    });
  });

  describe('Unpublish', function() {
    beforeEach(function() {
      meta = sinon.stub().returns({
        total_pages: 1,
        total_records: 3,
        records: [
          'test/index.html',
        ],
      });
      clientStub = sinon.stub(client, 'client').returns({
        meta,
        unpublish,
        send,
      });
    });

    it('should unpublish missing files', async function() {
      const dir = path.resolve(process.cwd(), 'test/fixtures');
      getFilesStub.withArgs(dir).returns([
        'index.html',
      ]);
      await deploy({dir});
      expect(unpublish.calledOnceWith('test/index.html')).to.be.true;
    });
  });
});
