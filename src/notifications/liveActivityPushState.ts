/**
 * Whether a computer keeps this phone's Live Activity updated while it is locked: it holds the activity's token
 * and confirmed it (`liveActivityPush.ts` sets this after each pass). The app's own updates then give the content
 * the same stale date the computer's pushes give it (`LOCKED_STALE_AFTER_MS`), so the activity does not read
 * "Updated …" two minutes after the phone locks while the computer still keeps it current.
 *
 * Kept free of React Native and of the other notification modules, so both sides can read it without a cycle.
 */

/** gxserver's stale date for the content it pushes (server/src/live_activity/runtime.rs, stale_after_ms). */
export const LOCKED_STALE_AFTER_MS = 15 * 60_000;

let lockedPushes = false;

export function setLockedPushes(on: boolean): void {
  lockedPushes = on;
}

export function lockedPushesOn(): boolean {
  return lockedPushes;
}
