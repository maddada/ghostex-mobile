/**
 * How long ago a Chat Resources row was asked: "now" under a minute, "4m" and "2h" within the day,
 * "yesterday" for the day before, then "3d". Elapsed time like the core's `age_label`
 * (packages/gx-chat-core/src/transcript/message_time.rs; the user's words are there), so the list can
 * recompute it as the clock moves. A row with no stamp keeps the core's own `age`.
 */
import type { QuestionListRow } from '../../rust/document';

export function ageLabel(nowMs: number, atMs: number): string {
  const minutes = Math.floor(Math.max(0, nowMs - atMs) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  if (minutes < 2880) return 'yesterday';
  return `${Math.floor(minutes / 1440)}d`;
}

export function rowAge(row: Pick<QuestionListRow, 'atMs' | 'age'>, nowMs: number): string {
  return typeof row.atMs === 'number' ? ageLabel(nowMs, row.atMs) : (row.age ?? '');
}

/**
 * The action a row's For later button sends (the question cards' own `questionForLater`, so cards
 * and list agree): "For later" on a waiting form or page, "Back to open" on one put off (the row's
 * `status`, gx-chat-core `QuestionListRow`); none for any other row. Desktop: `questions_list.rs` `later_action`.
 */
export function laterAction(
  status: string | undefined,
  kind: string,
  id: string,
): { label: string; glyph: 'clock' | 'arrow-back-up'; action: { type: 'questionForLater'; id: string; later: boolean } } | null {
  if (kind === 'chart') return null;
  if (status === 'waiting') {
    return { label: 'For later', glyph: 'clock', action: { type: 'questionForLater', id, later: true } };
  }
  if (status === 'later') {
    return { label: 'Back to open', glyph: 'arrow-back-up', action: { type: 'questionForLater', id, later: false } };
  }
  return null;
}

/**
 * The X a For later row offers beside Back to open: removes the question without answering it
 * (`questionRemove`, gx-chat-core `questions/later.rs`). Only a put-off form or page gets it.
 * Desktop: `questions_list.rs` `remove_action`.
 */
export function removeAction(
  status: string | undefined,
  kind: string,
  id: string,
): { label: string; glyph: 'x'; action: { type: 'questionRemove'; id: string } } | null {
  if (status !== 'later' || kind === 'chart') return null;
  return { label: 'Remove without answering', glyph: 'x', action: { type: 'questionRemove', id } };
}

/** The word a row carries before its age: "For later" or "Canceled" (desktop `status_label`). */
export function statusLabel(status: string | undefined): string | null {
  if (status === 'later') return 'For later';
  if (status === 'canceled') return 'Canceled';
  return null;
}
