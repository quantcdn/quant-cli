/**
 * The watchdog thread of `quant serve` (see watchdog.js).
 * It reads the heartbeat that the main thread writes. When the heartbeat
 * stops for longer than the stall limit, it prints which function blocked
 * the server, ends the --run process group and kills the process.
 * The main thread cannot run, so this thread writes to stderr directly.
 */

import fs from 'node:fs';
import { workerData } from 'node:worker_threads';
import { BEAT, RUN_PID, NAME_LENGTH, NAME_OFFSET, NAME_BYTES, POLL_MS } from './watchdog-layout.js';

const { shared, stallMs, budgetMs, graceMs } = workerData;
const slots = new Int32Array(shared, 0, 3);
const name = new Uint8Array(shared, NAME_OFFSET, NAME_BYTES);
const POSIX = process.platform !== 'win32';

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runningFunction() {
  const length = Atomics.load(slots, NAME_LENGTH);
  return length > 0 ? Buffer.from(name.slice(0, length)).toString('utf8') : null;
}

function seconds(ms) {
  return Number((ms / 1000).toFixed(3));
}

function message() {
  const uuid = runningFunction();
  const who = uuid ? `A function (${uuid})` : 'An edge function';
  return `${who} blocked quant serve for more than ${seconds(stallMs)} s. quant serve stops. `
    + `Make the function return within ${seconds(budgetMs)} s.\n`;
}

function signalGroup(pid, signal) {
  try {
    process.kill(POSIX ? -pid : pid, signal);
    return true;
  } catch (_err) {
    return false;
  }
}

// SIGTERM to the --run process group, then SIGKILL when it is still alive
// after the grace period.
function endRun() {
  const pid = Atomics.load(slots, RUN_PID);
  if (pid <= 0 || !signalGroup(pid, 'SIGTERM')) return;
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline && signalGroup(pid, 0)) sleep(POLL_MS);
  signalGroup(pid, 'SIGKILL');
}

function stop() {
  fs.writeSync(2, message());
  endRun();
  process.kill(process.pid, 'SIGKILL');
}

let last = Atomics.load(slots, BEAT);
let changedAt = Date.now();

setInterval(() => {
  const beat = Atomics.load(slots, BEAT);
  if (beat !== last) {
    last = beat;
    changedAt = Date.now();
  } else if (Date.now() - changedAt > stallMs) {
    stop();
  }
}, Math.min(POLL_MS, Math.max(10, Math.floor(stallMs / 4))));
