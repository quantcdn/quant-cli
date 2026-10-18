import { expect } from 'chai';
import sinon from 'sinon';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yargs from 'yargs';
import { manifestErrors } from '../../../src/helper/functions-manifest.js';

const command = (await import('../../../src/commands/functions-add.js')).default;
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('functions-add', () => {
  let dir;
  let cwd;

  beforeEach(() => {
    cwd = process.cwd();
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'quant-fn-add-'));
    process.chdir(dir);
    fs.mkdirSync('quant/edge-functions', { recursive: true });
    fs.writeFileSync('quant/edge-functions/api.js', 'return new Response("ok");');
    fs.writeFileSync('quant/edge-functions/auth.js', 'return new Response("", { status: 201 });');
    sinon.stub(console, 'error');
  });

  afterEach(() => {
    sinon.restore();
    process.chdir(cwd);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const run = (over = {}) => command.handler({ manifest: 'quant/edge-functions.json', path: 'quant/edge-functions/api.js', type: 'function', description: 'API', ...over });
  const read = () => JSON.parse(fs.readFileSync('quant/edge-functions.json', 'utf8'));

  it('creates the manifest with one valid entry and a new v4 uuid, and returns only the uuid', async () => {
    const uuid = await run({ id: 'my-api' });

    expect(uuid).to.match(V4);
    expect(read()).to.deep.equal([{ type: 'function', path: 'quant/edge-functions/api.js', description: 'API', id: 'my-api', uuid }]);
    expect(fs.readFileSync('quant/edge-functions.json', 'utf8')).to.match(/^\[\n {2}\{\n {4}"type"/).and.match(/\n$/);
    expect(manifestErrors(read())).to.deep.equal([]);
  });

  it('appends to an existing manifest and keeps existing entries as they are', async () => {
    const first = await run();
    const second = await run({ path: 'quant/edge-functions/auth.js', type: 'auth', description: 'Gate', id: 'gate' });

    const manifest = read();
    expect(manifest.map(entry => entry.uuid)).to.deep.equal([first, second]);
    expect(first).not.to.equal(second);
    expect(manifest[0]).not.to.have.property('id');
  });

  it('refuses a duplicate path (with or without ./) or id, and changes nothing', async () => {
    await run({ id: 'my-api' });
    const before = fs.readFileSync('quant/edge-functions.json', 'utf8');

    for (const over of [{ path: './quant/edge-functions/api.js' }, { path: 'quant/edge-functions/auth.js', id: 'my-api' }]) {
      try { await run(over); expect.fail('must refuse'); } catch (error) { expect(error.message).to.match(/already has an entry/); }
    }
    expect(fs.readFileSync('quant/edge-functions.json', 'utf8')).to.equal(before);
  });

  it('creates the manifest directory and stores the path without ./', async () => {
    fs.rmSync('quant', { recursive: true });
    fs.mkdirSync('src');
    fs.writeFileSync('src/api.js', 'x');

    await run({ manifest: 'quant/edge-functions.json', path: './src/api.js' });

    expect(read()[0].path).to.equal('src/api.js');
    expect(fs.readdirSync('quant')).to.deep.equal(['edge-functions.json']);
  });

  it('leaves no temporary file and no manifest when the write fails', async () => {
    sinon.stub(fs, 'renameSync').throws(Object.assign(new Error('disk full'), { code: 'ENOSPC' }));
    try { await run(); expect.fail('must fail'); } catch (error) { expect(error.code).to.equal('ENOSPC'); }
    expect(fs.readdirSync('quant')).to.deep.equal(['edge-functions']);
  });

  it('refuses a missing function file', async () => {
    try { await run({ path: 'quant/edge-functions/nope.js' }); expect.fail('must refuse'); } catch (error) { expect(error.message).to.include('Function file not found'); }
    expect(fs.existsSync('quant/edge-functions.json')).to.equal(false);
  });

  it('refuses to append to an invalid manifest and names the problem', async () => {
    fs.writeFileSync('quant/edge-functions.json', JSON.stringify([{ type: 'function', path: 'x.js', description: 'X' }]));
    try { await run(); expect.fail('must refuse'); } catch (error) { expect(error.message).to.include('Entry 0 (x.js): uuid is required'); }
  });

  it('validates --id and --description when parsing', () => {
    const parseOnly = { command: command.command, builder: command.builder, handler: () => {} };
    const parse = argv => yargs(argv).command(parseOnly).exitProcess(false).fail((msg, err) => { throw err || new Error(msg); }).parse();
    expect(() => parse(['functions-add', 'm.json', 'a.js', '--description', 'A', '--id', '1bad'])).to.throw('--id must be a lowercase slug');
    expect(() => parse(['functions-add', 'm.json', 'a.js', '--description', ' '])).to.throw('--description is required');
    expect(() => parse(['functions-add', 'm.json', 'a.js', '--description', 'A', '--type', 'edge'])).to.throw(/Invalid values|choices/i);
    expect(parse(['functions-add', 'm.json', 'a.js', '--description', 'A']).type).to.equal('function');
  });
});
