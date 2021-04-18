/**
 * Tests for the info object.
 */
const chaiAsPromied = require("chai-as-promised");
const chai = require("chai");

const {QuantInfo} = require("../src/quant-client");

chai.use(chaiAsPromied);

const expect = chai.expect;

describe('QuantInfo', () => {

  let info;

  beforeEach(() => {
    info = new QuantInfo();
  });

  afterEach(() => {
    info = null;
  });

  it('should accept author user', () => {
    info.attr('author_user', 'author');
    expect(info.attributes.author_user).to.eql('author');
  });

  it('should verify author user', () => {
    expect(() => info.attr('author_user', 'a'.repeat(129))).to.throw(Error);
  });

  it('should accept author name', () => {
    info.attr('author_name', 'author');
    expect(info.attributes.author_name).to.eql('author');
  });

  it('should verify author name', () => {
    expect(() => info.attr('author_name', 'a'.repeat(129))).to.throw(Error);
  });

  it('should accept author email', () => {
    info.attr('author_email', 'author@email.com');
    expect(info.attributes.author_email).to.eql('author@email.com');
  });

  it('should verify author email', () => {
    expect(() => info.attr('author_email', 'a'.repeat(256))).to.throw(Error);
  });

  it('should accept log messages', () => {
    info.attr('log', 'update');
    expect(info.attributes.log).to.eql('update');
  });

  it('should verify log messages', () => {
    expect(() => info.attr('log', 'a'.repeat(256))).to.throw(Error);
  });

  it('should accept custom_1', () => {
    info.attr('custom_1', 'update');
    expect(info.attributes.custom_1).to.eql('update');
  });

  it('should verify custom_1', () => {
    expect(() => info.attr('custom_1', 'a'.repeat(256))).to.throw(Error);
  });

  it('should accept custom_2', () => {
    info.attr('custom_2', 'update');
    expect(info.attributes.custom_2).to.eql('update');
  });

  it('should verify custom_2', () => {
    expect(() => info.attr('custom_2', 'a'.repeat(256))).to.throw(Error);
  });

  it('should accept source', () => {
    info.attr('source', 'update');
    expect(info.attributes.source).to.eql('update');
  });

  it('should verify source', () => {
    expect(() => info.attr('source', 'a'.repeat(256))).to.throw(Error);
  });

  it('should return be cast to an object', () => {
    const obj = {
      'author_name': 'a',
      'author_name': 'a',
      'author_email': 'a',
      'log': 'a',
      'custom_1': 'a',
      'custom_2': 'a',
      'source': 'a',
    };

    for (const [k, v] of Object.entries(obj)) {
      info.attr(k, v);
    }

    expect(info.toObject()).to.eql(obj);
  });

});
