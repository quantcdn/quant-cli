/**
 * Test the image detection.
 */

const chaiAsPromied = require("chai-as-promised");
const chai = require("chai");

const rimg = require("../../src/helper/responsiveImages");
const fs = require('fs');

chai.use(chaiAsPromied);
const assert = chai.assert;
const expect = chai.expect;

const htmlString = fs.readFileSync("test/fixtures/responsive-images.html").toString();

describe('responsiveImages', function() {

  it('should find picture elements', function() {
    const images = rimg(htmlString, '');
    expect(images).to.include('elva-480w-close-portrait.jpg');
    expect(images).to.include('elva-800w.jpg');
  });

  it('should find srcset attributes', function() {
    const images = rimg(htmlString, '');
    expect(images).to.include('elva-fairy-320w.jpg');
    expect(images).to.include('elva-fairy-480w.jpg');
    expect(images).to.include('elva-fairy-640w.jpg');
  });

  it('should include the host', function() {
    const host = 'test.com.au';
    const images = rimg(htmlString, host);
    expect(images).to.include(`https://${host}/elva-fairy-320w.jpg`);
    expect(images).to.include(`https://${host}/elva-fairy-480w.jpg`);
    expect(images).to.include(`https://${host}/elva-fairy-640w.jpg`);
  });
});
