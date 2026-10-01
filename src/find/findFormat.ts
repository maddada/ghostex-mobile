/**
 * Find row and header labels, ported from the terminal picker so every surface
 * reads the same ("6m ago", "Today", "3 days ago", "last active Aug 18 23:47 UTC"),
 * and the match highlighting that turns the matcher's byte offsets into text runs.
 *
 * SEE-ALSO: packages/find/src/tui/ (the terminal picker), apps/desktop/src/app/window/find_prompts/model.rs (the desktop port).
 */

import type { FindPromptMeta } from './promptSearch';

const SECONDS_PER_DAY = 86_400;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

function dayKeyOf(ts: number): number {
  return Math.floor(ts / SECONDS_PER_DAY);
}

function utcParts(ts: number) {
  const date = new Date(ts * 1000);
  return {
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    month: MONTHS[date.getUTCMonth()] ?? '???',
    year: date.getUTCFullYear(),
  };
}

/** Compact last-active label shown under each result. */
export function formatLastActiveCompact(ts: number, now: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return 'unknown';
  const delta = Math.max(0, now - ts);
  if (delta < 60) return 'now';
  if (delta < 3_600) return `${Math.trunc(delta / 60)}m ago`;
  if (delta < SECONDS_PER_DAY) return `${Math.trunc(delta / 3_600)}h ago`;
  if (delta < 7 * SECONDS_PER_DAY) return `${Math.trunc(delta / SECONDS_PER_DAY)}d ago`;
  const { day, month } = utcParts(ts);
  return `${month} ${day}`;
}

/** Day heading when results are grouped by day; the server sends a negative key for an unknown day. */
export function formatDayHeader(dayKey: number, now: number): string {
  if (!Number.isFinite(dayKey) || dayKey < 0) return 'Unknown day';
  const today = dayKeyOf(now);
  if (dayKey === today) return 'Today';
  if (dayKey === today - 1) return 'Yesterday';
  if (dayKey > today - 7 && dayKey < today) return `${today - dayKey} days ago`;
  const date = utcParts(dayKey * SECONDS_PER_DAY);
  const nowDate = utcParts(today * SECONDS_PER_DAY);
  if (date.year === nowDate.year) return `${date.month} ${date.day}`;
  return `${date.month} ${date.day}, ${date.year}`;
}

/** The detail screen's "last active …" line. */
export function formatLastActiveFull(ts: number): string {
  if (!Number.isFinite(ts) || ts <= 0) return 'last active unknown';
  const { day, hour, minute, month } = utcParts(ts);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `last active ${month} ${day} ${pad(hour)}:${pad(minute)} UTC`;
}

/** The compact usage and model line under a prompt. */
export function formatPromptMetaLine(meta: FindPromptMeta): string {
  const parts: string[] = [];
  const { usage } = meta;
  if (usage.input > 0) parts.push(`↑${usage.input}`);
  if (usage.output > 0) parts.push(`↓${usage.output}`);
  if (usage.cacheRead > 0) parts.push(`R${usage.cacheRead}`);
  if (usage.cacheWrite > 0) parts.push(`W${usage.cacheWrite}`);
  if (usage.cost > 0) parts.push(`$${usage.cost.toFixed(3)}`);
  if (meta.plan) parts.push(`(${meta.plan})`);
  if (usage.ratePercent > 0) {
    parts.push(
      usage.contextWindow > 0
        ? `${usage.ratePercent.toFixed(1)}%/${usage.contextWindow}`
        : `${usage.ratePercent.toFixed(1)}%`,
    );
  } else if (usage.contextWindow > 0) {
    parts.push(`/${usage.contextWindow}`);
  }
  const model = [meta.provider ? `(${meta.provider})` : '', meta.model].filter(Boolean).join(' ');
  if (model) parts.push(model);
  if (meta.thinking) parts.push(`• ${meta.thinking}`);
  return parts.join(' ');
}

export type FindPromptSegment = { highlighted: boolean; text: string };

/** UTF-8 byte length of a single code point. */
function utf8Length(codePoint: number): number {
  if (codePoint < 0x80) return 1;
  if (codePoint < 0x800) return 2;
  if (codePoint < 0x10000) return 3;
  return 4;
}

/**
 * The prompt as one line split into plain and highlighted runs.
 *
 * The matcher reports BYTE offsets into UTF-8 text because it matches bytes,
 * while JavaScript indexes UTF-16 code units, so the offsets are walked per
 * code point. A character is highlighted when its first byte is one of the
 * offsets, the rule the terminal picker paints with. Newlines and tabs collapse
 * to one space, the same sanitizing the picker does before drawing a row.
 */
export function promptLineSegments(text: string, byteOffsets: readonly number[]): FindPromptSegment[] {
  const marks = new Set(byteOffsets);
  const segments: FindPromptSegment[] = [];
  let byteOffset = 0;
  let run = '';
  let runHighlighted = false;
  let pendingWhitespace = false;
  const push = (character: string, highlighted: boolean) => {
    if (run.length > 0 && highlighted !== runHighlighted) {
      segments.push({ highlighted: runHighlighted, text: run });
      run = '';
    }
    runHighlighted = highlighted;
    run += character;
  };
  for (const character of text) {
    const size = utf8Length(character.codePointAt(0) ?? 0);
    if (character === '\n' || character === '\r' || character === '\t') {
      if (!pendingWhitespace) push(' ', false);
      pendingWhitespace = true;
    } else {
      pendingWhitespace = false;
      push(character, marks.has(byteOffset));
    }
    byteOffset += size;
  }
  if (run.length > 0) segments.push({ highlighted: runHighlighted, text: run });
  return segments;
}
