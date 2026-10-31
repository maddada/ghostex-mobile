/**
 * CDXC:Terminal 2026-10-31 WHY: the warm terminals share one scrollback budget so they cannot run
 * the Android app out of memory (GitHub #356, an OutOfMemoryError on the Terminal screen). Termux
 * keeps every scrollback row on the 256 MB Java heap, and as soon as a terminal changes width once
 * (opening at 80 columns, then the view's width, then 200 while parked) it allocates the whole
 * scrollback up front, about 2.2 KB a row at the 200-column parked width. Seven warm terminals at the
 * 20,000-row maximum held 303 MB measured on a JVM; at the 2,000-row default they hold 30 MB.
 * 28,000 rows (about 62 MB) keeps all seven warm up to 4,000 rows each, so the default changes
 * nothing; a bigger setting keeps fewer terminals warm instead of shortening anyone's scrollback.
 * Android only: iOS's Ghostty reads the setting as a byte limit (`scrollback-limit`) in native memory.
 * SEE-ALSO: MAX_WARM_SESSIONS and evictExcessWarmEntries in ./sessions.ts, TerminalBuffer.resize in
 * modules/ghostex-native/android/src/main/java/com/termux/terminal/TerminalBuffer.java.
 */
export const WARM_SCROLLBACK_ROW_BUDGET = 28_000;

/**
 * Whether the warm terminals (scrollback rows each was opened with) hold more than the phone can
 * keep. A single terminal always fits: the one on screen is never closed to make room.
 */
export function warmPoolOverBudget(
  rows: readonly number[],
  maxEntries: number,
  rowBudget: number = WARM_SCROLLBACK_ROW_BUDGET,
): boolean {
  if (rows.length <= 1) return false;
  if (rows.length > maxEntries) return true;
  let total = 0;
  for (const count of rows) total += count;
  return total > rowBudget;
}

/** How many terminals stay warm when each is opened with `scrollbackRows`. */
export function warmTerminalsFor(scrollbackRows: number, maxEntries: number): number {
  const fit = Math.floor(WARM_SCROLLBACK_ROW_BUDGET / Math.max(1, scrollbackRows));
  return Math.max(1, Math.min(maxEntries, fit));
}
