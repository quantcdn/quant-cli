import { expect } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createExecutor } from '../../../src/serve/functions.js';
import { startWatchdog } from '../../../src/serve/watchdog.js';
import { kvDouble } from '../../helpers/kv-double.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

describe('serve watchdog', () => {
  let dir;
  let watchdog;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-watchdog-'));
    watchdog = startWatchdog({ budgetMs: 15000 });
  });

  afterEach(() => {
    watchdog.stop();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function fn(uuid, waitMs) {
    const file = path.join(dir, `${uuid}.js`);
    fs.writeFileSync(file, `await new Promise((resolve) => setTimeout(resolve, ${waitMs})); return new Response('${uuid}');`);
    return { uuid, path: file };
  }

  it('names the oldest run that is still in flight', async () => {
    const executor = createExecutor({ kvStore: kvDouble({}), org: 'acme', project: 'site', root: dir, log: () => {}, watch: watchdog });
    const slow = executor.run(fn('slow-one', 200), { url: 'http://localhost/a' });
    await sleep(20);
    const fast = executor.run(fn('fast-one', 40), { url: 'http://localhost/b' });
    await sleep(20);
    expect(watchdog.running()).to.equal('slow-one');
    await fast;
    expect(watchdog.running()).to.equal('slow-one');
    await slow;
    expect(watchdog.running()).to.equal(null);
  });

  it('names the next run when the oldest one ends', async () => {
    const first = watchdog.enter('first');
    const second = watchdog.enter('second');
    watchdog.leave(first);
    expect(watchdog.running()).to.equal('second');
    watchdog.leave(second);
    expect(watchdog.running()).to.equal(null);
  });
});
