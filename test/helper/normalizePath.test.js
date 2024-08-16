/**
 * Test the path noramlizer.
 */
const normalizePaths = require('../../src/helper/normalizePaths');
const path = require('path');

describe('helpers::normalizePaths', () => {
  let chai, cap, expect;

  beforeEach(async () => {
    chai = await import('chai');
    cap = (await import('chai-as-promised')).default;

    chai.use(cap);
    expect = chai.expect;
  });

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
