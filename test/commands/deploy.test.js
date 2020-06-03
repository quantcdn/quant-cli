/**
 * Test the deploy command.
 */

const deploy = require('../../src/commands/deploy');

// Testers.
const chai = require('chai');
const sinon = require('sinon');
const expect = chai.expect;

// Stubs
const getFiles = require('../../src/helper/getFiles');
const config = require('../../src/config');
const client = require('../../src/quant-client');
const logger = require('../../src/service/logger');


describe('Deploy', function() {
  let getFilesStub;
  let configGetStub;
  let clientStub;
  let markup;
  let file;
  let meta;
  let unpublish;

  // Logger stubs.
  let titleStub;
  let infoStub;
  let successStub;
  let errorStub;
  let fatalStub;

  beforeEach(function() {
    markup = sinon.stub();
    file = sinon.stub();
    unpublish = sinon.stub();

    configGetStub = sinon.stub(config, 'get');
    configGetStub.withArgs('endpoint').returns('http://localhost:8081');
    configGetStub.withArgs('clientid').returns('dev');
    configGetStub.withArgs('token').returns('test');

    getFilesStub = sinon.stub(getFiles, 'getFiles');

    // Logger stubs.
    titleStub = sinon.stub(logger, 'title').returns(true);
    infoStub = sinon.stub(logger, 'info').returns(true);
    successStub = sinon.stub(logger, 'success').returns(true);
    fatalStub = sinon.stub(logger, 'fatal').returns(true);
    errorStub = sinon.stub(logger, 'error').returns(true);
  });

  afterEach(function() {
    configGetStub.restore();
    getFilesStub.restore();
    clientStub.restore();

    // Logger stubs.
    titleStub.restore();
    infoStub.restore();
    successStub.restore();
    fatalStub.restore();
    errorStub.restore();
  });

  describe('Static output', function() {
    beforeEach(function() {
      meta = sinon.stub().returns({});
      clientStub = sinon.stub(client, 'client').returns({
        markup,
        file,
        meta,
        unpublish,
      });
    });

    it('should have a title of Deploy', async function() {
      const dir = process.cwd() + 'test/fixtures';
      const f = `${dir}/test/index.html`;

      getFilesStub
          .withArgs(dir)
          .returns([f]);

      await deploy({dir});

      expect(titleStub.calledOnceWith('Deploy')).to.be.true;
    });
  });

  describe('Publish', function() {
    beforeEach(function() {
      meta = sinon.stub().returns({});
      clientStub = sinon.stub(client, 'client').returns({
        markup,
        file,
        meta,
        unpublish,
      });
    });

    it('should deploy built html files', async function() {
      const dir = process.cwd() + 'test/fixtures';
      const f = `${dir}/test/index.html`;

      getFilesStub
          .withArgs(dir)
          .returns([f]);

      await deploy({dir});

      expect(errorStub.called).to.be.false;
      expect(successStub.calledOnceWith('test/index.html')).to.be.true;

      expect(markup.calledOnceWith(f)).to.be.true;
      expect(file.calledOnceWith(f)).to.be.false;
    });

    it('should deploy built css files', async function() {
      const dir = process.cwd() + 'test/fixtures';
      const f = `${dir}/test/test.css`;

      getFilesStub
          .withArgs(dir)
          .returns([f]);

      await deploy({dir});

      expect(errorStub.called).to.be.false;
      expect(successStub.calledOnceWith('test/test.css')).to.be.true;

      expect(markup.calledOnceWith(f)).to.be.false;
      expect(file.calledOnceWith(f)).to.be.true;
    });
  });

  describe('Unpublish', function() {
    beforeEach(function() {
      meta = sinon.stub().returns({
        meta: {
          'index.html': {published: true},
          'test/dir/index.html': {published: false},
        },
      });
      clientStub = sinon.stub(client, 'client').returns({
        markup,
        file,
        meta,
        unpublish,
      });
    });

    it('should unpublish missing files', async function() {
      const dir = process.cwd() + 'test/fixtures';
      const f = `${dir}/test/index.html`;

      getFilesStub.withArgs(dir).returns([f]);
      await deploy({dir});

      expect(errorStub.called).to.be.false;

      expect(unpublish.calledOnceWith('index.html')).to.be.true;
      expect(unpublish.neverCalledWith('test/dir/index.html')).to.be.true;
      expect(unpublish.neverCalledWith('test/index.html')).to.be.true;
    });

    it('should not resend unpublish requests', async function() {
      const dir = process.cwd() + 'test/fixtures';
      const f = `${dir}/test/index.html`;

      getFilesStub.withArgs(dir).returns([f]);
      await deploy({dir});

      expect(errorStub.called).to.be.false;
      expect(unpublish.neverCalledWith('test/dir/index.html')).to.be.true;
    });
  });

  describe('Error handling', function() {
    it('should catch an invalid directory', async function() {
      const dir = process.cwd() + 'test/fixtures';
      getFilesStub.withArgs(dir).throws('InvalidDirectory', 'Not found');
      await deploy({dir});
      expect(fatalStub.calledOnceWith('Not found')).to.be.true;
    });

    it('should catch an invalid markup upload', async function() {
      markup = sinon.stub().throws('error', 'failed');
      meta = sinon.stub().returns({});

      clientStub = sinon.stub(client, 'client').returns({
        markup,
        file,
        meta,
        unpublish,
      });

      const dir = process.cwd() + 'test/fixtures';
      const f = `${dir}/test/index.html`;
      getFilesStub.withArgs(dir).returns([f]);

      await deploy({dir});

      expect(errorStub.calledOnceWith('failed test/index.html')).to.be.true;
      expect(markup.called).to.be.true;
      expect(meta.called).to.be.true;
    });

    it('should handle invalid meta', async function() {
      meta = sinon.stub().throws('error', 'unknown');
      const dir = process.cwd() + 'test/fixtures';
      const f = `${dir}/test/index.html`;

      getFilesStub.withArgs(dir).returns([f]);
      const metaRet = await deploy({dir});

      expect(infoStub.calledOnceWith('Meta data is unavailable, we cannot automatically unpublish data.')); // eslint-disable-line
      expect(metaRet).to.equal(1001);
      expect(unpublish.called).to.be.false;
    });

    it('should handle an invalid unpublish', async function() {
      const dir = process.cwd() + 'test/fixtures';
      const f = `${dir}/test/index.html`;

      getFilesStub.withArgs(dir).returns([f]);
      meta = sinon.stub().returns({
        meta: {
          'index.html': {published: true},
        },
      });

      unpublish = sinon.stub().throws('error', 'invalid');

      clientStub = sinon.stub(client, 'client').returns({
        markup,
        file,
        meta,
        unpublish,
      });

      await deploy({dir});

      expect(errorStub.calledOnceWith('invalid (index.html)')).to.be.true;
    });
  });
});
