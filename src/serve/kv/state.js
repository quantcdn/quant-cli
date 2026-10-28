/**
 * The local KV state of `quant serve` on disk: one snapshot document for
 * every store, a lock file for writes, the local backend keys and the
 * revealed seed keys. All files are mode 0600 under .quant/kv.
 *
 * `quant serve` and `quant kv --local` share these files. Each write takes
 * the lock, loads the fresh snapshot, writes a temporary file and renames
 * it, so two processes do not lose a write. A reader reloads when the file
 * changes (mtime, inode and size).
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const LOCK_RETRY_MS = 25;
export const LOCK_TIMEOUT_MS = 5000;
export const LOCK_STALE_MS = 30000;
const FILE_MODE = 0o600;

/**
 * The state files of a project.
 * @param {string} root The project directory.
 * @returns {{ dir: string, file: string, lock: string, backendKeys: string, revealKeys: (storeId: string) => string }}
 */
export function statePaths(root) {
  const dir = path.join(root, '.quant', 'kv');
  return {
    dir,
    file: path.join(dir, 'state.json'),
    lock: path.join(dir, 'state.lock'),
    backendKeys: path.join(dir, 'backend-keys.json'),
    revealKeys: (storeId) => path.join(dir, `${storeId}.keys`)
  };
}

/** Create .quant/kv. .quant/.gitignore contains `*`, so the folder is never committed. */
export function ensureQuantDir(root) {
  const quant = path.join(root, '.quant');
  fs.mkdirSync(path.join(quant, 'kv'), { recursive: true, mode: 0o700 });
  const ignore = path.join(quant, '.gitignore');
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, '*\n');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The owner token in the lock file and the age of the lock, or null when
// there is no lock file.
function readLock(lockPath) {
  try {
    const age = Date.now() - fs.statSync(lockPath).mtimeMs;
    return { token: fs.readFileSync(lockPath, 'utf8'), age };
  } catch (_err) {
    return null;
  }
}

/**
 * Remove the lock file only when it still holds the token. A stale takeover
 * and a release both use it, so a process never removes a lock that a
 * later holder made.
 * @returns {boolean} true when this call removed the lock.
 */
export function removeLockIf(lockPath, token) {
  const current = readLock(lockPath);
  if (!current || current.token !== token) return false;
  fs.rmSync(lockPath, { force: true });
  return true;
}

// The lock file descriptor, or null when another holder has the lock.
// A lock older than staleMs belongs to a process that stopped: remove it,
// if it still holds the token that was judged stale.
function tryLock(lockPath, staleMs, token) {
  try {
    const fd = fs.openSync(lockPath, 'wx', FILE_MODE);
    fs.writeSync(fd, token);
    return fd;
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    const held = readLock(lockPath);
    if (held && held.age > staleMs) removeLockIf(lockPath, held.token);
    return null;
  }
}

async function acquire(lockPath, { retryMs, timeoutMs, staleMs }, token) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const fd = tryLock(lockPath, staleMs, token);
    if (fd !== null) return fd;
    if (Date.now() >= deadline) {
      throw new Error(`The KV state is locked (${lockPath}). If no other quant serve or quant kv command runs, delete the lock file.`);
    }
    await sleep(retryMs);
  }
}

/**
 * Run fn while this process holds the lock file. The lock is created with
 * `wx` and holds an owner token (pid and random bytes). A held lock is
 * retried every 25 ms for 5 s, and a lock older than 30 s is taken over.
 * The release removes the lock only when it still holds this token.
 */
export async function withLock(lockPath, fn, { retryMs = LOCK_RETRY_MS, timeoutMs = LOCK_TIMEOUT_MS, staleMs = LOCK_STALE_MS } = {}) {
  const token = `${process.pid}:${crypto.randomBytes(8).toString('hex')}`;
  const fd = await acquire(lockPath, { retryMs, timeoutMs, staleMs }, token);
  try {
    return await fn();
  } finally {
    fs.closeSync(fd);
    removeLockIf(lockPath, token);
  }
}

/** Write a file with mode 0600 through a temporary file and a rename. */
export function writeAtomic(file, text) {
  const temp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temp, text, { mode: FILE_MODE });
  fs.renameSync(temp, file);
}

// mtime, inode and size. Every write is a rename, so the inode changes
// also when the mtime is coarse and the size is the same.
function stamp(file) {
  try {
    const stat = fs.statSync(file);
    return `${stat.mtimeMs}:${stat.ino}:${stat.size}`;
  } catch (_err) {
    return null;
  }
}

/** The state document, or null when there is none. Invalid JSON stops with the file name and --reset. */
export function readState(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (_err) {
    doc = undefined;
  }
  const valid = doc !== null && typeof doc === 'object' && Array.isArray(doc.stores);
  if (!valid) throw new Error(`${file} is not valid JSON. Fix it or run quant serve --reset.`);
  return doc;
}

/**
 * The @quantcdn/edge-kv storage hook on the state file: load, changed and
 * transaction. The document also holds the seed markers (`seeded`), which a
 * transaction keeps.
 * @param {ReturnType<typeof statePaths>} paths
 */
export function fileStorage(paths) {
  let seen = stamp(paths.file);
  const load = () => {
    const doc = readState(paths.file);
    seen = stamp(paths.file);
    return doc;
  };
  return {
    load,
    changed: () => stamp(paths.file) !== seen,
    transaction: (run) => withLock(paths.lock, async () => {
      const fresh = load();
      const next = await run(fresh);
      writeAtomic(paths.file, JSON.stringify({ ...next, seeded: fresh?.seeded ?? {} }));
      seen = stamp(paths.file);
    })
  };
}

/**
 * Run fn(fresh) while this process holds the lock, and write the document
 * that fn returns as the state file: one lock and one write for many changes.
 * @param {ReturnType<typeof statePaths>} paths
 * @param {(fresh: Object|null) => Promise<Object>} fn
 */
export function replaceState(paths, fn) {
  return withLock(paths.lock, async () => {
    writeAtomic(paths.file, JSON.stringify(await fn(readState(paths.file))));
  });
}

/** The local backend keys, or undefined when there are none yet. */
export function readBackendKeys(paths) {
  try {
    return JSON.parse(fs.readFileSync(paths.backendKeys, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return undefined;
    throw new Error(`${paths.backendKeys} is not valid JSON. Fix it or run quant serve --reset.`);
  }
}

export function writeBackendKeys(paths, keys) {
  writeAtomic(paths.backendKeys, JSON.stringify(keys));
}

/** Append a revealed key to the keys file of its store (mode 0600). */
export function appendRevealedKey(file, label, value) {
  fs.appendFileSync(file, `${label}: ${value}\n`, { mode: FILE_MODE });
  fs.chmodSync(file, FILE_MODE);
}

/** Delete the state, the backend keys and the revealed keys (quant serve --reset). */
export function resetState(paths) {
  return withLock(paths.lock, async () => {
    const names = fs.existsSync(paths.dir) ? fs.readdirSync(paths.dir) : [];
    const doomed = names.filter((name) => name.endsWith('.keys')).map((name) => path.join(paths.dir, name));
    for (const file of [paths.file, paths.backendKeys, ...doomed]) fs.rmSync(file, { force: true });
  });
}
