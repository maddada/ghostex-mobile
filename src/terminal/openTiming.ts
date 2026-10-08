/**
 * Session-open timing marks: how long a tap on a session row takes to reach the screen, the
 * cached transcript, the first live chat read and the attached terminal.
 *
 * The phone has no diagnostic log areas like the desktop's Debugging page, so the marks print
 * only in development builds (`__DEV__`, Metro and `adb logcat -s ReactNativeJS`), one line per
 * stage: `[session-open] <machineId>:<sessionId> cachedPaint +84ms`. Each stage prints once per
 * tap; a stage reached without a tap in front of it (a reopened tab, a chat that was already
 * mounted) prints nothing.
 */

export type SessionOpenStage = 'navigate' | 'bootRead' | 'cachedPaint' | 'livePaint' | 'terminalOpen';

type OpenTrace = { startedAt: number; seen: Set<SessionOpenStage> };

const traces = new Map<string, OpenTrace>();

/** Starts a trace for `sessionKey` (`${machineId}:${sessionId}`), replacing an older one. */
export function markSessionOpenTap(sessionKey: string): void {
  if (!__DEV__) return;
  traces.set(sessionKey, { startedAt: Date.now(), seen: new Set() });
  console.info(`[session-open] ${sessionKey} tap`);
}

export function markSessionOpen(sessionKey: string, stage: SessionOpenStage): void {
  if (!__DEV__) return;
  const trace = traces.get(sessionKey);
  if (trace === undefined || trace.seen.has(stage)) return;
  trace.seen.add(stage);
  console.info(`[session-open] ${sessionKey} ${stage} +${Date.now() - trace.startedAt}ms`);
}
