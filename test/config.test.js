/**
 * Configuration file testing.
 */

const config = require('../src/config.js');
const chai = require('chai');

const assert = chai.assert;
const expect = chai.expect;

const sinon = require('sinon');
const fs = require('fs');

describe('Config', function() {
  describe('defaults', function() {
    it('should have a default endpoint', function() {
      assert.equal(config.get('endpoint'), 'http://quantcdn.io');
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
      writeFileSync = sinon.stub(fs, 'writeFileSync').returns({});
      config.set({
        dir: 'build',
        endpoint: 'http://quantcdn.io',
        clientid: null,
        token: null,
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
        token: null,
      }, null, 2);
      expect(writeFileSync.calledOnceWith('/tmp/quant.json', data)).to.be.true;
    });
  });
  describe('load()', function() {
    it('should load from a given directory', function() {
      const status = config.load(`${__dirname}/fixtures`);
      assert.equal(status, true);
      assert.equal(config.get('clientid'), 'test');
      assert.equal(config.get('token'), 'test');
    });
    it('should return FALSE if file is not found', function() {
      const status = config.load(`${__dirname}`);
      assert.equal(status, false);
    });
  });
});
