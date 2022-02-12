/**
 * Test the Quant client.
 */

const client = require('../src/quant-client');
const config = require('../src/config');

// Testers.
const chai = require('chai');
const sinon = require('sinon');
const assert = chai.assert;
const expect = chai.expect;

// Stubbable.
const request = require('request');
const fs = require('fs');

const headers = {
  'User-Agent': 'Quant (+http://api.quantcdn.io)',
  'Quant-Token': 'test',
  'Quant-Customer': 'dev',
  'Quant-Project': 'test',
  'Content-Type': 'application/json',
};

describe('Quant Client', function() {
  let cget;
  let requestGet;
  let requestPost;
  let requestPatch;

  beforeEach(function() {
    cget = sinon.stub(config, 'get');
    cget.withArgs('endpoint').returns('http://localhost:8081');
    cget.withArgs('clientid').returns('dev');
    cget.withArgs('token').returns('test');
    cget.withArgs('project').returns('test');
  });

  afterEach(function() {
    cget.restore();
  });

  describe('GET /ping', function() {
    afterEach(function() {
      requestGet.restore();
    });

    it('should return a valid project', async function() {
      const response = {
        statusCode: 200,
        body: {
          error: false,
          project: 'test',
        },
      };

      requestGet = sinon
          .stub(request, 'get')
          .yields(null, response, response.body);

      const data = await client(config).ping();

      assert.hasAnyKeys(data, 'project');
      assert.equal(data.project, 'test');
      expect(requestGet.calledOnceWith({
        url: 'http://localhost:8081/ping',
        json: true,
        headers,
      })).to.be.true;
    });

    it('should handle error responses', async function() {
      const response = {
        statusCode: 403,
        body: {
          error: true,
          errorMsg: 'Forbidden',
        },
      };

      requestPost = sinon.stub(request, 'get')
          .yields(null, response, response.body);

      try {
        await client(config).ping();
      } catch (err) {
        assert.ok(true);
        expect(requestGet.calledOnceWith({
          url: 'http://localhost:8081/ping',
          json: true,
          headers,
        })).to.be.true;
        assert.typeOf(err, 'Error');
        assert.equal(err.message, 'Forbidden');
        return;
      }

      assert.fail('Ping did not raise the error');
    });
  });

  describe('POST /', function() {
    let file;
    let fr;

    beforeEach(function() {
      // Set the directory so we can test for path inference.
      cget.withArgs('dir').returns(process.cwd() + '/test/fixtures');
      file = sinon.stub(fs, 'createReadStream').returns({});
      fr = sinon.stub(fs, 'readFileSync').returns('');
    });

    afterEach(function() {
      requestPost.restore();
      file.restore();
      fr.restore();
    });

    describe('send', function() {
      it('should accept index.html files', async function() {
        const response = {
          statusCode: 200,
          body: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'index.html',
            errorMsg: '',
            error: false,
          },
        };

        requestPost = sinon
            .stub(request, 'post')
            .yields(null, response, response.body);

        await client(config).send('test/fixtures/index.html');

        expect(
            requestPost.calledOnceWith({
              url: 'http://localhost:8081',
              json: true,
              body: {url: '/index.html', content: '', published: true, find_attachments: false},
              headers: {
                'User-Agent': 'Quant (+http://api.quantcdn.io)',
                'Quant-Token': 'test',
                'Quant-Customer': 'dev',
                'Quant-Project': 'test',
                'Content-Type': 'application/json',
              },
            }),
        ).to.be.true;
      });

      it('should accept custom headers', async function() {
        const response = {
          statusCode: 200,
          body: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'index.html',
            errorMsg: '',
            error: false,
          },
        };

        requestPost = sinon
            .stub(request, 'post')
            .yields(null, response, response.body);

        await client(config).send('test/fixtures/index.html', 'test/fixtures', true, false, false, {test: 'headers'});

        expect(
            requestPost.calledOnceWith({
              url: 'http://localhost:8081',
              json: true,
              body: {
                url: '/test/fixtures',
                find_attachments: false,
                content: '',
                published: true,
                headers: {'test': 'headers'},
              },
              headers: {
                'User-Agent': 'Quant (+http://api.quantcdn.io)',
                'Quant-Token': 'test',
                'Quant-Customer': 'dev',
                'Quant-Project': 'test',
                'Content-Type': 'application/json',
              },
            }),
        ).to.be.true;
      });

      it('should find attachments', async function() {
        const response = {
          statusCode: 200,
          body: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'index.html',
            errorMsg: '',
            error: false,
          },
        };

        requestPost = sinon
            .stub(request, 'post')
            .yields(null, response, response.body);

        await client(config).send('test/fixtures/index.html', 'test/fixtures/index.html', true, true);

        expect(
            requestPost.calledOnceWith({
              url: 'http://localhost:8081',
              json: true,
              body: {
                url: '/test/fixtures/index.html',
                find_attachments: true,
                content: '',
                published: true,
              },
              headers: {
                'User-Agent': 'Quant (+http://api.quantcdn.io)',
                'Quant-Token': 'test',
                'Quant-Customer': 'dev',
                'Quant-Project': 'test',
                'Content-Type': 'application/json',
              },
            }),
        ).to.be.true;
      });

      it('should accept a location', async function() {
        const response = {
          statusCode: 200,
          body: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'index.html',
            errorMsg: '',
            error: false,
          },
        };

        requestPost = sinon
            .stub(request, 'post')
            .yields(null, response, response.body);

        await client(config).send('test/fixtures/index.html', 'test/index.html');

        expect(
            requestPost.calledOnceWith({
              url: 'http://localhost:8081',
              json: true,
              body: {
                url: '/test/index.html',
                find_attachments: false,
                content: '',
                published: true,
              },
              headers: {
                'User-Agent': 'Quant (+http://api.quantcdn.io)',
                'Quant-Token': 'test',
                'Quant-Customer': 'dev',
                'Quant-Project': 'test',
                'Content-Type': 'application/json',
              },
            }),
        ).to.be.true;
      });

      it('should accept a location', async function() {
        const response = {
          statusCode: 200,
          body: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'index.html',
            errorMsg: '',
            error: false,
          },
        };

        requestPost = sinon
            .stub(request, 'post')
            .yields(null, response, response.body);

        await client(config).send('test/fixtures/index.html', 'test/index.html');

        expect(
            requestPost.calledOnceWith({
              url: 'http://localhost:8081',
              json: true,
              body: {
                url: '/test/index.html',
                find_attachments: false,
                content: '',
                published: true,
              },
              headers: {
                'User-Agent': 'Quant (+http://api.quantcdn.io)',
                'Quant-Token': 'test',
                'Quant-Customer': 'dev',
                'Quant-Project': 'test',
                'Content-Type': 'application/json',
              },
            }),
        ).to.be.true;
      });

      it('should accept published status', async function() {
        const response = {
          statusCode: 200,
          body: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'index.html',
            errorMsg: '',
            error: false,
          },
        };

        requestPost = sinon
            .stub(request, 'post')
            .yields(null, response, response.body);

        await client(config).send('test/fixtures/index.html', 'test/index.html', false);

        expect(
            requestPost.calledOnceWith({
              url: 'http://localhost:8081',
              json: true,
              body: {
                url: '/test/index.html',
                find_attachments: false,
                content: '',
                published: false,
              },
              headers: {
                'User-Agent': 'Quant (+http://api.quantcdn.io)',
                'Quant-Token': 'test',
                'Quant-Customer': 'dev',
                'Quant-Project': 'test',
                'Content-Type': 'application/json',
              },
            }),
        ).to.be.true;
      });

      it('should accept html files', async function() {
        const response = {
          statusCode: 200,
          body: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'index.html',
            errorMsg: '',
            error: false,
          },
        };

        requestPost = sinon
            .stub(request, 'post')
            .yields(null, response, response.body);

        await client(config).send('test/fixtures/some-file-path.html');

        // Expect the post for the redirect.
        expect(
            requestPost.calledWith({
              url: 'http://localhost:8081/redirect',
              headers: {
                'User-Agent': 'Quant (+http://api.quantcdn.io)',
                'Quant-Token': 'test',
                'Quant-Customer': 'dev',
                'Quant-Project': 'test',
                'Content-Type': 'application/json',
              },
              json: true,
              body: {
                url: '/some-file-path.html',
                redirect_url: '/some-file-path',
                redirect_http_code: 302,
                published: true,
              },
            }),
        ).to.be.true;

        // Expect the post for the content.
        expect(
            requestPost.calledWith({
              url: 'http://localhost:8081',
              json: true,
              body: {
                url: '/some-file-path/index.html',
                content: '',
                published: true,
                find_attachments: false,
              },
              headers: {
                'User-Agent': 'Quant (+http://api.quantcdn.io)',
                'Quant-Token': 'test',
                'Quant-Customer': 'dev',
                'Quant-Project': 'test',
                'Content-Type': 'application/json',
              },
            }),
        ).to.be.true;
      });

      it('should accept files', async function() {
        const response = {
          statusCode: 200,
          body: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'nala.jpg',
            errorMsg: '',
            error: false,
          },
        };
        requestPost = sinon
            .stub(request, 'post')
            .yields(null, response, response.body);

        const data = await client(config).file('test/fixtures/nala.jpg');

        expect(
            requestPost.calledOnceWith({
              url: 'http://localhost:8081',
              headers: {
                ...headers,
                'Content-Type': 'multipart/form-data',
                'Quant-File-Url': '/nala.jpg',
              },
              json: true,
              formData: {data: {}},
            }),
        ).to.be.true;
        assert.equal(data, response.body);
      });
    });

    describe('markup', function() {
      it('should accept an index.html', async function() {
        const response = {
          statusCode: 200,
          body: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'index.html',
            errorMsg: '',
            error: false,
          },
        };
        requestPost = sinon
            .stub(request, 'post')
            .yields(null, response, response.body);

        const data = await client(config).markup('test/fixtures/index.html');

        expect(
            requestPost.calledOnceWith({
              url: 'http://localhost:8081',
              json: true,
              body: {url: '/index.html', content: '', published: true, find_attachments: false},
              headers: {
                'User-Agent': 'Quant (+http://api.quantcdn.io)',
                'Quant-Token': 'test',
                'Quant-Customer': 'dev',
                'Quant-Project': 'test',
                'Content-Type': 'application/json',
              },
            }),
        ).to.be.true;
        assert.equal(data, response.body);
      });
      it('should not accept other file types', async function() {
        const response = {
          statusCode: 200,
          body: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'index.html',
            errorMsg: '',
            error: false,
          },
        };
        requestPost = sinon
            .stub(request, 'post')
            .yields(null, response, response.body);
        try {
          await client(config).markup('test/fixtures/test.js');
        } catch (err) {
          assert.typeOf(err, 'Error');
          assert.equal(err.message, 'Can only upload an index.html file.');
        }
      });
      it('should accept custom headers', async function() {
        const response = {
          statusCode: 200,
          body: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'index.html',
            errorMsg: '',
            error: false,
          },
        };
        requestPost = sinon
            .stub(request, 'post')
            .yields(null, response, response.body);

        const data = await client(config).markup('test/fixtures/index.html', 'test/fixtures', true, false, {test: 'header'});

        expect(
            requestPost.calledOnceWith({
              url: 'http://localhost:8081',
              json: true,
              body: {
                url: '/test/fixtures',
                find_attachments: false,
                content: '',
                published: true,
                headers: {'test': 'header'},
              },
              headers: {
                'User-Agent': 'Quant (+http://api.quantcdn.io)',
                'Quant-Token': 'test',
                'Quant-Customer': 'dev',
                'Quant-Project': 'test',
                'Content-Type': 'application/json',
              },
            }),
        ).to.be.true;
        assert.equal(data, response.body);
      });
    });
    describe('files', function() {
      it('should accept a local file', async function() {
        const response = {
          statusCode: 200,
          body: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'nala.jpg',
            errorMsg: '',
            error: false,
          },
        };
        requestPost = sinon.stub(request, 'post')
            .yields(null, response, response.body);

        const data = await client(config).file('test/fixtures/nala.jpg');

        expect(
            requestPost.calledOnceWith({
              url: 'http://localhost:8081',
              headers: {
                ...headers,
                'Content-Type': 'multipart/form-data',
                'Quant-File-Url': '/nala.jpg',
              },
              json: true,
              formData: {data: {}},
            }),
        ).to.be.true;
        assert.equal(data, response.body);
      });

      it('should accept custom headers', async function() {
        const response = {
          statusCode: 200,
          body: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'nala.jpg',
            errorMsg: '',
            error: false,
          },
        };
        requestPost = sinon.stub(request, 'post')
            .yields(null, response, response.body);

        const data = await client(config).file('test/fixtures/nala.jpg', 'nala.jpg', false, {test: 'headers'});

        expect(
            requestPost.calledOnceWith({
              url: 'http://localhost:8081',
              json: true,
              headers: {
                'User-Agent': 'Quant (+http://api.quantcdn.io)',
                'Quant-Token': 'test',
                'Quant-Customer': 'dev',
                'Quant-Project': 'test',
                'Content-Type': 'multipart/form-data',
                'Quant-File-Url': '/nala.jpg',
                'Quant-File-Headers': '{"test":"headers"}',
              },
              formData: {data: {}},
            }),
        ).to.be.true;
        assert.equal(data, response.body);
      });

      it('should accept empty object', async function() {
        const response = {
          statusCode: 200,
          body: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'nala.jpg',
            errorMsg: '',
            error: false,
          },
        };
        requestPost = sinon.stub(request, 'post')
            .yields(null, response, response.body);

        const data = await client(config).file('test/fixtures/nala.jpg', 'nala.jpg', false, {});

        expect(
            requestPost.calledOnceWith({
              url: 'http://localhost:8081',
              json: true,
              headers: {
                'User-Agent': 'Quant (+http://api.quantcdn.io)',
                'Quant-Token': 'test',
                'Quant-Customer': 'dev',
                'Quant-Project': 'test',
                'Content-Type': 'multipart/form-data',
                'Quant-File-Url': '/nala.jpg',
              },
              formData: {data: {}},
            }),
        ).to.be.true;
        assert.equal(data, response.body);
      });

      it('should accept nested local files', async function() {
        const response = {
          statusCode: 200,
          body: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'nala.jpg',
            errorMsg: '',
            error: false,
          },
        };
        requestPost = sinon.stub(request, 'post')
            .yields(null, response, response.body);

        const data = await client(config).file('test/fixtures/sample/nala.jpg');

        expect(
            requestPost.calledOnceWith({
              url: 'http://localhost:8081',
              headers: {
                ...headers,
                'Content-Type': 'multipart/form-data',
                'Quant-File-Url': '/sample/nala.jpg',
              },
              json: true,
              formData: {data: {}},
            }),
        ).to.be.true;
        assert.equal(data, response.body);
      });
      it('should accept a custom location', async function() {
        const response = {
          statusCode: 200,
          body: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'nala.jpg',
            errorMsg: '',
            error: false,
          },
        };
        requestPost = sinon
            .stub(request, 'post')
            .yields(null, response, response.body);

        const data = await client(config)
            .file('test/fixtures/sample/nala.jpg', '/path-to-file/nala.jpg');

        expect(
            requestPost.calledOnceWith({
              url: 'http://localhost:8081',
              headers: {
                ...headers,
                'Content-Type': 'multipart/form-data',
                'Quant-File-Url': '/path-to-file/nala.jpg',
              },
              json: true,
              formData: {data: {}},
            }),
        ).to.be.true;
        assert.equal(data, response.body);
      });
      it('should accept a nested custom location', async function() {
        const response = {
          statusCode: 200,
          body: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'nala.jpg',
            errorMsg: '',
            error: false,
          },
        };
        requestPost = sinon
            .stub(request, 'post')
            .yields(null, response, response.body);

        const data = await client(config)
            .file('test/fixtures/sample/nala.jpg', '/path/to/file/nala.jpg');

        expect(
            requestPost.calledOnceWith({
              url: 'http://localhost:8081',
              headers: {
                ...headers,
                'Content-Type': 'multipart/form-data',
                'Quant-File-Url': '/path/to/file/nala.jpg',
              },
              json: true,
              formData: {data: {}},
            }),
        ).to.be.true;
        assert.equal(data, response.body);
      });
      it('should accept css', async function() {
        const response = {
          statusCode: 200,
          body: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'test.css',
            errorMsg: '',
            error: false,
          },
        };
        requestPost = sinon
            .stub(request, 'post')
            .yields(null, response, response.body);

        const data = await client(config).file('test/fixtures/test.css');

        expect(
            requestPost.calledOnceWith({
              url: 'http://localhost:8081',
              headers: {
                ...headers,
                'Content-Type': 'multipart/form-data',
                'Quant-File-Url': '/test.css',
              },
              json: true,
              formData: {data: {}},
            }),
        ).to.be.true;
        assert.equal(data, response.body);
      });
      it('should accept js', async function() {
        const response = {
          statusCode: 200,
          body: {
            quant_revision: 1,
            md5: 'da697d6f9a318fe26d2dd75a6b123df0',
            quant_filename: 'test.js',
            errorMsg: '',
            error: false,
          },
        };
        requestPost = sinon
            .stub(request, 'post')
            .yields(null, response, response.body);

        const data = await client(config).file('test/fixtures/test.js');

        expect(
            requestPost.calledOnceWith({
              url: 'http://localhost:8081',
              headers: {
                ...headers,
                'Content-Type': 'multipart/form-data',
                'Quant-File-Url': '/test.js',
              },
              json: true,
              formData: {data: {}},
            }),
        ).to.be.true;
        assert.equal(data, response.body);
      });
    });
  });

  describe('PATCH /unpublish', function() {
    this.afterEach(function() {
      requestPatch.restore();
    });

    it('should remove index.html', async function() {
      const response = {
        statusCode: 200,
        body: {project: 'test'},
      };
      requestPatch = sinon.stub(request, 'patch').yields(null, response, response.body); // eslint-disable-line max-len

      await client(config).unpublish('/path/to/index.html');
      expect(
          requestPatch.calledOnceWith({
            url: 'http://localhost:8081/unpublish',
            headers: {
              ...headers,
              'Quant-Url': '/path/to',
            },
            json: true,
          }),
      ).to.be.true;
    });
  });

  describe('POST /redirect', function() {
    afterEach(function() {
      requestPost.restore();
    });

    it('should accept from and to', async function() {
      const response = {
        statusCode: 200,
        body: {
          quant_revision: 1,
          url: '/a',
          errorMsg: '',
          error: false,
        },
      };
      requestPost = sinon.stub(request, 'post').yields(null, response, response.body); // eslint-disable-line max-len

      await client(config).redirect('/a', '/b');

      expect(
          requestPost.calledOnceWith({
            url: 'http://localhost:8081/redirect',
            headers,
            json: true,
            body: {
              url: '/a',
              redirect_url: '/b',
              redirect_http_code: 302,
              published: true,
            },
          }),
      ).to.be.true;
    });

    it('should accept status code', async function() {
      const response = {
        statusCode: 200,
        body: {
          quant_revision: 1,
          url: '/a',
          errorMsg: '',
          error: false,
        },
      };
      requestPost = sinon.stub(request, 'post').yields(null, response, response.body); // eslint-disable-line max-len

      await client(config).redirect('/a', '/b', 'test', 301); // eslint-disable-line max-len

      expect(
          requestPost.calledOnceWith({
            url: 'http://localhost:8081/redirect',
            headers,
            json: true,
            body: {
              url: '/a',
              redirect_url: '/b',
              redirect_http_code: 301,
              published: true,
              info: {author_user: 'test'},
            },
          }),
      ).to.be.true;
    });

    it('should not accept an invalid http status code', async function() {
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

  describe('POST /proxy', function() {
    afterEach(function() {
      requestPost.restore();
    });

    it('should accept url and destination as minimum', async function() {
      const response = {
        statusCode: 200,
        body: {
          quant_revision: 1,
          url: '/test',
          errorMsg: '',
          error: false,
        },
      };
      requestPost = sinon
          .stub(request, 'post')
          .yields(null, response, response.body);

      await client(config).proxy(
          '/test',
          'http://google.com',
      );

      expect(
          requestPost.calledOnceWith({
            url: 'http://localhost:8081/proxy',
            json: true,
            headers,
            body: {
              url: '/test',
              destination: 'http://google.com',
              published: true,
            },
          }),
      ).to.be.true;
    });

    it('should handle API errors', async function() {
      const response = {
        statusCode: 403,
        body: {
          errorMsg: 'Forbidden',
          error: true,
        },
      };
      requestPost = sinon
          .stub(request, 'post')
          .yields(null, response, response.body);

      try {
        await client(config).proxy('/test', 'http://google.com');
      } catch (err) {
        assert.typeOf(err, 'Error');
        assert.equal(err.message, 'Forbidden');
        expect(
            requestPost.calledOnceWith({
              url: 'http://localhost:8081/proxy',
              json: true,
              headers,
              body: {
                url: '/test',
                destination: 'http://google.com',
                published: true,
              },
            }),
        ).to.be.true;
        return;
      }
    });

    it('should add basic auth', async function() {
      const response = {
        statusCode: 200,
        body: {
          quant_revision: 1,
          url: '/test',
          errorMsg: '',
          error: false,
        },
      };

      requestPost = sinon.stub(request, 'post')
          .yields(null, response, response.body);

      await client(config).proxy('/test', 'http://google.com', true, 'user', 'password');

      expect(
          requestPost.calledOnceWith({
            url: 'http://localhost:8081/proxy',
            json: true,
            headers,
            body: {
              url: '/test',
              destination: 'http://google.com',
              published: true,
              basic_auth_user: 'user',
              basic_auth_pass: 'password',
            },
          }),
      ).to.be.true;
    });
  });
});
