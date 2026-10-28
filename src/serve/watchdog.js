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

/**
 * Start the watchdog.
 * @param {Object} options
 * @param {number} options.budgetMs The time budget of one function run.
 * @param {number} [options.stallMs] The stall limit (default: budget + 5 s).
 * @returns {{ enter: (uuid: string) => void, leave: () => void, setRunPid: (pid: number) => void, stop: () => void }}
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
  let running = 0;
  return {
    enter(uuid) {
      running += 1;
      const bytes = Buffer.from(String(uuid)).subarray(0, NAME_BYTES);
      name.set(bytes);
      Atomics.store(slots, NAME_LENGTH, bytes.length);
    },
    leave() {
      running = Math.max(running - 1, 0);
      if (running === 0) Atomics.store(slots, NAME_LENGTH, 0);
    },
    setRunPid(pid) {
      Atomics.store(slots, RUN_PID, pid || 0);
    },
    stop() {
      clearInterval(beat);
      worker.terminate();
    }
  };
}
