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

describe('Deploy', function() {
  let getFilesStub;
  let configGetStub;
  let clientStub;
  let markup;
  let file;
  let meta;
  let unpublish;

  beforeEach(function() {
    markup = sinon.stub();
    file = sinon.stub();
    unpublish = sinon.stub();

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

      expect(unpublish.calledOnceWith('index.html')).to.be.true;
      expect(unpublish.neverCalledWith('test/dir/index.html')).to.be.true;
      expect(unpublish.neverCalledWith('test/index.html')).to.be.true;
    });

    it('should not resend unpublish requests', async function() {
      const dir = process.cwd() + 'test/fixtures';
      const f = `${dir}/test/index.html`;

      getFilesStub.withArgs(dir).returns([f]);
      await deploy({dir});
      expect(unpublish.neverCalledWith('test/dir/index.html')).to.be.true;
    });
  });
});
