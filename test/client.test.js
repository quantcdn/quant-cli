/**
 * Test the Quant client.
 */

const client = require('../src/quant-client');
const config = require('../src/config');

// Stubbable.
const axios = require('axios');
const fs = require('fs');

const headers = {
  'User-Agent': 'Quant (+http://api.quantcdn.io)',
  'Quant-Token': 'test',
  'Quant-Customer': 'dev',
  'Quant-Organisation': 'dev',
  'Quant-Project': 'test',
  'Content-Type': 'application/json',
};

describe('Quant Client', function () {
  let cget;
  let requestGet;
  let requestPost;
  let requestPatch;

  let chai, sinon, assert, expect;

  beforeEach(async () => {
    chai = await import('chai');
    sinon = await import('sinon');
    assert = chai.assert;
    expect = chai.expect;

    cget = sinon.stub(config, 'get');
    cget.withArgs('endpoint').returns('http://localhost:8081');
    cget.withArgs('clientid').returns('dev');
    cget.withArgs('token').returns('test');
    cget.withArgs('project').returns('test');
  });

  afterEach(function () {
    cget.restore();
    sinon.restore();
  });

  describe('GET /ping', function () {
    afterEach(function () {
      requestGet.restore();
    });

    it('should return a valid project', async function () {
      const response = {
        status: 200,
        data: {
          error: false,
          project: 'test',
        },
        headers: {},
        config: {},
        request: {},
      };

      requestGet = sinon.stub(axios, 'get').resolves(response);

      const data = await client(config).ping();

      assert.hasAnyKeys(data, 'project');
      assert.equal(data.project, 'test');
      expect(requestGet.calledOnceWith('http://localhost:8081/ping', { headers })).to.be.true;
    });

    it('should handle error responses', async function () {
      const response = {
        status: 403,
        data: {
          error: true,
          errorMsg: 'Forbidden',
        },
        headers: {},
        config: {},
        request: {},
      };

      requestPost = sinon.stub(axios, 'get').resolves(response);

      try {
        await client(config).ping();
      } catch (err) {
        assert.ok(true);
        expect(requestGet.calledOnceWith('http://localhost:8081/ping', { headers })).to.be.true;
        assert.typeOf(err, 'Error');
        assert.equal(err.message, 'Forbidden');
        return;
      }

      assert.fail('Ping did not raise the error');
    });
  });

  describe('POST /', function () {
    let file;
    let fr;

    beforeEach(function () {
      // Set the directory so we can test for path inference.
      cget.withArgs('dir').returns(process.cwd() + '/test/fixtures');
      file = sinon.stub(fs, 'createReadStream').returns({});
      fr = sinon.stub(fs, 'readFileSync').returns('');
    });

    afterEach(function () {
      requestPost.restore();
      file.restore();
      fr.restore();
    });

    describe('send', function () {
      it('should accept index.html files', async function () {
        const response = {
          status: 200,
          data: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'index.html',
            errorMsg: '',
            error: false,
          },
          headers: {},
          config: {},
          request: {},
        };

        requestPost = sinon.stub(axios, 'post').resolves(response);

        await client(config)
          .send('test/fixtures/index.html', false, true, false, true, true);

        expect(
          requestPost.calledOnceWith(
            'http://localhost:8081',
            {
              url: '/index.html',
              find_attachments: false,
              content: '',
              published: true
            },
            {
              headers: {
                'User-Agent': 'Quant (+http://api.quantcdn.io)',
                'Quant-Token': 'test',
                'Quant-Customer': 'dev',
                'Quant-Organisation': 'dev',
                'Quant-Project': 'test',
                'Content-Type': 'application/json',
                'Quant-Skip-Purge': 'true'
              }
            }
          )
        ).to.be.true;
      });

      it('should accept custom headers', async function () {
        const response = {
          status: 200,
          data: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'index.html',
            errorMsg: '',
            error: false,
          },
          headers: {},
          config: {},
          request: {},
        };

        requestPost = sinon.stub(axios, 'post').resolves(response)

        await client(config)
          .send('test/fixtures/index.html', 'test/fixtures', true, false, false, false, { test: 'headers' });

        expect(
          requestPost.calledOnceWith(
            'http://localhost:8081',
            {
              url: '/test/fixtures',
              find_attachments: false,
              content: '',
              published: true,
              headers: { 'test': 'headers' },
            },
            {
              headers: {
                'User-Agent': 'Quant (+http://api.quantcdn.io)',
                'Quant-Token': 'test',
                'Quant-Customer': 'dev',
                'Quant-Organisation': 'dev',
                'Quant-Project': 'test',
                'Content-Type': 'application/json',
              }
            },
          )
        ).to.be.true;
      });

      it('should find attachments', async function () {
        const response = {
          status: 200,
          data: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'index.html',
            errorMsg: '',
            error: false,
          },
          headers: {},
          config: {},
          request: {},
        };

        requestPost = sinon.stub(axios, 'post').resolves(response)

        await client(config).send('test/fixtures/index.html', 'test/fixtures/index.html', true, true);

        expect(
          requestPost.calledOnceWith(
            'http://localhost:8081',
            {
              url: '/test/fixtures',
              find_attachments: true,
              content: '',
              published: true,
            },
            {
              headers: {
                'User-Agent': 'Quant (+http://api.quantcdn.io)',
                'Quant-Token': 'test',
                'Quant-Customer': 'dev',
                'Quant-Organisation': 'dev',
                'Quant-Project': 'test',
                'Content-Type': 'application/json',
              }
            },
          )
        ).to.be.true;
      });

      it('should accept a location', async function () {
        const response = {
          status: 200,
          data: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'index.html',
            errorMsg: '',
            error: false,
          },
          headers: {},
          config: {},
          request: {},
        };

        requestPost = sinon.stub(axios, 'post').resolves(response)

        await client(config).send('test/fixtures/index.html', 'test/index.html');

        expect(
          requestPost.calledOnceWith(
            'http://localhost:8081',
            {
              url: '/test',
              find_attachments: false,
              content: '',
              published: true
            },
            {
              headers: {
                'User-Agent': 'Quant (+http://api.quantcdn.io)',
                'Quant-Token': 'test',
                'Quant-Customer': 'dev',
                'Quant-Organisation': 'dev',
                'Quant-Project': 'test',
                'Content-Type': 'application/json'
              }
            }
          )
        ).to.be.true;
      });

      it('should accept published status', async function () {
        const response = {
          status: 200,
          data: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'index.html',
            errorMsg: '',
            error: false,
          },
          headers: {},
          config: {},
          request: {},
        };

        requestPost = sinon.stub(axios, 'post').resolves(response);

        await client(config).send('test/fixtures/index.html', 'test/index.html', false);

        expect(
          requestPost.calledOnceWith(
            'http://localhost:8081',
            {
              url: '/test',
              find_attachments: false,
              content: '',
              published: false,
            },
            {
              headers: {
                'User-Agent': 'Quant (+http://api.quantcdn.io)',
                'Quant-Token': 'test',
                'Quant-Customer': 'dev',
                'Quant-Organisation': 'dev',
                'Quant-Project': 'test',
                'Content-Type': 'application/json',
              }
            }
          )
        ).to.be.true;
      });

      it('should accept html files', async function () {
        const response = {
          status: 200,
          data: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'index.html',
            errorMsg: '',
            error: false,
          },
          headers: {},
          config: {},
          request: {},
        };

        requestPost = sinon.stub(axios, 'post').resolves(response);

        await client(config).send('test/fixtures/some-file-path.html');

        // Expect the post for the redirect.
        expect(
          requestPost.calledWith(
            'http://localhost:8081',
            {
              url: '/some-file-path.html',
              find_attachments: false,
              content: '',
              published: true
            },
            {
              headers: {
                'User-Agent': 'Quant (+http://api.quantcdn.io)',
                'Quant-Token': 'test',
                'Quant-Customer': 'dev',
                'Quant-Organisation': 'dev',
                'Quant-Project': 'test',
                'Content-Type': 'application/json'
              }
            }
          )
        ).to.be.true;
      });

      it('should accept files', async function () {
        const response = {
          status: 200,
          data: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'nala.jpg',
            errorMsg: '',
            error: false,
          },
          headers: {},
          config: {},
          request: {},
        };
        requestPost = sinon.stub(axios, 'post').resolves(response)

        const data = await client(config).file('test/fixtures/nala.jpg');

        expect(
          requestPost.calledOnceWith(
            'http://localhost:8081',
            { data: {} },
            {
              headers: {
                ...headers,
                'Content-Type': 'multipart/form-data',
                'Quant-File-Url': '/nala.jpg',
              }
            }
          )
        ).to.be.true;
        assert.equal(data, response.data);
      });
    });

    describe('markup', function () {
      it('should accept an index.html', async function () {
        const response = {
          status: 200,
          data: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'index.html',
            errorMsg: '',
            error: false,
          },
          headers: {},
          config: {},
          request: {},
        };
        requestPost = sinon.stub(axios, 'post').resolves(response);

        const data = await client(config).markup('test/fixtures/index.html');

        expect(
          requestPost.calledOnceWith(
            'http://localhost:8081',
            { url: '/index.html', content: '', published: true, find_attachments: false },
            {
              headers: {
                'User-Agent': 'Quant (+http://api.quantcdn.io)',
                'Quant-Token': 'test',
                'Quant-Customer': 'dev',
                'Quant-Organisation': 'dev',
                'Quant-Project': 'test',
                'Content-Type': 'application/json',
              }
            }
          )
        ).to.be.true;
        assert.equal(data, response.data);
      });
      it('should not accept other file types', async function () {
        const response = {
          status: 200,
          data: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'index.html',
            errorMsg: '',
            error: false,
          },
          headers: {},
          config: {},
          request: {},
        };
        requestPost = sinon.stub(axios, 'post').resolves(response);
        try {
          await client(config).markup('test/fixtures/test.js');
        } catch (err) {
          assert.typeOf(err, 'Error');
          assert.equal(err.message, 'Can only upload an index.html file.');
        }
      });
      it('should accept custom headers', async function () {
        const response = {
          statusCode: 200,
          data: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'index.html',
            errorMsg: '',
            error: false,
          },
        };
        requestPost = sinon.stub(axios, 'post').resolves(response)

        const data = await client(config).markup('test/fixtures/index.html', 'test/fixtures', true, false, { test: 'header' });

        expect(
          requestPost.calledOnceWith(
            'http://localhost:8081',
            {
              url: '/test/fixtures',
              find_attachments: false,
              content: '',
              published: true,
              headers: { 'test': 'header' },
            },
            {
              headers: {
                'User-Agent': 'Quant (+http://api.quantcdn.io)',
                'Quant-Token': 'test',
                'Quant-Customer': 'dev',
                'Quant-Organisation': 'dev',
                'Quant-Project': 'test',
                'Content-Type': 'application/json',
              }
            }
          )
        ).to.be.true;
        assert.equal(data, response.data);
      });
    });
    describe('files', function () {
      it('should accept a local file', async function () {
        const response = {
          status: 200,
          data: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'nala.jpg',
            errorMsg: '',
            error: false,
          },
          headers: {},
          config: {},
          request: {},
        };
        requestPost = sinon.stub(axios, 'post').resolves(response);

        const data = await client(config).file('test/fixtures/nala.jpg');

        expect(
          requestPost.calledOnceWith(
            'http://localhost:8081',
            { data: {} },
            {
              headers: {
                ...headers,
                'Content-Type': 'multipart/form-data',
                'Quant-File-Url': '/nala.jpg',
              }
            }
          )
        ).to.be.true;
        assert.equal(data, response.data);
      });

      it('should accept custom headers', async function () {
        const response = {
          status: 200,
          data: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'nala.jpg',
            errorMsg: '',
            error: false,
          },
          headers: {},
          config: {},
          request: {},
        };
        requestPost = sinon.stub(axios, 'post').resolves(response);

        const data = await client(config).file('test/fixtures/nala.jpg', 'nala.jpg', false, { test: 'headers' });

        expect(
          requestPost.calledOnceWith(
            'http://localhost:8081',
            { data: {} },
            {
              headers: {
                'User-Agent': 'Quant (+http://api.quantcdn.io)',
                'Quant-Token': 'test',
                'Quant-Customer': 'dev',
                'Quant-Organisation': 'dev',
                'Quant-Project': 'test',
                'Content-Type': 'multipart/form-data',
                'Quant-File-Url': '/nala.jpg',
                'Quant-File-Headers': '{"test":"headers"}',
              }
            }
          )
        ).to.be.true;
        assert.equal(data, response.data);
      });

      it('should accept empty object', async function () {
        const response = {
          status: 200,
          data: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'nala.jpg',
            errorMsg: '',
            error: false,
          },
          headers: {},
          config: {},
          request: {},
        };
        requestPost = sinon.stub(axios, 'post').resolves(response);

        const data = await client(config).file('test/fixtures/nala.jpg', 'nala.jpg', false, {});

        expect(
          requestPost.calledOnceWith(
            'http://localhost:8081',
            {
              data: {}
            },
            {
              headers: {
                'User-Agent': 'Quant (+http://api.quantcdn.io)',
                'Quant-Token': 'test',
                'Quant-Customer': 'dev',
                'Quant-Organisation': 'dev',
                'Quant-Project': 'test',
                'Content-Type': 'multipart/form-data',
                'Quant-File-Url': '/nala.jpg',
              },
            }
          ),
        ).to.be.true;
        assert.equal(data, response.data);
      });

      it('should accept nested local files', async function () {
        const response = {
          status: 200,
          data: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'nala.jpg',
            errorMsg: '',
            error: false,
          },
          headers: {},
          config: {},
          request: {},
        };
        requestPost = sinon.stub(axios, 'post').resolves(response);

        const data = await client(config).file('test/fixtures/sample/nala.jpg');

        expect(
          requestPost.calledOnceWith(
            'http://localhost:8081',
            { data: {} },
            {
              headers: {
                ...headers,
                'Content-Type': 'multipart/form-data',
                'Quant-File-Url': '/sample/nala.jpg',
              },
            }
          )
        ).to.be.true;
        assert.equal(data, response.data);
      });
      it('should accept a custom location', async function () {
        const response = {
          status: 200,
          data: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'nala.jpg',
            errorMsg: '',
            error: false,
          },
          headers: {},
          config: {},
          request: {},
        };
        requestPost = sinon.stub(axios, 'post').resolves(response);

        const data = await client(config)
          .file('test/fixtures/sample/nala.jpg', '/path-to-file/nala.jpg');

        expect(
          requestPost.calledOnceWith(
            'http://localhost:8081',
            { data: {} },
            {
              headers: {
                ...headers,
                'Content-Type': 'multipart/form-data',
                'Quant-File-Url': '/path-to-file/nala.jpg',
              }
            }
          ),
        ).to.be.true;
        assert.equal(data, response.data);
      });
      it('should accept a nested custom location', async function () {
        const response = {
          status: 200,
          data: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'nala.jpg',
            errorMsg: '',
            error: false,
          },
          headers: {},
          config: {},
          request: {},
        };
        requestPost = sinon.stub(axios, 'post').resolves(response);

        const data = await client(config)
          .file('test/fixtures/sample/nala.jpg', '/path/to/file/nala.jpg');

        expect(
          requestPost.calledOnceWith(
            'http://localhost:8081',
            { data: {} },
            {
              headers: {
                ...headers,
                'Content-Type': 'multipart/form-data',
                'Quant-File-Url': '/path/to/file/nala.jpg',
              }
            }
          ),
        ).to.be.true;
        assert.equal(data, response.data);
      });
      it('should accept css', async function () {
        const response = {
          status: 200,
          data: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'test.css',
            errorMsg: '',
            error: false,
          },
          headers: {},
          config: {},
          request: {},
        };
        requestPost = sinon.stub(axios, 'post').resolves(response);

        const data = await client(config).file('test/fixtures/test.css');

        expect(
          requestPost.calledOnceWith(
            'http://localhost:8081',
            { data: {} },
            {
              headers: {
                ...headers,
                'Content-Type': 'multipart/form-data',
                'Quant-File-Url': '/test.css',
              }
            }
          ),
        ).to.be.true;
        assert.equal(data, response.data);
      });
      it('should accept js', async function () {
        const response = {
          status: 200,
          data: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'test.js',
            errorMsg: '',
            error: false,
          },
          headers: {},
          config: {},
          request: {},
        };
        requestPost = sinon.stub(axios, 'post').resolves(response);

        const data = await client(config).file('test/fixtures/test.js');

        expect(
          requestPost.calledOnceWith(
            'http://localhost:8081',
            { data: {} },
            {
              headers: {
                ...headers,
                'Content-Type': 'multipart/form-data',
                'Quant-File-Url': '/test.js',
              },
            }
          )
        ).to.be.true;
        assert.equal(data, response.data);
      });
    });
  });

  describe('PATCH /unpublish', function () {
    this.afterEach(function () {
      requestPatch.restore();
    });

    it('should remove index.html', async function () {
      const response = {
        status: 200,
        data: { project: 'test' },
        headers: {},
        config: {},
        request: {},
      };
      requestPatch = sinon.stub(axios, 'patch').resolves(response);

      await client(config).unpublish('/path/to/index.html');
      expect(
        requestPatch.calledOnceWith(
          'http://localhost:8081/unpublish',
          {},
          {
            headers: {
              ...headers,
              'Quant-Url': '/path/to',
            },
          }
        )
      ).to.be.true;
    });
  });

  describe('POST /redirect', function () {
    afterEach(function () {
      requestPost.restore();
    });

    it('should accept from and to', async function () {
      const response = {
        status: 200,
        data: {
          quant_revision: 1,
          url: '/a',
          errorMsg: '',
          error: false,
        },
        headers: {},
        config: {},
        request: {},
      };
      requestPost = sinon.stub(axios, 'post').resolves(response);

      await client(config).redirect('/a', '/b');

      expect(
        requestPost.calledOnceWith(
          'http://localhost:8081/redirect',
        {
            url: '/a',
            redirect_url: '/b',
            redirect_http_code: 302,
            published: true,
          },
          { headers }
        ),
      ).to.be.true;
    });

    it('should accept status code', async function () {
      const response = {
        status: 200,
        data: {
          quant_revision: 1,
          url: '/a',
          errorMsg: '',
          error: false,
        },
        headers: {},
        config: {},
        request: {},
      };
      requestPost = sinon.stub(axios, 'post').resolves(response);

      await client(config).redirect('/a', '/b', 'test', 301);

      expect(
        requestPost.calledOnceWith(
          'http://localhost:8081/redirect',
          {
            url: '/a',
            redirect_url: '/b',
            redirect_http_code: 301,
            published: true,
            info: { author_user: 'test' },
          },
          { headers }
        ),
      ).to.be.true;
    });

    it('should not accept an invalid http status code', async function () {
      try {
        await client(config).redirect('/a', '/b', 'test', 200);
      } catch (err) {
        assert.typeOf(err, 'Error');
        assert.equal(err.message, 'A valid redirect status code is required');
      }
      try {
        await client(config).redirect('/a', '/b', 'test', 401);
      } catch (err) {
        assert.typeOf(err, 'Error');
        assert.equal(
          err.message,
          'A valid redirect status code is required',
        );
      }
    });
  });

});
