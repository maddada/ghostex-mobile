/**
 * Client-clock countdown for the host timers gxserver publishes (Delayed Send,
 * Close After Done), cloned from the desktop sidebar (session-card-content.tsx
 * getSessionCardTimerTrailingLabel / formatSessionTimerCountdown +
 * use-relative-time-tick.ts). The daemon persists an absolute deadline and a
 * remaining label that is only a snapshot from the moment of the poll; the
 * phone polls every five seconds, so a label alone would jump in five-second
 * steps. Tick deadline-backed labels from the phone's own clock instead. The
 * deadline stays authoritative: this changes display text only and never owns
 * or fires the timer.
 */

import { useEffect, useState } from 'react';

/** Re-renders once per `intervalMs` while `enabled`; returns `Date.now()`. */
export function useNowTick(enabled: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!enabled) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [enabled, intervalMs]);

  return now;
}

/** `MM:SS`, or `HH:MM:SS` past an hour, rounding partial seconds up like gxserver does. */
export function formatTimerCountdown(delayMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(delayMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedMinutes = String(minutes).padStart(2, '0');
  const paddedSeconds = String(seconds).padStart(2, '0');
  if (hours > 0) return `${String(hours).padStart(2, '0')}:${paddedMinutes}:${paddedSeconds}`;
  return `${paddedMinutes}:${paddedSeconds}`;
}

/** Countdown to an RFC 3339 deadline, or '' when the deadline is absent or unparsable. */
export function formatDeadlineCountdown(deadlineAt: string, nowMs: number): string {
  if (deadlineAt.length === 0) return '';
  const deadlineMs = Date.parse(deadlineAt);
  return Number.isNaN(deadlineMs) ? '' : formatTimerCountdown(deadlineMs - nowMs);
}

/** Milliseconds left until the deadline (0 when absent, unparsable, or past). */
export function remainingMsUntil(deadlineAt: string, nowMs: number): number {
  if (deadlineAt.length === 0) return 0;
  const deadlineMs = Date.parse(deadlineAt);
  return Number.isNaN(deadlineMs) ? 0 : Math.max(0, deadlineMs - nowMs);
}

/**
 * gxserver's remaining label for a send-when-finished trigger whose agent scope
 * is still working. Desktop keeps that state on the clock icon and its tooltip
 * and never renders the prose in the row's compact trailing slot.
 */
export function isDelayedSendWaitingLabel(remainingLabel: string): boolean {
  return remainingLabel === 'Waiting for agent' || remainingLabel === 'Waiting for agents';
}

/**
 * Live Delayed Send countdown for a session: the deadline ticked from the
 * client clock when gxserver published one, otherwise the daemon's own label.
 * '' while a send-when-finished trigger is still waiting for its agents, and
 * '' when no Delayed Send is armed.
 */
export function delayedSendCountdownLabel(
  session: { delayedSendDeadlineAt: string; delayedSendRemainingLabel: string },
  nowMs: number,
): string {
  const fromDeadline = formatDeadlineCountdown(session.delayedSendDeadlineAt, nowMs);
  if (fromDeadline.length > 0) return fromDeadline;
  if (isDelayedSendWaitingLabel(session.delayedSendRemainingLabel)) return '';
  return session.delayedSendRemainingLabel;
}
