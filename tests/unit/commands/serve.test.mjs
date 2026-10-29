import { expect } from 'chai';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import net from 'node:net';
import yargs from 'yargs';
import serve, {
  resolveOptions,
  runServe,
  startupLines,
  stopRun,
  versionInfo,
  STOP_SIGNALS
} from '../../../src/commands/serve.js';
import { getCommand, getCommandOptions } from '../../../src/commandLoader.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// A shell command that runs the script with node. The script is in a file,
// so the command needs no quote escaping.
function nodeCommand(dir, source) {
  const file = path.join(dir, `script-${Math.random().toString(36).slice(2)}.js`);
  fs.writeFileSync(file, source);
  return `node ${JSON.stringify(file)}`;
}

const ORBIT = path.join(HERE, '..', '..', 'fixtures', 'orbit');

function parse(argv) {
  let parsed = null;
  yargs(['serve', ...argv]).command(serve.command, serve.describe, serve.builder, (args) => { parsed = args; }).parseSync();
  return parsed;
}

function noGit() {
  return null;
}

describe('serve command', () => {
  describe('--version-info', () => {
    it('prints the package versions and the pinned tag', async () => {
      const lines = (await serve.handler({ 'version-info': true })).split('\n');
      expect(lines[0]).to.match(/^quant-cli \d+\.\d+\.\d+/);
      expect(lines.some((line) => /^@quantcdn\/edge-kv \d/.test(line))).to.equal(true);
      expect(lines.some((line) => /^@quantcdn\/edge-conformance \d/.test(line))).to.equal(true);
      expect(lines.some((line) => /^@quantcdn\/kv-ledger-conformance \d.* \(edge-kv-v[^)]+\)$/.test(line))).to.equal(true);
    });

    it('prints the tested spec when a package is not installed', () => {
      const root = JSON.parse(fs.readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
      const spec = root.devDependencies['@quantcdn/edge-conformance'];
      const lines = versionInfo().split('\n');
      const line = lines.find((l) => l.startsWith('@quantcdn/edge-conformance'));
      expect(line).to.match(/^@quantcdn\/edge-conformance (\d|not installed \(tested with .+\)$)/);
      if (line.includes('not installed')) expect(line).to.include(`(tested with ${spec.split('#').pop()})`);
    });

    it('is exported for reuse', () => {
      expect(versionInfo()).to.include('quant-cli');
    });
  });

  let tmp;
  let output;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-cmd-'));
    output = [];
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('is registered with the menu label', async () => {
    expect(await getCommand('serve')).to.equal(serve);
    expect(getCommandOptions()).to.deep.include({ value: 'serve', label: 'Run the site locally' });
    expect(serve.command).to.equal('serve [dir]');
  });

  it('uses the defaults', () => {
    const options = resolveOptions(parse([]), { root: tmp, gitUserName: noGit });
    expect(options).to.include({
      root: tmp, dir: 'dist', port: 8787, host: '127.0.0.1', org: 'local', project: 'dev', userName: 'Owner',
      functions: 'quant/edge-functions.json', rules: 'quant/edge-rules.json', meta: 'quant/meta.json',
      fixtures: 'quant/kv-fixtures', indexes: 'active', kvLag: 0
    });
  });

  it('uses the same defaults for menu arguments', () => {
    const options = resolveOptions({ dir: '' }, { root: tmp, gitUserName: noGit });
    expect(options).to.include({ dir: 'dist', port: 8787, host: '127.0.0.1', org: 'local', project: 'dev' });
  });

  it('reads clientid and project from quant.json', () => {
    fs.writeFileSync(path.join(tmp, 'quant.json'), JSON.stringify({ clientid: 'acme', project: 'site', token: 'secret' }));
    const options = resolveOptions(parse([]), { root: tmp, gitUserName: noGit });
    expect(options).to.include({ org: 'acme', project: 'site' });
    expect(JSON.stringify(options)).not.to.include('secret');
  });

  it('reads quant.json softly', () => {
    fs.writeFileSync(path.join(tmp, 'quant.json'), '{ broken');
    const options = resolveOptions(parse([]), { root: tmp, gitUserName: noGit });
    expect(options).to.include({ org: 'local', project: 'dev' });
  });

  it('lets the flags override quant.json', () => {
    fs.writeFileSync(path.join(tmp, 'quant.json'), JSON.stringify({ clientid: 'acme', project: 'site' }));
    const args = parse(['public', '--port', '9000', '--host', '0.0.0.0', '--org', 'o', '--project', 'p', '--domain', 'example.com', '--client-ip', '1.2.3.4', '--geo', '{"city":"Perth"}']);
    const options = resolveOptions(args, { root: tmp, gitUserName: noGit });
    expect(options).to.include({ dir: 'public', port: 9000, host: '0.0.0.0', org: 'o', project: 'p', domain: 'example.com', clientIp: '1.2.3.4' });
    expect(options.geo).to.deep.equal({ city: 'Perth' });
  });

  it('takes --user-name from git config, then Owner', () => {
    expect(resolveOptions(parse([]), { root: tmp, gitUserName: () => 'Ann Lee' }).userName).to.equal('Ann Lee');
    expect(resolveOptions(parse([]), { root: tmp, gitUserName: () => '' }).userName).to.equal('Owner');
    expect(resolveOptions(parse(['--user-name', 'Bo']), { root: tmp, gitUserName: () => 'Ann Lee' }).userName).to.equal('Bo');
  });

  it('refuses --geo that is not a JSON object', () => {
    expect(() => resolveOptions(parse(['--geo', '[1]']), { root: tmp, gitUserName: noGit })).to.throw('--geo');
  });

  it('takes --clock real (the default) or manual', () => {
    expect(resolveOptions(parse([]), { root: tmp, gitUserName: noGit }).clock).to.equal('real');
    expect(resolveOptions(parse(['--clock', 'manual']), { root: tmp, gitUserName: noGit }).clock).to.equal('manual');
    expect(() => resolveOptions({ clock: 'fast' }, { root: tmp, gitUserName: noGit })).to.throw('--clock must be real or manual');
  });

  for (const flag of [['--pull-rules'], ['--kv-remote', 'orbit']]) {
    it(`stops for ${flag[0]}, which is available in a later release`, () => {
      expect(() => resolveOptions(parse(flag), { root: tmp, gitUserName: noGit }))
        .to.throw(`${flag[0]} is available in a later release`);
    });
  }

  it('refuses --kv-lag that is not a whole number of milliseconds', () => {
    expect(() => resolveOptions(parse(['--kv-lag', '1.5']), { root: tmp, gitUserName: noGit })).to.throw('--kv-lag');
  });

  it('prints the URL, stores, rules, libraries, warnings and keys in order', () => {
    const text = startupLines({
      url: 'http://127.0.0.1:8787',
      host: '127.0.0.1',
      summary: {
        stores: [{ name: 'orbit', id: 'local-dev-orbit' }],
        rules: [{ id: 'api', type: 'function', urls: ['/api/*'] }],
        libraries: ['jose'],
        warnings: ['A warning.']
      },
      keys: [{ label: 'Owner access key', value: 'abc123' }]
    }).join('\n');
    const order = ['http://127.0.0.1:8787', 'orbit', 'api function /api/*', 'jose', 'A warning.', 'Owner access key', 'abc123'];
    const positions = order.map((part) => text.indexOf(part));
    expect(positions.every((value) => value >= 0)).to.equal(true);
    expect([...positions].sort((a, b) => a - b)).to.deep.equal(positions);
  });

  it('lists the local ledgers and the manual clock', () => {
    const summary = { stores: [], rules: [], libraries: [], warnings: [] };
    const ledgers = [{ store: 'orbit', defs: [{ name: 'audit' }, { name: 'events' }] }];
    const text = startupLines({ url: 'http://127.0.0.1:8787', host: '127.0.0.1', summary, ledgers, clock: 'manual' }).join('\n');
    expect(text).to.include('Ledgers (from quant/kv-ledgers.json, active at start: quant serve skips the activation delay):');
    expect(text).to.include('  orbit → audit, events');
    expect(text).to.include('Clock: manual. Time moves only with POST /_quant_serve/clock.');
    const plain = startupLines({ url: 'http://127.0.0.1:8787', host: '127.0.0.1', summary }).join('\n');
    expect(plain).not.to.include('Ledgers');
    expect(plain).not.to.include('Clock:');
  });

  it('warns when --host is not a loopback address', () => {
    const summary = { stores: [], rules: [], libraries: [], warnings: [] };
    const open = startupLines({ url: 'http://0.0.0.0:8787', host: '0.0.0.0', summary }).join('\n');
    const closed = startupLines({ url: 'http://127.0.0.1:8787', host: '127.0.0.1', summary }).join('\n');
    expect(open).to.include('reachable on the network');
    expect(closed).not.to.include('reachable on the network');
  });

  it('stops on SIGINT, SIGTERM and SIGHUP', () => {
    expect(STOP_SIGNALS).to.deep.equal(['SIGINT', 'SIGTERM', 'SIGHUP']);
  });

  describe('--run process group', function () {
    this.timeout(10000);

    function pidScript(pidFile, ignoreTerm) {
      const trap = ignoreTerm ? 'process.on(\'SIGTERM\', () => {});' : '';
      return `${trap} require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
    }

    async function waitForPid(pidFile) {
      const started = Date.now();
      while (!fs.existsSync(pidFile) || fs.readFileSync(pidFile, 'utf8') === '') {
        if (Date.now() - started > 5000) throw new Error('the process did not start');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return Number(fs.readFileSync(pidFile, 'utf8'));
    }

    async function gone(pid, timeoutMs = 4000) {
      const started = Date.now();
      while (Date.now() - started < timeoutMs) {
        try {
          process.kill(pid, 0);
        } catch (_err) {
          return true;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return false;
    }

    it('sends SIGKILL to a group that ignores SIGTERM after the grace period', async function () {
      if (process.platform === 'win32') this.skip();
      const pidFile = path.join(tmp, 'pid');
      const child = spawn(process.execPath, ['-e', pidScript(pidFile, true)], { detached: true, stdio: 'ignore' });
      const pid = await waitForPid(pidFile);
      const started = Date.now();
      await stopRun(child, { graceMs: 300 });
      expect(Date.now() - started).to.be.at.least(250);
      expect(await gone(pid)).to.equal(true);
    });

    it('ends the --run command when quant serve gets SIGHUP', async function () {
      if (process.platform === 'win32') this.skip();
      const pidFile = path.join(tmp, 'pid');
      const cli = path.join(HERE, '..', '..', '..', 'cli.js');
      const run = nodeCommand(tmp, pidScript(pidFile, false));
      const serveProcess = spawn(process.execPath, [cli, 'serve', '--port', '0', '--memory', '--run', run], { cwd: ORBIT, stdio: 'ignore' });
      const exited = new Promise((resolve) => serveProcess.on('exit', (code, signal) => resolve({ code, signal })));
      const pid = await waitForPid(pidFile);
      serveProcess.kill('SIGHUP');
      expect(await exited).to.deep.equal({ code: 0, signal: null });
      expect(await gone(pid)).to.equal(true);
    });

    // A temporary project with one function rule at /loop.
    function loopProject(body) {
      const root = path.join(tmp, 'loop');
      const uuid = '0f8e2c1a-5b6d-4e7f-8a9b-1c2d3e4f5a6b';
      fs.mkdirSync(path.join(root, 'quant', 'edge-functions'), { recursive: true });
      fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
      fs.writeFileSync(path.join(root, 'dist', 'index.html'), 'home');
      fs.writeFileSync(path.join(root, 'quant', 'edge-functions', 'loop.js'), body);
      fs.writeFileSync(path.join(root, 'quant', 'edge-functions.json'), JSON.stringify([
        { id: 'loop', uuid, type: 'function', path: 'quant/edge-functions/loop.js', description: 'loop' }
      ]));
      fs.writeFileSync(path.join(root, 'quant', 'edge-rules.json'), JSON.stringify({
        version: 1, namespace: 'test',
        rules: [{ id: 'loop', name: 'loop', type: 'function', urls: ['/loop'], weight: 0, function_uuid: uuid }]
      }));
      return { root, uuid };
    }

    function serveUrl(child) {
      return new Promise((resolve, reject) => {
        let out = '';
        child.stdout.on('data', (chunk) => {
          out += chunk;
          const match = /running at (http:\/\/\S+)/.exec(out);
          if (match) resolve(match[1]);
        });
        child.on('exit', () => reject(new Error(`quant serve stopped before it started: ${out}`)));
      });
    }

    it('stops quant serve and the --run group when a function blocks the event loop', async function () {
      if (process.platform === 'win32') this.skip();
      const { root, uuid } = loopProject('await null; while (true) {}');
      const pidFile = path.join(tmp, 'pid');
      const cli = path.join(HERE, '..', '..', '..', 'cli.js');
      const run = nodeCommand(tmp, pidScript(pidFile, true));
      const serveProcess = spawn(process.execPath, [cli, 'serve', '--port', '0', '--memory', '--run', run], {
        cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, QUANT_SERVE_STALL_MS: '300' }
      });
      let stderr = '';
      serveProcess.stderr.on('data', (chunk) => { stderr += chunk; });
      const exited = new Promise((resolve) => serveProcess.on('exit', (code, signal) => resolve({ code, signal })));
      const url = await serveUrl(serveProcess);
      const pid = await waitForPid(pidFile);
      // When the watchdog fails, the guard ends both processes so that the test fails and does not hang.
      const guard = setTimeout(() => {
        serveProcess.kill('SIGKILL');
        try { process.kill(pid, 'SIGKILL'); } catch (_err) { /* already gone */ }
      }, 8000);
      fetch(`${url}/loop`).catch(() => {});
      const result = await exited;
      clearTimeout(guard);
      expect(result.signal).to.equal('SIGKILL');
      expect(stderr).to.include(`A function (${uuid}) blocked quant serve for more than 0.3 s. quant serve stops.`);
      expect(stderr).to.include('Make the function return within 15 s.');
      expect(await gone(pid)).to.equal(true);
    });
  });

  describe('runServe', () => {
    function options(over = {}) {
      return resolveOptions({ dir: 'dist', port: 0, memory: true, ...over }, { root: ORBIT, gitUserName: noGit });
    }

    it('serves until it is stopped', async () => {
      let stop;
      const stopped = new Promise((resolve) => { stop = resolve; });
      let url;
      const running = runServe(options(), {
        stop: stopped,
        print: (line) => output.push(line),
        onListening: (server) => { url = server.url; }
      });
      await new Promise((resolve) => {
        const check = () => (url ? resolve() : setTimeout(check, 20));
        check();
      });
      const res = await fetch(`${url}/app`);
      expect(res.status).to.equal(200);
      expect(output.join('\n')).to.include(url);
      stop();
      await running;
    });

    it('wires the local KV, seeds it and prints the revealed key', async () => {
      let stop;
      const stopped = new Promise((resolve) => { stop = resolve; });
      let url;
      const seedKey = 'cd'.repeat(32);
      const running = runServe(options({ 'seed-key': seedKey }), {
        stop: stopped,
        print: (line) => output.push(line),
        onListening: (server) => { url = server.url; }
      });
      await new Promise((resolve) => {
        const check = () => (url ? resolve() : setTimeout(check, 20));
        check();
      });
      try {
        const res = await fetch(`${url}/api/workspace`);
        expect(res.status).to.equal(200);
        expect((await res.json()).settings.name).to.equal('My workspace');
        const text = output.join('\n');
        expect(text).to.include('orbit → local-dev-orbit in memory');
        expect(text).to.include('Owner access key (workspace: studio)');
        expect(text).to.include(seedKey);
      } finally {
        stop();
        await running;
      }
    });

    it('prints the revealed key and its keys file when the port is in use', async () => {
      const root = path.join(tmp, 'project');
      fs.cpSync(ORBIT, root, { recursive: true, filter: (src) => !src.includes(`${path.sep}.quant`) });
      const blocker = net.createServer();
      await new Promise((resolve) => blocker.listen(0, '127.0.0.1', resolve));
      const port = blocker.address().port;
      const seedKey = 'ef'.repeat(32);
      try {
        const opts = resolveOptions({ dir: 'dist', port, 'seed-key': seedKey }, { root, gitUserName: noGit });
        let error = null;
        try {
          await runServe(opts, { stop: Promise.resolve(), print: (line) => output.push(line), log: () => {} });
        } catch (err) {
          error = err;
        }
        expect(error && error.message).to.equal(`Port ${port} is in use. Use --port.`);
        const text = output.join('\n');
        const keysFile = path.join(root, '.quant', 'kv', 'local-dev-orbit.keys');
        expect(text).to.include(seedKey);
        expect(text).to.include(`The keys are also in ${keysFile}.`);
        expect(fs.readFileSync(keysFile, 'utf8')).to.include(seedKey);
      } finally {
        await new Promise((resolve) => blocker.close(resolve));
      }
    });

    it('stops with the file, store and entry number when a ledger definition is bad', async () => {
      const root = path.join(tmp, 'project');
      fs.cpSync(ORBIT, root, { recursive: true, filter: (src) => !src.includes(`${path.sep}.quant`) });
      const bad = { name: 'audit', collection: 'audit', chains: 1, retentionDays: 30, subjectMode: 'pseudonym' };
      fs.writeFileSync(path.join(root, 'quant', 'kv-ledgers.json'), JSON.stringify({ orbit: [bad] }));
      const opts = resolveOptions({ dir: 'dist', port: 0, memory: true }, { root, gitUserName: noGit });
      let error = null;
      try {
        await runServe(opts, { stop: Promise.resolve(), print: (line) => output.push(line), log: () => {} });
      } catch (err) {
        error = err;
      }
      expect(error && error.message).to.equal('quant/kv-ledgers.json orbit entry 1: unknown ledger property');
    });

    it('reveals no key when a fixture is bad', async () => {
      const root = path.join(tmp, 'project');
      fs.cpSync(ORBIT, root, { recursive: true, filter: (src) => !src.includes(`${path.sep}.quant`) });
      fs.mkdirSync(path.join(root, 'quant', 'kv-fixtures'));
      fs.writeFileSync(path.join(root, 'quant', 'kv-fixtures', 'orbit.json'), JSON.stringify([{ value: 1 }]));
      const seedKey = '12'.repeat(32);
      const opts = resolveOptions({ dir: 'dist', port: 0, 'seed-key': seedKey }, { root, gitUserName: noGit });
      let error = null;
      try {
        await runServe(opts, { stop: Promise.resolve(), print: (line) => output.push(line), log: () => {} });
      } catch (err) {
        error = err;
      }
      expect(error && error.message).to.include('each entry needs a key');
      const text = output.join('\n');
      const keysFile = path.join(root, '.quant', 'kv', 'local-dev-orbit.keys');
      expect(text).to.not.include(seedKey);
      expect(fs.existsSync(keysFile)).to.equal(false);
    });

    it('stops when --build fails', async () => {
      try {
        await runServe(options({ build: 'exit 3' }), { stop: Promise.resolve(), print: () => {} });
        expect.fail('must fail');
      } catch (err) {
        expect(err.message).to.include('exit code 3');
      }
    });

    it('starts --run and stops it when quant serve stops', async () => {
      const pidFile = path.join(tmp, 'pid');
      const script = `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
      let stop;
      const stopped = new Promise((resolve) => { stop = resolve; });
      const running = runServe(options({ run: nodeCommand(tmp, script) }), {
        stop: stopped,
        print: () => {}
      });
      const started = Date.now();
      while (!fs.existsSync(pidFile) || fs.readFileSync(pidFile, 'utf8') === '') {
        if (Date.now() - started > 5000) throw new Error('the --run command did not start');
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const pid = Number(fs.readFileSync(pidFile, 'utf8'));
      stop();
      await running;
      const gone = Date.now();
      let alive = true;
      while (alive && Date.now() - gone < 3000) {
        try {
          process.kill(pid, 0);
          await new Promise((resolve) => setTimeout(resolve, 50));
        } catch (_err) {
          alive = false;
        }
      }
      expect(alive).to.equal(false);
    });
  });
});
