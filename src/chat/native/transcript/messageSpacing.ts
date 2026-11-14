/**
 * Message spacing (`chatLook.spacing`, gx-chat-core `transcript/chat_look.rs`): at Compact the
 * rows sit 8pt apart instead of 16pt (and so do two one-line cards in a row, `cardSpacing.ts`), a
 * message keeps a 22pt footer row under it that always shows its tappable parts (the time, and the
 * work button under Agent work Quiet, `MessageActions.tsx`), a quiet line sits closer to the
 * agent text above it, and the gaps inside a row shrink by the same ratio (`innerGapOf`). The message's other actions stay in its long-press menu. At Default nothing
 * here changes a size.
 *
 * CDXC:SessionChat 2026-11-07 SEE-ALSO:
 * packages/gx-chat-core/src/transcript/chat_look.rs (the user decision), apps/desktop/src/app/native_chat/message_spacing.rs (the desktop's gaps and its hover footer).
 */

import type { ChatLook } from '../../rust/document';
import { useContext } from 'react';

import { ROW_GAP } from './cardSpacing';
import { useChatLook } from './context';
import { BoxedToolCards } from './ToolCard';
import { MESSAGE_PART_GAP } from './theme';

/** The space every row ends with at Compact (desktop `COMPACT_ROW_GAP`). */
const COMPACT_ROW_GAP = 8;
/** The space between the agent's text and a quiet line under it in the same message at Compact (desktop `COMPACT_QUIET_TEXT_GAP`). */
const COMPACT_QUIET_TEXT_GAP = 6;
/** The footer row under a message at Compact (the desktop's is 20px; the phone's is a finger taller). */
export const FOOTER_HEIGHT = 22;
/** How much of the muted colour the footer's time and work button show at rest (desktop `FOOTER_DIM`). */
export const FOOTER_DIM = 0.65;

/** Message spacing is Compact. */
export function compactSpacing(look: ChatLook): boolean {
  return look.spacing === 'compact';
}

/** The space every row ends with, which is also the space between two one-line cards (`gapAbove`). */
export function rowGapOf(look: ChatLook): number {
  return compactSpacing(look) ? COMPACT_ROW_GAP : ROW_GAP;
}

/** This transcript's row gap (`rowGapOf`). */
export function useRowGap(): number {
  return rowGapOf(useChatLook());
}

/** The space between the cards on an opened Quiet View line's rail, the body's own gap between its
 *  parts (desktop `RAIL_ROW_GAP`): an opened "3 items updated" line's work item cards sit this close,
 *  as a "1 report · 1 tool call" line's cards do (user, 2026-11-12: the gap is "ALWAYS small"). */
export const RAIL_ROW_GAP = 8;

/**
 * The space between two one-line cards drawn here: the rail's `RAIL_ROW_GAP` inside an opened Quiet
 * View line (`BoxedToolCards`), the row gap elsewhere (desktop `card_stack_gap` in quiet_view.rs,
 * where the reason is: a "1 tool call" card and the "Message to" card under it sat a row gap apart
 * on the rail while its other cards sat 8 apart).
 */
export function useCardStackGap(): number {
  const rowGap = useRowGap();
  return useContext(BoxedToolCards) ? RAIL_ROW_GAP : rowGap;
}

/**
 * A gap inside a row (between a finished turn's parts, under a thinking, side question or status
 * row), shrunk at Compact by the row gap's own ratio (16pt to 8pt): `gap` at Default (desktop
 * `inner_gap`).
 */
export function innerGapOf(look: ChatLook, gap: number): number {
  return compactSpacing(look) ? (gap * COMPACT_ROW_GAP) / ROW_GAP : gap;
}

/** This transcript's `innerGapOf(gap)`. */
export function useInnerGap(gap: number): number {
  return innerGapOf(useChatLook(), gap);
}

/** How far a quiet line under the agent's text is pulled up from the message's part gap: nothing at Default. */
export function quietLineLift(look: ChatLook): number {
  return compactSpacing(look) ? MESSAGE_PART_GAP - COMPACT_QUIET_TEXT_GAP : 0;
}
