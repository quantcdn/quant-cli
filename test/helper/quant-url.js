/**
 * Test the URL helpers.
 */
const url = require('../../src/helper/quant-url');

describe('helpers::url', () => {
  let chai, cap, expect;

  beforeEach(async () => {
    chai = await import('chai');
    cap = (await import('chai-as-promised')).default;
    chai.use(cap);
    expect = chai.expect;
  });

  describe('prepare', () => {
    it('should remove index.html', () => {
      expect(url.prepare('/test/index.html')).to.eql('/test');
    });
    it('should keep html files', () => {
      expect(url.prepare('/test.html')).to.eql('/test.html');
    });
    it('should return / for only index', () => {
      expect(url.prepare('/index.html')).to.eql('/');
      expect(url.prepare('index.html')).to.eql('/');
    });
    it('should respect nested structures', () => {
      expect(url.prepare('/nested/directory/index.html')).to.eql('/nested/directory');
    });
    it('should handle missing leading /', () => {
      expect(url.prepare('test/index.html')).to.eql('/test');
    });
    it('should not partial match index.html', () => {
      expect(url.prepare('/old-index.html')).to.eql('/old-index.html');
    });
    it('should normalize case', () => {
      expect(url.prepare('/StRaNgE-CaSE/index.HTML')).to.eql('/strange-case');
    });
  });
});
