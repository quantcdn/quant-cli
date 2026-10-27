import { expect } from 'chai';
import { orderRules, matchRule, matchFilter, pathForms } from '../../../src/serve/rules.js';

const rule = (over = {}) => ({
  id: 'r', type: 'function', url: ['/api/*'], domain: ['any'], methods: null, weight: 0, disabled: false, fnUuid: 'u', ...over
});
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
});
