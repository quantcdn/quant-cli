/**
 * Configuration file testing.
 */

const config = require('../src/config.js');
const fs = require('fs');

describe('Config', function() {
  let chai, sinon, assert, expect

  beforeEach(async() => {
    chai = await import('chai')
    sinon = (await import('sinon')).default
    assert = chai.assert
    expect = chai.expect
  })

  afterEach(async () => {
    sinon.restore();
  })

  describe('defaults', function() {
    it('should have a default endpoint', function() {
      assert.equal(config.get('endpoint'), 'https://api.quantcdn.io/v1');
    });
    it('should have a default directory', function() {
      assert.equal(config.get('dir'), 'build');
    });
  });
  describe('set()', function() {
    it('should update client id', function() {
      const result = {clientid: 'test'};
      config.set(result);
      assert.equal(config.get('clientid'), 'test');
    });
    it('should set token', function() {
      const result = {token: 'test'};
      config.set(result);
      assert.equal(config.get('token'), 'test');
    });
  });
  describe('save()', function() {
    let writeFileSync;
    beforeEach(function() {
      sinon.restore();
      writeFileSync = sinon.stub(fs, 'writeFileSync').returns({});
      config.set({
        dir: 'build',
        endpoint: 'http://quantcdn.io',
        clientid: null,
        token: null,
        project: null,
      });
    });
    afterEach(function() {
      writeFileSync.restore();
    });
    it('should save the state', function() {
      config.save();
      const data = JSON.stringify({
        dir: 'build',
        endpoint: 'http://quantcdn.io',
        clientid: null,
        project: null,
        token: null,
      }, null, 2);
      expect(writeFileSync.calledOnceWith('./quant.json', data)).to.be.true;
    });
    it('should save updated state', function() {
      const results = {clientid: 'test'};
      config.set(results);
      config.save();
      const data = JSON.stringify({
        dir: 'build',
        endpoint: 'http://quantcdn.io',
        clientid: 'test',
        project: null,
        token: null,
      }, null, 2);
      expect(writeFileSync.calledOnceWith('./quant.json', data)).to.be.true;
    });
    it('should save to given directory', function() {
      config.save('/tmp');
      const data = JSON.stringify({
        dir: 'build',
        endpoint: 'http://quantcdn.io',
        clientid: null,
        project: null,
        token: null,
      }, null, 2);
      expect(writeFileSync.calledOnceWith('/tmp/quant.json', data)).to.be.true;
    });
  });
  describe('load()', function() {
    let readFileSync;

    afterEach(function() {
      readFileSync.restore();
    });
    it('should load from a given directory', function() {
      readFileSync = sinon.stub(fs, 'readFileSync').returns(
          JSON.stringify({
            dir: '.',
            endpoint: 'http://api.quantcdn.io',
            clientid: 'test',
            token: 'test',
            project: 'test',
          }),
      );
      const status = config.load(`/tmp`);
      expect(readFileSync.calledOnceWith(`/tmp/quant.json`)).to.be.true;
      assert.equal(status, true);
      assert.equal(config.get('clientid'), 'test');
      assert.equal(config.get('token'), 'test');
      assert.equal(config.get('project'), 'test');
    });
    it('should return FALSE if file is not found', function() {
      readFileSync = sinon.stub(fs, 'readFileSync').throwsException();
      const status = config.load('/tmp');
      expect(readFileSync.calledOnceWith('/tmp/quant.json')).to.be.true;
      assert.equal(status, false);
    });
  });
});
