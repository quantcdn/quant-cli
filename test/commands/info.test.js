/**
 * Test the info command.
 */
const info = require("../../src/commands/info");

// Testers.
const chai = require("chai");
const sinon = require("sinon");
const expect = chai.expect;

// Stubs
const client = require("../../src/quant-client");
const logger = require("../../src/service/logger");
const config = require("../../src/config");

describe('Info', function() {
  let configGetStub;
  let clientStub;
  let meta;
  let ping;

  let titleStub;
  let infoStub;
  let successStub;
  let warnStub;
  let fatalStub;
  let logStub;
  let tableStub;

  beforeEach(function() {
    configGetStub = sinon.stub(config, 'get');
    configGetStub.withArgs('endpoint').returns('http://localhost:8081');
    configGetStub.withArgs('clientid').returns('dev');
    configGetStub.withArgs('token').returns('test');

    titleStub = sinon.stub(logger, 'title').returns(true);
  });

  afterEach(function() {
    configGetStub.restore();
    clientStub.restore();
    meta.restore();
    ping.restore();
    titleStub.restore();
  });

  describe('Static output', async function() {
    ping = sinon.stub().returns({});
    meta = sinon.stub().returns({});
    clientStub = sinon.stub(client, 'client').returns({ping, meta});
    await info();
    expect(titleStub.calledOnceWith('Info')).to.be.true;
  });

});
