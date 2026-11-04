import { expect } from 'chai';
import { orderRules, matchRule, matchRules, matchFilter, matchErrorPage, pathForms, ruleCaptures } from '../../../src/serve/rules.js';

const ACTION = { function: 'edge_fn', auth: 'edge_auth', filter: 'edge_filter' };
const rule = (over = {}) => {
  const base = { id: 'r', type: 'function', url: ['/api/*'], domain: ['any'], methods: null, weight: 0, disabled: false, fnUuid: 'u', ...over };
  return { action: ACTION[base.type], ...base };
};
const ctx = (over = {}) => ({ host: 'example.com', method: 'GET', pathname: '/api/projects', search: '', ...over });

describe('serve rules', () => {
  describe('pathForms', () => {
    it('returns raw, lowercased and lowercased without trailing /index.html', () => {
      expect(pathForms('/Docs/Index.html')).to.deep.equal(['/Docs/Index.html', '/docs/index.html', '/docs']);
      expect(pathForms('/index.html')[2]).to.equal('/');
      expect(pathForms('/a')).to.deep.equal(['/a', '/a', '/a']);
    });
  });

  describe('orderRules', () => {
    it('sorts ascending by weight and keeps ties stable', () => {
      const rules = [rule({ id: 'c', weight: 5 }), rule({ id: 'a', weight: -1 }), rule({ id: 'b', weight: 5 }), rule({ id: 'd', weight: 0 })];
      expect(orderRules(rules).map(r => r.id)).to.deep.equal(['a', 'd', 'c', 'b']);
      expect(rules[0].id).to.equal('c');
    });
  });

  describe('matchRule', () => {
    it('matches a wildcard path case-insensitively', () => {
      expect(matchRule([rule()], ctx())).to.not.equal(null);
      expect(matchRule([rule()], ctx({ pathname: '/API/projects' }))).to.not.equal(null);
    });

    it('needs at least one character for a wildcard', () => {
      expect(matchRule([rule()], ctx({ pathname: '/api' }))).to.equal(null);
      expect(matchRule([rule()], ctx({ pathname: '/api/' }))).to.equal(null);
    });

    it('anchors the pattern and treats other characters literally', () => {
      expect(matchRule([rule()], ctx({ pathname: '/x/api/a' }))).to.equal(null);
      expect(matchRule([rule({ url: ['/a.b'] })], ctx({ pathname: '/aXb' }))).to.equal(null);
      expect(matchRule([rule({ url: ['/a.b'] })], ctx({ pathname: '/a.b' }))).to.not.equal(null);
    });

    it('matches a query pattern only with the query', () => {
      const r = rule({ url: ['/search?q=*'] });
      expect(matchRule([r], ctx({ pathname: '/search', search: '?q=cats' }))).to.equal(r);
      expect(matchRule([r], ctx({ pathname: '/search', search: '' }))).to.equal(null);
      expect(matchRule([r], ctx({ pathname: '/search', search: '?q=' }))).to.equal(null);
    });

    it('matches the path against the index.html form', () => {
      const r = rule({ url: ['/docs'] });
      expect(matchRule([r], ctx({ pathname: '/docs/index.html' }))).to.equal(r);
    });

    it('removes the port and lowercases the host', () => {
      const r = rule({ domain: ['example.com'] });
      expect(matchRule([r], ctx({ host: 'Example.COM:8080' }))).to.equal(r);
      expect(matchRule([r], ctx({ host: 'other.com:8080' }))).to.equal(null);
      expect(matchRule([rule({ domain: ['any'] })], ctx({ host: 'whatever:1' }))).to.not.equal(null);
    });

    it('refuses a method that is not listed', () => {
      const r = rule({ methods: ['POST'] });
      expect(matchRule([r], ctx({ method: 'GET' }))).to.equal(null);
      expect(matchRule([r], ctx({ method: 'POST' }))).to.equal(r);
    });

    it('refuses a method in the methodsNot list', () => {
      const r = rule({ methodsNot: ['DELETE'] });
      expect(matchRule([r], ctx({ method: 'DELETE' }))).to.equal(null);
      expect(matchRule([r], ctx({ method: 'GET' }))).to.equal(r);
    });

    it('skips disabled rules', () => {
      expect(matchRule([rule({ disabled: true })], ctx())).to.equal(null);
    });

    it('returns the first match in the order given', () => {
      const a = rule({ id: 'a' });
      const b = rule({ id: 'b' });
      expect(matchRule([a, b], ctx())).to.equal(a);
    });

    it('does not return filter rules', () => {
      expect(matchRule([rule({ type: 'filter' })], ctx())).to.equal(null);
    });
  });

  describe('matchFilter', () => {
    it('returns the first enabled matching filter rule only', () => {
      const fn = rule({ id: 'fn' });
      const off = rule({ id: 'off', type: 'filter', disabled: true });
      const f = rule({ id: 'f', type: 'filter' });
      expect(matchFilter([fn, off, f], ctx())).to.equal(f);
      expect(matchFilter([fn], ctx())).to.equal(null);
    });
  });

  describe('error page rules', () => {
    const page = (over = {}) => rule({ id: 'e', action: 'error_page', url: ['*'], config: { status_codes: ['404'], error_page_path: '/p' }, ...over });

    it('are not in the rule stage', () => {
      expect(matchRule([page()], ctx())).to.equal(null);
      expect(matchRules([page()], ctx())).to.deep.equal([]);
    });

    it('match only for a listed status', () => {
      const e = page();
      expect(matchErrorPage([e], ctx(), 404)).to.equal(e);
      expect(matchErrorPage([e], ctx(), 500)).to.equal(null);
      expect(matchErrorPage([page({ disabled: true })], ctx(), 404)).to.equal(null);
    });

    it('do not throw when status_codes is not a list', () => {
      for (const codes of ['404', 404, { a: 1 }, null]) {
        expect(matchErrorPage([page({ config: { status_codes: codes } })], ctx(), 404)).to.equal(null);
      }
    });
  });

  describe('ruleCaptures', () => {
    it('returns the text of each * from the first matching pattern', () => {
      const r = rule({ url: ['/none/*', '/blogs/*/category/*'] });
      expect(ruleCaptures(r, ctx({ pathname: '/Blogs/Ada/category/maths' }))).to.deep.equal({ groups: ['Ada', 'maths'], withQuery: false });
      expect(ruleCaptures(r, ctx({ pathname: '/other' }))).to.equal(null);
    });

    it('matches a pattern with ? against the path and query', () => {
      const r = rule({ url: ['/search?q=*'] });
      expect(ruleCaptures(r, ctx({ pathname: '/search', search: '?q=cats' }))).to.deep.equal({ groups: ['cats'], withQuery: true });
    });
  });
});
