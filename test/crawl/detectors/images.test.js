/**
 * Test the image detection.
 */

const detector = require('../../../src/crawl/detectors/images');
const getFiles = require("../../../src/helper/getFiles");

const fs = require('fs');

const cssString = fs.readFileSync('test/fixtures/test.css').toString();
const htmlString = fs.readFileSync("test/fixtures/index.html").toString();

describe('crawl:detectors:images', function() {
  let chai, cap, expect, assert;

  beforeEach(async () => {
    chai = await import('chai');
    cap = (await import('chai-as-promised')).default;
    chai.use(cap);
    assert = chai.assert;
    expect = chai.expect;
  })

  describe('applies', () => {
    it('should apply to HTML', () => {
      const res = {};
      res.headers = {};
      res.headers['content-type'] = 'text/html';
      expect(detector.applies(res)).to.be.true;
    });

    it('should apply to CSS', () => {
      const res = {};
      res.headers = {};
      res.headers['content-type'] = 'text/css';
      expect(detector.applies(res)).to.be.true;
    });

    it('should not apply to other mime types', () => {
      const res = {};
      res.headers = {};
      const mimes = [
        'text/plain',
        'application/json',
        'text/javascript',
        'imagea/apng',
        'image/gif',
        'audio/wave',
        'multipart/form-data',
      ];

      mimes.map((i) => {
        res.headers['content-type'] = i;
        expect(detector.applies(res)).to.be.false;
      });
    });
  });

  describe('handler', () => {
    it('should add host and proto', function() {
      const items = detector.handler(cssString, 'test.com');
      const expected = 'https://test.com/nala.jpg';
      expect(items).to.include(expected);
    });

    it('should allow custom proto', function() {
      const items = detector.handler(cssString, 'test.com', 'http');
      const expected = 'http://test.com/nala.jpg';
      expect(items).to.include(expected);
    });
    it('should return empty array', function() {
      const items = detector.handler('');
      const expected = [];
      expect(items).to.eql(expected);
    });

    describe('CSS String', function() {
      it('should find background images', function() {
        const items = detector.handler(cssString);
        const expected = '/nala.jpg';
        expect(items).to.include(expected);
      });
    });

    describe('HTML String', function() {
      it('should find background images', function() {
        const items = detector.handler(htmlString);
        const expected = '/nala.jpg';
        expect(items).to.include(expected);
      });
      it('should find data-src attributes', function() {
        const items = detector.handler(htmlString);
        const expected = '/files/assets/test.jpg';
        expect(items).to.include(expected);
      });

      it('should find data-src-retina attributes', function() {
        const items = detector.handler(htmlString);
        const expected = '/files/assets/test-retina.jpg';
        expect(items).to.include(expected);
      });

      it('should append host and proto', function() {
        const items = detector.handler(htmlString, 'test.com', 'https');
        const expected = [
          'https://test.com/nala.jpg',
          'https://test.com/files/assets/test-retina.jpg',
          'https://test.com/files/assets/test.jpg',
        ];
        expect(items).to.eql(expected);
      });
    });
  });
});
