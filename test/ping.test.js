/**
 * Test the ping function.
 */

const chai = require('chai');

const assert = chai.assert;
const expect = chai.expect;

const sinon = require('sinon');
const config = require('../src/config');
const request = require('request');

const ping = require('../src/ping');

describe('Ping', function() {
  describe('Valid configuratioin', function() {
    let configGet;
    let requestGet;

    beforeEach(function() {
      configGet = sinon.stub(config, 'get');
      configGet.withArgs('endpoint').returns('http://localhost:8081');
      configGet.withArgs('clientid').returns('dev');
      configGet.withArgs('token').returns('test');
    });

    afterEach(function() {
      configGet.restore();
      requestGet.restore();
    });

    it('return success', async function() {
      requestGet = sinon
          .stub(request, 'get')
          .resolves({body: '{data: {project: \'test\'}'});

      ping(config).then((project) => {
        const headers = {
          'Content-Type': 'application/json',
          'Quant-Customer': 'dev',
          'Quant-Token': 'test',
        };

        expect(
            requestGet.calledOnceWith({
              url: 'http://localhost:8081/ping',
              headers,
            }),
        ).to.be.true;
        assert.equal(project, 'test');
      });
    });

    it('should return project name', async function() {
      requestGet = sinon
          .stub(request, 'get')
          .resolves({body: '{data: {project: \'sample-project\'}'});

      ping(config).then((project) => {
        const headers = {
          'Content-Type': 'application/json',
          'Quant-Customer': 'dev',
          'Quant-Token': 'test',
        };

        expect(
            requestGet.calledOnceWith({
              url: 'http://localhost:8081/ping',
              headers,
            }),
        ).to.be.true;
        assert.equal(project, 'sample-project');
      });
    });
  });
});
