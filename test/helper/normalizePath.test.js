/**
 * Test the path noramlizer.
 */

const chaiAsPromied = require("chai-as-promised");
const chai = require("chai");

const normalizePaths = require('../../src/helper/normalizePaths');
const path = require('path');

chai.use(chaiAsPromied);

const expect = chai.expect;

describe('helpers::normalizePaths', () => {

  it('should convert system paths', () => {
    // Bit of a strange test cause tests always run in poisx envs.
    const localPath = '/path/to/file';
    expect(normalizePaths(localPath)).to.eql('/path/to/file');
  });

  it('should convert win paths', () => {
    // Bit of a strange test cause tests always run in poisx envs.
    const localPath = '\\path\\to\\file';
    expect(normalizePaths(localPath, path.win32.sep)).to.eql('/path/to/file');
  });

});
