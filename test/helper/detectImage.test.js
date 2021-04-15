/**
 * Test the image detection.
 */

const chaiAsPromied = require("chai-as-promised");
const chai = require("chai");

const detectImage = require("../../src/helper/detectImage");
const getFiles = require("../../src/helper/getFiles");

const fs = require('fs');

chai.use(chaiAsPromied);
const assert = chai.assert;
const expect = chai.expect;

const cssString = fs.readFileSync('test/fixtures/test.css').toString();
const htmlString = fs.readFileSync("test/fixtures/index.html").toString();

describe('detectImage', function() {
  it('should return a promise', function() {
    return detectImage(cssString).then((items) => {
      assert(items.length == 1);
    });
  });

  it('should add host and proto', async function() {
    const items = await detectImage(cssString, 'test.com');
    const expected = 'https://test.com/nala.jpg';
    expect(items).to.include(expected);
  });

  it('should allow custom proto', async function() {
    const items = await detectImage(cssString, 'test.com', 'http');
    const expected = 'http://test.com/nala.jpg';
    expect(items).to.include(expected);
  });
  it('should return empty array', async function() {
    const items = await detectImage('');
    const expected = [];
    expect(items).to.eql(expected);
  });

  describe('CSS String', function() {
    it('should find background images', async function() {
      const items = await detectImage(cssString);
      const expected = '/nala.jpg';
      expect(items).to.include(expected);
    });
  });

  describe('HTML String', function() {
    it('should find background images', async function() {
      const items = await detectImage(htmlString);
      const expected = '/nala.jpg';
      expect(items).to.include(expected);
    });
    it('should find data-src attributes', async function() {
      const items = await detectImage(htmlString);
      const expected = '/files/assets/test.jpg';
      expect(items).to.include(expected);
    });
    it('should find data-src-retina attributes', async function() {
      const items = await detectImage(htmlString);
      const expected = '/files/assets/test-retina.jpg';
      expect(items).to.include(expected);
    });
    it('should append host and proto', async function() {
      const items = await detectImage(htmlString, 'test.com', 'https');
      const expected = [
        'https://test.com/nala.jpg',
        'https://test.com/files/assets/test-retina.jpg',
        'https://test.com/files/assets/test.jpg',
      ];
      expect(items).to.eql(expected);
    });
  });

});
