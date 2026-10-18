import { expect } from 'chai';
import { manifestErrors, assertManifest, entryLabel } from '../../../src/helper/functions-manifest.js';

const entry = (over = {}) => ({ type: 'function', path: 'quant/edge-functions/api.js', description: 'API', uuid: '43aec1f0-095b-4a76-a9c8-934bf3d49d59', ...over });

describe('Function manifest schema', () => {
  it('accepts a valid manifest, with or without an id', () => {
    expect(manifestErrors([entry(), entry({ uuid: '00310c2c-c598-4d98-8a64-1e14955284d0', path: 'b.js', id: 'orbit-api-v1' })])).to.deep.equal([]);
  });

  it('accepts UUIDs with any version digit, as deployed manifests use', () => {
    for (const uuid of ['019361ae-2516-788a-8f50-e803ff561c34', '11111111-2222-9333-c444-555555555555', '00000000-0000-0000-0000-000000000000']) {
      expect(manifestErrors([entry({ uuid })]), uuid).to.deep.equal([]);
    }
  });

  it('requires an explicit uuid and names the entry', () => {
    const noUuid = entry();
    delete noUuid.uuid;
    expect(manifestErrors([noUuid])).to.deep.equal(['Entry 0 (quant/edge-functions/api.js): uuid is required']);
    expect(manifestErrors([entry({ uuid: '' })])).to.deep.equal(['Entry 0 (quant/edge-functions/api.js): uuid is required']);
    expect(manifestErrors([entry({ uuid: 'not-a-uuid' })])).to.deep.equal(['Entry 0 (quant/edge-functions/api.js): uuid is not a valid UUID']);
    expect(manifestErrors([entry({ uuid: 42 })])).to.deep.equal(['Entry 0 (quant/edge-functions/api.js): uuid is not a valid UUID']);
  });

  it('reports a duplicate uuid (case-insensitive) or id on the later entry', () => {
    const errors = manifestErrors([entry({ id: 'api' }), entry({ path: 'b.js', uuid: '43AEC1F0-095B-4A76-A9C8-934BF3D49D59', id: 'api' })]);
    expect(errors).to.deep.equal(['Entry 1 (b.js): uuid is used by another entry', 'Entry 1 (b.js): id is used by another entry']);
  });

  it('lists an entry\'s messages in the portal\'s order: required fields, then duplicates', () => {
    const missingDescription = { type: 'function', path: 'b.js', uuid: '43aec1f0-095b-4a76-a9c8-934bf3d49d59', id: 'api' };
    expect(manifestErrors([entry({ id: 'api' }), missingDescription])).to.deep.equal([
      'Entry 1 (b.js): description is required',
      'Entry 1 (b.js): uuid is used by another entry',
      'Entry 1 (b.js): id is used by another entry'
    ]);
  });

  it('trims a description the way the portal does (a no-break space is text)', () => {
    expect(manifestErrors([entry({ description: ' \t\n ' })])).to.deep.equal(['Entry 0 (quant/edge-functions/api.js): description is required']);
    expect(manifestErrors([entry({ description: '\u00a0' })])).to.deep.equal([]);
  });

  it('checks path, type, description and the id slug', () => {
    expect(manifestErrors([{ uuid: '43aec1f0-095b-4a76-a9c8-934bf3d49d59', type: 'proxy', description: ' ', id: '1api' }])).to.deep.equal([
      'Entry 0: path is required',
      'Entry 0: type must be function, edge, auth or filter',
      'Entry 0: description is required',
      'Entry 0: id must be a lowercase slug that starts with a letter (1-48 characters)'
    ]);
    expect(manifestErrors([entry({ id: 'a'.repeat(49) })])[0]).to.include('id must be a lowercase slug');
  });

  it('refuses a non-array manifest and a non-object entry', () => {
    expect(manifestErrors({ functions: [] })).to.deep.equal(['The function manifest must be a JSON array.']);
    expect(manifestErrors(['api.js'])).to.deep.equal(['Entry 0: each entry must be an object']);
  });

  it('labels an entry by its path without a leading ./', () => {
    expect(entryLabel(3, { path: './a/b.js' })).to.equal('Entry 3 (a/b.js)');
    expect(entryLabel(0, null)).to.equal('Entry 0');
  });

  it('lists every problem in one error', () => {
    expect(() => assertManifest([{}, entry()], 'quant/edge-functions.json')).to.throw(/quant\/edge-functions\.json is not a valid function manifest:\n {2}Entry 0: uuid is required\n {2}Entry 0: path is required/);
    expect(() => assertManifest([entry()], 'x.json')).not.to.throw();
  });
});
