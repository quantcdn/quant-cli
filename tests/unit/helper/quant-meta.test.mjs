import { expect } from 'chai';
import fs from 'node:fs';
import { parseMeta, storeId } from '../../../src/helper/quant-meta.js';

const SRC = 'quant/meta.json';
const store = (over = {}) => ({ name: 'main', ...over });
const meta = (stores) => JSON.stringify({ kv_stores: stores });
const index = (over = {}) => ({ name: 'byStatus', collection: 'item', fields: ['status'], ...over });
const refuses = (stores, message) => expect(() => parseMeta(meta(stores), SRC)).to.throw(Error, `${SRC}: ${message}`);

describe('quant/meta.json parsing', () => {
  it('parses the Orbit template meta.json', () => {
    const text = fs.readFileSync(new URL('../../fixtures/orbit/quant/meta.json', import.meta.url), 'utf8');
    const { stores } = parseMeta(text, SRC);
    expect(stores).to.have.length(1);
    expect(stores[0].name).to.equal('orbit');
    expect(stores[0].indexes.map(i => i.name)).to.deep.equal(['projectsByStatus', 'projectsByOwner', 'projectNames']);
    expect(stores[0].indexes[0]).to.deep.equal({ name: 'projectsByStatus', collection: 'workspace:*:project', fields: ['workspace', 'status'], sortBy: 'updatedAt', count: true });
    expect(stores[0].initialValues).to.have.length(2);
  });

  it('returns no stores when meta.json declares none, or is not JSON and names no stores', () => {
    expect(parseMeta('{"title":"x"}', SRC)).to.deep.equal({ stores: [] });
    expect(parseMeta('not json', SRC)).to.deep.equal({ stores: [] });
  });

  it('names the file when JSON that declares kv_stores is invalid', () => {
    expect(() => parseMeta('{"kv_stores": [', SRC)).to.throw(Error, `${SRC}: `);
  });

  it('keeps flags only when true and an empty fields list', () => {
    const { stores } = parseMeta(meta([store({ indexes: [{ name: 'all', collection: 'item', fields: [], unique: false, count: true }] })]), SRC);
    expect(stores[0].indexes[0]).to.deep.equal({ name: 'all', collection: 'item', fields: [], count: true });
  });

  it('refuses an index with no fields list, as the portal does', () => {
    refuses([store({ indexes: [{ name: 'all', collection: 'item' }] })], 'Index all: fields must be a list of 0–3 distinct field names.');
  });

  it('refuses 11 stores', () => {
    refuses(Array.from({ length: 11 }, (_, i) => store({ name: `s${i}` })), 'kv_stores must be a list of at most 10 stores.');
  });

  it('refuses 101 initial values across stores', () => {
    const values = n => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, value: 1 }));
    refuses([store({ initial_values: values(60) }), store({ name: 'other', initial_values: values(41) })], 'At most 100 initial values may be declared across all stores.');
    refuses([store({ initial_values: values(101) })], 'initial_values must be a list of at most 100 key/value pairs.');
  });

  it('refuses declarations over 64 KiB', () => {
    const big = 'x'.repeat(15000);
    const initial_values = Array.from({ length: 5 }, (_, i) => ({ key: `k${i}`, value: big }));
    refuses([store({ initial_values })], 'KV declarations must be at most 64 KiB of JSON in total.');
  });

  it('refuses 21 indexes', () => {
    const indexes = Array.from({ length: 21 }, (_, i) => index({ name: `i${i}`, collection: `c${i}` }));
    refuses([store({ indexes })], 'indexes: must be a list of at most 20 indexes.');
  });

  it('refuses 6 indexes on one collection', () => {
    const indexes = Array.from({ length: 6 }, (_, i) => index({ name: `i${i}` }));
    refuses([store({ indexes })], 'Index i5: at most 5 indexes may use the same collection.');
  });

  it('refuses a repeated index name', () => {
    refuses([store({ indexes: [index(), index({ collection: 'other' })] })], 'Index byStatus: the name is already used in this store.');
  });

  it('refuses 5 values revealed once', () => {
    const initial_values = Array.from({ length: 5 }, (_, i) => ({ key: `k${i}:{sha256}`, generate: { bytes: 32, reveal: 'once' } }));
    refuses([store({ initial_values })], 'At most 4 generated values per store may be revealed once.');
  });

  it('refuses generate.bytes of 15 and 65', () => {
    for (const bytes of [15, 65]) {
      refuses([store({ initial_values: [{ key: 'k', generate: { bytes } }] })], 'Initial value k: generate.bytes must be an integer from 16 to 64.');
    }
  });

  it('refuses the index name 1abc', () => {
    refuses([store({ indexes: [index({ name: '1abc' })] })], 'indexes: each index needs a name of 1–64 letters, digits or underscores, starting with a letter.');
  });

  it('refuses a star inside a collection segment', () => {
    refuses([store({ indexes: [index({ collection: 'work*:x' })] })], "Index byStatus: collection must be 1–512 UTF-8 bytes of non-empty ':' segments; '*' is allowed only as a whole segment.");
  });

  it('limits a collection to 512 UTF-8 bytes', () => {
    expect(() => parseMeta(JSON.stringify({ kv_stores: [store({ indexes: [index({ collection: 'a'.repeat(512) })] })] }))).to.not.throw();
    refuses([store({ indexes: [index({ collection: 'a'.repeat(513) })] })], "Index byStatus: collection must be 1–512 UTF-8 bytes of non-empty ':' segments; '*' is allowed only as a whole segment.");
    refuses([store({ indexes: [index({ collection: 'é'.repeat(257) })] })], "Index byStatus: collection must be 1–512 UTF-8 bytes of non-empty ':' segments; '*' is allowed only as a whole segment.");
  });

  it('refuses 4 index fields', () => {
    refuses([store({ indexes: [index({ fields: ['a', 'b', 'c', 'd'] })] })], 'Index byStatus: fields must be a list of 0–3 distinct field names.');
  });

  it('refuses an index that is both unique and count', () => {
    refuses([store({ indexes: [index({ unique: true, count: true })] })], 'Index byStatus: an index cannot be both unique and count.');
  });

  it('refuses a unique index with no field', () => {
    refuses([store({ indexes: [index({ unique: true, fields: [] })] })], 'Index byStatus: a unique index needs at least one field.');
  });

  it('refuses a duplicate store name and an unknown store field', () => {
    refuses([store(), store()], 'KV store names must be unique lowercase slugs of 1–48 characters.');
    refuses([store({ extra: 1 })], 'Each KV store accepts only name, initial_values and indexes.');
  });
});

describe('storeId', () => {
  it('joins org, project and name', () => {
    expect(storeId('acme', 'site', 'orbit')).to.equal('acme-site-orbit');
  });

  it('refuses an id over 255 characters', () => {
    expect(() => storeId('a'.repeat(200), 'b'.repeat(50), 'orbit')).to.throw(Error);
  });
});
