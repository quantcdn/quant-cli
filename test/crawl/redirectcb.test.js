/**
 * Test the redirect determination logic.
 */
const {redirectHandler} = require('../../src/crawl/callbacks');

// Stubs
const client = require('../../src/quant-client');

describe('crawl::redirectHandler', function() {
  let quant;
  let chai, sinon, sinonChai;

  // Disable console log for neater test output.
  before(async () => {
    chai = await import('chai')
    sinon = await import('sinon')
    sinonChai = (await import('sinon-chai')).default;

    chai.should()
    chai.use(sinonChai)

    sinon.stub(console, 'log');
  });
  after(() => sinon.restore());

  beforeEach(() => {
    quant = {redirect: sinon.spy()};
  });

  afterEach(() => {
    quant = null;
  });

  it('should not redirect same paths', () => {
    const path = {path: '/test', host: 'test.com', url: 'http://test.com/test', stateData: {code: 302}};
    const dest = {path: '/test', host: 'test.com', url: 'http://test.com/test', stateData: {code: 302}};

    redirectHandler(quant, path, dest);
    quant.redirect.should.not.have.been.called;
  });

  it('should inherit HTTP code from response', () => {
    const path = {path: '/test', host: 'test.com', url: 'http://test.com/test', stateData: {code: 302}};
    const dest = {path: '/dest', host: 'test.com', url: 'http://test.com/dest', stateData: {code: 301}};

    redirectHandler(quant, path, dest);
    quant.redirect.should.have.been.calledOnceWith('/test', '/dest', 'quant-cli', 301);
  });

  it('should default to 301 codes', () => {
    const path = {path: '/test', host: 'test.com', url: 'http://test.com/test', stateData: {code: 302}};
    const dest = {path: '/dest', host: 'test.com', url: 'http://test.com/dest', stateData: {}};

    redirectHandler(quant, path, dest);
    quant.redirect.should.have.been.calledOnceWith('/test', '/dest', 'quant-cli', 301);
  });

  it('should be able to redirect bare /', () => {
    const path = {path: '/', host: 'test.com', url: 'http://test.com/', stateData: {code: 302}};
    const dest = {path: '/Home', host: 'test.com', url: 'http://test.com/Home', stateData: {code: 302}};
    redirectHandler(quant, path, dest);
    quant.redirect.should.have.been.calledOnceWith('/', '/Home', 'quant-cli', 302);
  });

  describe('internal', () => {

    it('should redirect paths ending with slashes', () => {
      const path = {path: '/test/', host: 'test.com', url: 'http://test.com/test/', stateData: {code: 302}};
      const dest = {path: '/test', host: 'test.com', url: 'http://test.com/test', stateData: {code: 302}};

      redirectHandler(quant, path, dest);
      quant.redirect.should.have.been.calledWith('/test/', '/test', 'quant-cli', 302);
      quant.redirect.should.have.been.calledOnce;
    });

    it('should redirect differing paths', () => {
      const path = {path: '/test', host: 'test.com', url: 'http://test.com/test', stateData: {code: 302}};
      const dest = {path: '/test-destination', host: 'test.com', url: 'http://test.com/test-destination', stateData: {code: 302}};

      redirectHandler(quant, path, dest);
      quant.redirect.should.have.been.calledWith('/test', '/test-destination', 'quant-cli', 302);
      quant.redirect.should.have.been.calledOnce;
    });
  });

  describe('external', () => {
    it('should redirect remote origins', () => {
      const path = {path: '/test', host: 'test.com', url: 'http://test.com/test', stateData: {code: 302}};
      const dest = {path: '/test-destination', host: 'google.com', url: 'http://google.com/test-destination', stateData: {code: 302}};

      redirectHandler(quant, path, dest);
      quant.redirect.should.have.been.calledWith('/test', 'http://google.com/test-destination', 'quant-cli', 302);
      quant.redirect.should.have.been.calledOnce;
    });
  });
});
