/**
 * What a session row shows about its session's state: the status dot, the
 * question indicator, the time or countdown beside it, the leading timer clock
 * and the completion flash. Each rule is a port of the desktop sidebar row, cited
 * per function, so the phone draws the same thing for the same session. When the
 * phone moves onto gx-core (docs/2026-09-25/mobile-gx-core/PLAN.md), this file is
 * replaced by the core's row view.
 *
 * SessionRow.tsx draws it; the colors are the row tokens in theme/palette.ts.
 */

import type { GhostexSession } from '../../contract/mobileSummary';
import { formatTimerCountdown, isDelayedSendWaitingLabel } from './timerCountdown';

type RowSession = Pick<
  GhostexSession,
  | 'sessionId'
  | 'activity'
  | 'pendingQuestionCount'
  | 'backgroundWorkDetectedAt'
  | 'lastInteractionAt'
  | 'delayedSendDeadlineAt'
  | 'delayedSendRemainingLabel'
  | 'sendWhenAgentStopsActive'
  | 'sendWhenAllProjectSessionsStopActive'
  | 'closeAfterDone'
  | 'closeAfterDoneDeadlineAt'
  | 'attentionAcknowledged'
  | 'attentionEventId'
  | 'attentionEnteredAt'
>;

/** packages/gx-core/src/sidebar_view/session_text.rs `CLOSE_AFTER_DONE_ARMED_REMAINING_LABEL`. */
const CLOSE_AFTER_DONE_ARMED_REMAINING_LABEL = '03:00';

/** The dot in the row's status slot (apps/desktop/src/app/native_sidebar/status.rs `activity_indicator`). */
export type RowActivityIndicator = 'working' | 'attention' | 'backgroundWork' | null;

/** apps/desktop/src/app/native_sidebar/sessions.rs `question`: the row draws the question indicator. */
export function hasPendingQuestion(session: RowSession): boolean {
  return session.pendingQuestionCount > 0;
}

/** packages/gx-core/src/sidebar_view/rows.rs `has_background_work`. */
export function hasBackgroundWork(session: RowSession): boolean {
  return session.backgroundWorkDetectedAt.length > 0;
}

/**
 * apps/desktop/src/app/native_sidebar/status.rs `activity_indicator`: working,
 * then attention, then the grey background-work dot on an otherwise idle row.
 * Lifecycle (sleeping, stopped, error) draws no dot.
 */
export function rowActivityIndicator(session: RowSession): RowActivityIndicator {
  if (session.activity === 'working') return 'working';
  if (session.activity === 'attention') return 'attention';
  if (hasBackgroundWork(session)) return 'backgroundWork';
  return null;
}

/**
 * packages/gx-core/src/sidebar_view/rows.rs `delayed_send`: the computer
 * published a Delayed Send for this session (the phone has no host timers of
 * its own, so this is the only source).
 */
function hasPublishedDelayedSend(session: RowSession): boolean {
  return (
    session.delayedSendDeadlineAt.length > 0 ||
    session.delayedSendRemainingLabel.length > 0 ||
    session.sendWhenAllProjectSessionsStopActive ||
    session.sendWhenAgentStopsActive
  );
}

/**
 * apps/desktop/src/app/native_sidebar/icons.rs `render_session_icon`: an armed
 * Delayed Send (yellow) or Close After Done (pastel red) replaces the leading
 * icon with a clock; the Delayed Send wins. `null` when neither is armed.
 */
export function rowClockKind(session: RowSession): 'delayedSend' | 'closeAfterDone' | null {
  if (session.delayedSendDeadlineAt.length > 0 || session.delayedSendRemainingLabel.length > 0) {
    return 'delayedSend';
  }
  if (session.closeAfterDone || session.closeAfterDoneDeadlineAt.length > 0) return 'closeAfterDone';
  return null;
}

/** packages/gx-core/src/sidebar_view/session_text.rs `deadline_countdown`. */
function deadlineCountdown(deadlineAt: string, nowMs: number): string | null {
  const deadlineMs = Date.parse(deadlineAt);
  return Number.isNaN(deadlineMs) ? null : formatTimerCountdown(deadlineMs - nowMs);
}

/**
 * packages/gx-core/src/sidebar_view/session_text.rs `timer_trailing_label`: a
 * Delayed Send owns the slot (its countdown, or its label unless it is still
 * waiting for agents), then an armed Close After Done (its countdown, or the
 * armed 03:00 while it waits for the agent to finish).
 */
export function timerTrailingLabel(session: RowSession, nowMs: number): string | null {
  if (hasPublishedDelayedSend(session)) {
    if (session.delayedSendDeadlineAt.length > 0) {
      return deadlineCountdown(session.delayedSendDeadlineAt, nowMs);
    }
    if (session.delayedSendRemainingLabel.length > 0) {
      return isDelayedSendWaitingLabel(session.delayedSendRemainingLabel)
        ? null
        : session.delayedSendRemainingLabel;
    }
  }
  if (!session.closeAfterDone) return null;
  if (session.closeAfterDoneDeadlineAt.length > 0) {
    return deadlineCountdown(session.closeAfterDoneDeadlineAt, nowMs);
  }
  return CLOSE_AFTER_DONE_ARMED_REMAINING_LABEL;
}

/** packages/gx-core/src/sidebar_view/session_text.rs `last_interaction_label`: 32s / 5m / 3h / 2d. */
export function lastInteractionLabel(session: RowSession, nowMs: number): string | null {
  if (session.lastInteractionAt.length === 0) return null;
  const atMs = Date.parse(session.lastInteractionAt);
  if (Number.isNaN(atMs)) return null;
  const seconds = Math.floor(Math.max(0, nowMs - atMs) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/**
 * apps/desktop/src/app/native_sidebar/sessions.rs: the text after the status
 * dot. A pending question hides it; a timer label always shows; the relative
 * time shows only on a row that is neither working, in attention, nor running
 * background work, which draw their own dot instead.
 */
export function rowTimeLabel(session: RowSession, nowMs: number): string | null {
  if (hasPendingQuestion(session)) return null;
  const timer = timerTrailingLabel(session, nowMs);
  if (timer !== null) return timer;
  if (
    session.activity === 'working' ||
    session.activity === 'attention' ||
    hasBackgroundWork(session)
  ) {
    return null;
  }
  return lastInteractionLabel(session, nowMs);
}

/**
 * packages/gx-core/src/sidebar_view/session_text.rs `next_label_deadline`: the
 * next moment the row's time reads differently, so a countdown ticks every
 * second and a relative time wakes only when its digit changes. `null` when the
 * row draws no time or one that never moves.
 */
export function nextLabelDeadline(session: RowSession, nowMs: number): number | null {
  const deadlines: string[] = [];
  if (hasPublishedDelayedSend(session) && session.delayedSendDeadlineAt.length > 0) {
    deadlines.push(session.delayedSendDeadlineAt);
  }
  if (session.closeAfterDone && session.closeAfterDoneDeadlineAt.length > 0) {
    deadlines.push(session.closeAfterDoneDeadlineAt);
  }
  let countdown: number | null = null;
  for (const value of deadlines) {
    const deadline = Date.parse(value);
    // A countdown that has run out reads 00:00 and stands still.
    if (Number.isNaN(deadline) || deadline <= nowMs) continue;
    // The shown seconds are rounded up, so they change on second boundaries counted back from the deadline.
    const next = deadline - Math.floor((deadline - nowMs - 1) / 1000) * 1000;
    countdown = countdown === null ? next : Math.min(countdown, next);
  }
  if (countdown !== null) return Math.max(countdown, nowMs + 1);
  if (timerTrailingLabel(session, nowMs) !== null) return null;
  if (
    session.activity === 'working' ||
    session.activity === 'attention' ||
    hasBackgroundWork(session)
  ) {
    return null;
  }
  if (session.lastInteractionAt.length === 0) return null;
  const at = Date.parse(session.lastInteractionAt);
  if (Number.isNaN(at)) return null;
  const elapsed = Math.max(0, nowMs - at);
  const step =
    elapsed < 60_000 ? 1_000 : elapsed < 3_600_000 ? 60_000 : elapsed < 86_400_000 ? 3_600_000 : 86_400_000;
  const deadline = at + (Math.floor(elapsed / step) + 1) * step;
  return deadline > nowMs ? deadline : null;
}

/** apps/desktop/src/app/native_sidebar/status.rs `completion_opacity`: three dips over three seconds. */
export const COMPLETION_FLASH_MS = 3_000;
export const COMPLETION_FLASH_PROGRESS = [0, 0.08, 0.16, 0.24, 0.36, 0.44, 0.52, 0.64, 0.72, 0.8, 1];
export const COMPLETION_FLASH_OPACITY = [1, 0.9, 0.58, 1, 0.9, 0.58, 1, 0.9, 0.58, 1, 1];

/** packages/gx-core/src/attention.rs `COMPLETION_SOUND_EVENT_CACHE_LIMIT`. */
const FLASHED_EVENT_LIMIT = 2_048;
const flashedEvents = new Set<string>();
const flashedEventOrder: string[] = [];

/**
 * packages/gx-core/src/attention.rs `track`: the card flashes when a session the
 * row already showed with another activity moves into unacknowledged attention,
 * once per attention event, and only while the completion sound is on, because
 * the desktop flashes the card together with that sound
 * (apps/desktop/src/app/workspace_terminals.rs `play_session_completion`).
 * `previousActivity` is null when the row has not shown the session before.
 */
export function shouldStartCompletionFlash(
  previousActivity: string | null,
  session: RowSession,
  completionSoundEnabled: boolean,
): boolean {
  if (session.activity !== 'attention' || session.attentionAcknowledged) return false;
  if (previousActivity === null || previousActivity === 'attention') return false;
  const eventId =
    session.attentionEventId.length > 0 ? session.attentionEventId : session.attentionEnteredAt;
  if (eventId.length > 0) {
    const key = `${session.sessionId}\u001f${eventId}`;
    if (flashedEvents.has(key)) return false;
    flashedEvents.add(key);
    flashedEventOrder.push(key);
    while (flashedEventOrder.length > FLASHED_EVENT_LIMIT) {
      const oldest = flashedEventOrder.shift();
      if (oldest !== undefined) flashedEvents.delete(oldest);
    }
  }
  return completionSoundEnabled;
}
