/**
 * Whether the app is in front, and since when it has been in the background, for the log lines that explain a drop:
 * a connection that ended 40 s after the app went to the background is iOS's doing far more often than the computer's.
 * `lifecycle.ts` feeds it every AppState change; `inactive` (Control Center, a call banner) is still in front here.
 */

import { AppState, type AppStateStatus } from 'react-native';

let backgroundSince: number | null = AppState.currentState === 'background' ? Date.now() : null;

/** Records an AppState change; returns how long the app was away when it just came back to the front. */
export function noteAppState(next: AppStateStatus, now = Date.now()): number | null {
  if (next === 'background') {
    backgroundSince ??= now;
    return null;
  }
  if (next !== 'active' || backgroundSince === null) return null;
  const away = now - backgroundSince;
  backgroundSince = null;
  return away;
}

/** "in front", or "42 s in the background". */
export function whereTheAppIs(now = Date.now()): string {
  return backgroundSince === null ? 'in front' : `${formatDuration(now - backgroundSince)} in the background`;
}

/** "850 ms", "42 s", "3 min 5 s", "2 h 4 min". */
export function formatDuration(ms: number): string {
  if (ms < 1_000) return `${Math.max(0, Math.round(ms))} ms`;
  const seconds = Math.round(ms / 1_000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes} min` : `${minutes} min ${seconds % 60} s`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
}
