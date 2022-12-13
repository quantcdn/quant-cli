/**
 * Test the deploy command.
 */

const deploy = require('../../src/commands/deploy').handler;

// Testers.
const chai = require('chai');
const sinon = require('sinon');
const expect = chai.expect;
const path = require('path');

// Stubs
const getFiles = require('../../src/helper/getFiles');
const config = require('../../src/config');
const client = require('../../src/quant-client');
const revisions = require('../../src/helper/revisions');

describe('Deploy', function() {
  let getFilesStub;
  let configGetStub;
  let clientStub;
  let meta;
  let unpublish;
  let ping;
  let send;

  // Disable console log for neater test output.
  before(() => sinon.stub(console, 'log'));
  after(() => sinon.restore());

  beforeEach(function() {
    unpublish = sinon.stub();
    send = sinon.stub();
    ping = sinon.stub();

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
        ping,
      });
    });

    it('should deploy built html files', async function() {
      const dir = path.resolve(process.cwd(), 'test/fixtures');
      const f = `${dir}/index.html`;
      getFilesStub
          .withArgs(dir)
          .returns([f]);

      await deploy({dir});
      expect(send.calledOnceWith(f)).to.be.true;
    });

    it('should deploy built css files', async function() {
      const dir = path.resolve(process.cwd(), 'test/fixtures');
      const f = `${dir}/test.css`;
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
          {url: 'test/index.html'},
        ],
      });
      clientStub = sinon.stub(client, 'client').returns({
        meta,
        unpublish,
        send,
        ping,
      });
    });

    it('should unpublish missing files', async function() {
      const dir = path.resolve(process.cwd(), 'test/fixtures');
      getFilesStub.withArgs(dir).returns([
        `${dir}/index.html`,
      ]);

      await deploy({dir});
      expect(unpublish.calledOnceWith('test/index.html')).to.be.true;
    });
  });

  describe('Local meta', function() {
    let enabled;
    let store;
    let save;
    beforeEach(function() {
      meta = sinon.stub().returns();
      send.returns({
        'url': '/test.html',
        'md5': 'test',
      });
      clientStub = sinon.stub(client, 'client').returns({
        meta,
        unpublish,
        send,
        ping,
      });
      enabled = sinon.stub(revisions, 'enabled');
      store = sinon.stub(revisions, 'store');
      save = sinon.stub(revisions, 'save');
    });

    afterEach(function() {
      enabled.restore();
      store.restore();
      save.restore();
    });

    it('should build the local md5 cache', async function() {
      const dir = path.resolve(process.cwd(), 'test/fixtures');
      getFilesStub.withArgs(dir).returns([
        `${dir}/index.html`,
      ]);
      await deploy({
        'dir': dir,
        'revision-log': '/tmp/test-log.json',
        'r': '/tmp/test-log.json',
      });
      expect(enabled.firstCall.calledWith(true)).to.be.true;
      expect(store.firstCall.calledWith({
        'url': '/test.html',
        'md5': 'test',
      })).to.be.true;
      expect(save.calledOnce).to.be.true;
    });
  });
});
