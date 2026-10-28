/**
 * The watchdog of `quant serve`.
 * node:vm stops synchronous code at the time budget, but not code that runs
 * after an await. Such code can block the event loop, and then no timer and
 * no signal handler runs. A worker thread reads a heartbeat that the main
 * thread writes. When the heartbeat stops for longer than the stall limit,
 * the worker prints which function blocked, ends the --run process group and
 * kills the process.
 */

import { Worker } from 'node:worker_threads';
import { BEAT, RUN_PID, NAME_LENGTH, NAME_OFFSET, NAME_BYTES, SHARED_BYTES, POLL_MS } from './watchdog-layout.js';

/** The time over the function budget before the watchdog stops quant serve. */
export const STALL_MARGIN_MS = 5000;
const RUN_GRACE_MS = 2000;

// QUANT_SERVE_STALL_MS replaces the stall limit (the tests use a short one).
function stallLimit(budgetMs) {
  const fromEnv = Number(process.env.QUANT_SERVE_STALL_MS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : budgetMs + STALL_MARGIN_MS;
}

// The runs in flight, oldest first (a Map keeps insertion order). The shared
// name is the oldest run that is still in flight, so the message names it
// also when a newer run ends first.
function runTracker(slots, name) {
  const runs = new Map();
  let next = 0;
  const publish = () => {
    const oldest = runs.values().next().value;
    const bytes = oldest ? Buffer.from(oldest.uuid).subarray(0, NAME_BYTES) : Buffer.alloc(0);
    name.set(bytes);
    Atomics.store(slots, NAME_LENGTH, bytes.length);
  };
  return {
    enter(uuid) {
      next += 1;
      runs.set(next, { uuid: String(uuid), startedAt: Date.now() });
      publish();
      return next;
    },
    leave(token) {
      runs.delete(token);
      publish();
    },
    running() {
      const length = Atomics.load(slots, NAME_LENGTH);
      return length > 0 ? Buffer.from(name.slice(0, length)).toString('utf8') : null;
    }
  };
}

/**
 * Start the watchdog.
 * @param {Object} options
 * @param {number} options.budgetMs The time budget of one function run.
 * @param {number} [options.stallMs] The stall limit (default: budget + 5 s).
 * @returns {{ enter: (uuid: string) => number, leave: (token: number) => void, running: () => string|null,
 *   setRunPid: (pid: number) => void, stop: () => void }}
 *   enter returns the token that leave takes; running gives the uuid that the message names.
 */
export function startWatchdog({ budgetMs, stallMs = stallLimit(budgetMs) }) {
  const shared = new SharedArrayBuffer(SHARED_BYTES);
  const slots = new Int32Array(shared, 0, 3);
  const name = new Uint8Array(shared, NAME_OFFSET, NAME_BYTES);
  const worker = new Worker(new URL('./watchdog-worker.js', import.meta.url), {
    workerData: { shared, stallMs, budgetMs, graceMs: RUN_GRACE_MS }
  });
  worker.unref();
  const beat = setInterval(() => Atomics.add(slots, BEAT, 1), Math.min(POLL_MS, Math.max(10, Math.floor(stallMs / 4))));
  beat.unref();
  return {
    ...runTracker(slots, name),
    setRunPid(pid) {
      Atomics.store(slots, RUN_PID, pid || 0);
    },
    stop() {
      clearInterval(beat);
      worker.terminate();
    }
  };
}
