/**
 * Test the get files helper.
 */
const getFiles = require('../../src/helper/getFiles');

describe('helpers::getFiles', function() {
  let chai, cap, assert, expect;

  beforeEach(async () => {
    chai = await import('chai');
    cap = (await import('chai-as-promised')).default;

    chai.use(cap);
    assert = chai.assert;
    expect = chai.expect;
  });

  it('should return a promise', function() {
    return getFiles('test/fixtures')
        .then((files) => {
          assert.isTrue(true);
        });
  });

  it('should return contents of a given directory', async function() {
    const files = await getFiles('test/fixtures');

    const expected = [
      `${process.cwd()}/test/fixtures/index.html`,
      `${process.cwd()}/test/fixtures/nala.jpg`,
      `${process.cwd()}/test/fixtures/responsive-images.html`,
      `${process.cwd()}/test/fixtures/sample/nala.jpg`,
      `${process.cwd()}/test/fixtures/some-file-path.html`,
      `${process.cwd()}/test/fixtures/test.css`,
      `${process.cwd()}/test/fixtures/test.js`,
    ];

    expect(files).to.eql(expected);
  });

  it('should handle non-existent directories', async function() {
    return expect(getFiles('/not/here')).to.eventually.be.rejectedWith(Error);
  });
});
