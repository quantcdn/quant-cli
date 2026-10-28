/**
 * The layout of the memory that the main thread and the watchdog thread of
 * `quant serve` share: three Int32 slots, then the bytes of a function UUID.
 */

export const BEAT = 0;
export const RUN_PID = 1;
export const NAME_LENGTH = 2;
export const NAME_OFFSET = 12;
export const NAME_BYTES = 64;
export const SHARED_BYTES = NAME_OFFSET + NAME_BYTES;
/** The heartbeat interval, and the longest interval between two checks. */
export const POLL_MS = 250;
