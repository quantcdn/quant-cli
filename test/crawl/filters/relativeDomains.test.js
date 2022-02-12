/**
 * Test the redirect determination logic.
 */
const {relativeDomains} = require('../../../src/crawl/filters');

const chai = require('chai');
const sinon = require('sinon');

describe('crawl:filters:relativeDomains', function() {

  const opts = {host: 'localhost', port: 3000};

  // Disable console log for neater test output.
  before(() => sinon.stub(console, 'log'));
  after(() => sinon.restore());

  it('should define an option', () => {
    chai.expect(relativeDomains.option).to.eql('rewrite');
  });

  it('should replace host name', () => {
    let string = 'https://localhost/test/link';
    string = relativeDomains.handler(string, opts);

    chai.expect(string).to.eql('/test/link');
  });

  it('should replace ports', () => {
    let string = 'https://localhost:3000/test/link';
    string = relativeDomains.handler(string, opts);

    chai.expect(string).to.eql('/test/link');
  });

  it('should not replace remote domains', () => {
    let string = 'https://google.com/test/link';
    string = relativeDomains.handler(string, opts);

    chai.expect(string).to.eql('https://google.com/test/link');
  });

  it('should replace all occurrences', () => {
    let string = '<a href="https://localhost:3000/test/link">test link</a>' +
      '<p>Some other thing</p>' +
      '<a href="https://google.com/deeplink">Google</a>' +
      '<p>Some other thing</p>' +
      '<p>Some other thing</p>' +
      '<p>Some other thing</p>' +
      '<p>Some other thing</p>' +
      'https://localhost:3000/test-other-link';

    string = relativeDomains.handler(string, opts);

    chai.expect(string).to.not.include('https://localhost:3000');
    chai.expect(string).to.include('https://google.com/deeplink');
    chai.expect(string).to.include('/test/link');
    chai.expect(string).to.include('/test-other-link');
  });

  it('should replace extra domains', () => {
    let string = '<a href="https://localhost:3000/test/link">test link</a>' +
      '<p>Some other thing</p>' +
      '<a href="https://content.localhost/path/to/somewhere">Extra</a>' +
      '<p>Some other thing</p>' +
      '<p>Some other thing</p>' +
      '<p>Some other thing</p>' +
      '<p>Some other thing</p>' +
      'https://localhost:3000/test-other-link';

    string = relativeDomains.handler(string, opts, {'extra-domains': 'content.localhost'});

    chai.expect(string).to.not.include('https://localhost:3000');
    chai.expect(string).to.not.include('https://content.localhost');
    chai.expect(string).to.include('/test/link');
    chai.expect(string).to.include('/path/to/somewhere');
  });
  it('should replace multiple extra domains', () => {
    let string = '<a href="https://localhost:3000/test/link">test link</a>' +
      '<p>Some other thing</p>' +
      '<a href="https://content.localhost/path/to/somewhere">Extra</a>' +
      '<a href="https://content.main.com.au/path/to/somewhere">Extra</a>' +
      '<p>Some other thing</p>' +
      '<p>Some other thing</p>' +
      '<p>Some other thing</p>' +
      '<p>Some other thing</p>' +
      'https://localhost:3000/test-other-link';

    string = relativeDomains.handler(string, opts, {
      'extra-domains': 'content.localhost, content.main.com.au',
    });

    chai.expect(string).to.not.include('https://localhost:3000');
    chai.expect(string).to.not.include('https://content.localhost');
    chai.expect(string).to.not.include('https://content.main.com.au');
    chai.expect(string).to.include('/test/link');
    chai.expect(string).to.include('/path/to/somewhere');
  });
});
