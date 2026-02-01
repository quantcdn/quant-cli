import { expect } from 'chai';
import isMD5Match from '../../../src/helper/is-md5-match.js';

describe('isMD5Match Helper', () => {
  it('should detect MD5 match in error response data', () => {
    const error = {
      response: {
        data: {
          errorMsg: 'MD5 already matches existing file.'
        }
      }
    };
    expect(isMD5Match(error)).to.be.true;
  });

  it('should detect MD5 match with "Published version" message in response', () => {
    const error = {
      response: {
        data: {
          errorMsg: 'Published version already has md5 abc123'
        }
      }
    };
    expect(isMD5Match(error)).to.be.true;
  });

  it('should detect MD5 match in error message', () => {
    const error = new Error('MD5 already matches');
    expect(isMD5Match(error)).to.be.true;
  });

  it('should detect MD5 match with "Published version" in error message', () => {
    const error = new Error('Published version already has md5 xyz789');
    expect(isMD5Match(error)).to.be.true;
  });

  it('should return false for non-MD5 match errors', () => {
    const error = new Error('Some other error');
    expect(isMD5Match(error)).to.be.false;
  });

  it('should handle missing response data', () => {
    const error = {
      response: {}
    };
    expect(isMD5Match(error)).to.be.false;
  });

  it('should handle null error', () => {
    expect(isMD5Match(null)).to.be.false;
  });

  it('should handle undefined error', () => {
    expect(isMD5Match(undefined)).to.be.false;
  });
});
