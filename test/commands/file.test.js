/**
 * Test the deploy command.
 */

const fileCommand = require("../../src/commands/file");

// Testers.
const chai = require("chai");
const sinon = require("sinon");
const expect = chai.expect;

// Stubs
const client = require("../../src/quant-client");
const logger = require("../../src/service/logger");

describe('File', function() {
  const filepath = '/fp/test.jpg';
  const location = '/loc/test.jpg';

  let clientStub;
  let file;

  // Logger stubs.
  let titleStub;
  let successStub;
  let errorStub;

  beforeEach(function() {
    // Logger stubs.
    titleStub = sinon.stub(logger, 'title').returns(true);
    successStub = sinon.stub(logger, 'success').returns(true);
    errorStub = sinon.stub(logger, 'error').returns(true);
  });

  afterEach(function() {
    clientStub.restore();
    titleStub.restore();
    successStub.restore();
    errorStub.restore();
  });

  it('should have a title of File', async function() {
    file = sinon.stub();
    clientStub = sinon.stub(client, 'client').returns({file});
    await fileCommand({filepath, location});
    expect(titleStub.calledOnceWith('File')).to.be.true;
  });

  it('should handle success', async function() {
    file = sinon.stub();
    clientStub = sinon.stub(client, 'client').returns({file});
    await fileCommand({filepath, location});
    expect(file.calledOnceWith(filepath, location)).to.be.true;
    expect(errorStub.called).to.be.false;
    expect(successStub.calledOnceWith('Added (/fp/test.jpg)'), 'Call success').to.be.true; // eslint-disable-line
  });

  it('should handle errors', async function() {
    file = sinon.stub().throws('error', 'invalid');
    clientStub = sinon.stub(client, 'client').returns({file});
    await fileCommand({filepath, location});
    expect(successStub.called).to.be.false;
    expect(errorStub.calledOnceWith('File [/fp/test.jpg] exists at location (/loc/test.jpg)')); // eslint-disable-line
  });
});
