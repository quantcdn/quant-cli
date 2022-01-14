/**
 * Test the image detection.
 */

const chaiAsPromied = require("chai-as-promised");
const chai = require("chai");

const detector = require("../../../src/crawl/detectors/responsiveImg");
const fs = require('fs');

chai.use(chaiAsPromied);
const assert = chai.assert;
const expect = chai.expect;

const htmlString = fs.readFileSync("test/fixtures/responsive-images.html").toString();

describe('crawl:detectors:responsiveImg', function() {
  describe('applies', () => {
    it('should apply to HTML', () => {
      const res = {};
      res.headers = {};
      res.headers['content-type'] = 'text/html';
      expect(detector.applies(res)).to.be.true;
    });

    it('should not apply to other mime types', () => {
      const res = {};
      res.headers = {};
      const mimes = [
        'text/css',
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
    it('should find picture elements', function() {
      const images = detector.handler(htmlString, '');
      expect(images).to.include('elva-480w-close-portrait.jpg');
      expect(images).to.include('elva-800w.jpg');
    });

    it('should find srcset attributes', function() {
      const images = detector.handler(htmlString, '');
      expect(images).to.include('elva-fairy-320w.jpg');
      expect(images).to.include('elva-fairy-480w.jpg');
      expect(images).to.include('elva-fairy-640w.jpg');
    });

    it('should include the host', function() {
      const host = 'test.com.au';
      const images = detector.handler(htmlString, host);
      expect(images).to.include(`https://${host}/elva-fairy-320w.jpg`);
      expect(images).to.include(`https://${host}/elva-fairy-480w.jpg`);
      expect(images).to.include(`https://${host}/elva-fairy-640w.jpg`);
    });

    it('should not duplicate the host', function() {
      const host = 'test.com.au';
      const images = detector.handler(htmlString, host);
      expect(images).to.not.include(`https://${host}/https:/${host}/hotlinked-image.jpg`);
      expect(images).to.include(`https://${host}/hotlinked-image.jpg`);
      expect(images).to.include(`https://${host}/hotlinked-image-480w.jpg`);
      expect(images).to.include(`https://${host}/hotlinked-image-640w.jpg`);
    });
  });
});
