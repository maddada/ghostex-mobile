/**
 * How far apart two one-line cards that follow each other sit in the transcript (desktop
 * `SINGLE_LINE_CARD.gap_above` in apps/desktop/src/app/native_chat/cards.rs).
 *
 * CDXC:SessionChat 2026-10-27 SEE-ALSO:
 * The user's decision is on `gap_above` in the desktop's cards.rs: two one-line cards in a row are
 * always one transcript row gap apart, whatever kind each is and wherever a turn starts or ends.
 * `ROW_GAP` is `rowGap` in packages/gx-chat-core/visual/transcript-layout.json; the phone copies
 * the shared visual values (it is built on its own), so change them together.
 */

/** The space every transcript row ends with, and the space between two one-line cards. */
export const ROW_GAP = 16;

/** The space above a part of a row: the row gap (Message spacing's, `messageSpacing.ts`) when it and the part above it are both one-line cards, `gap` otherwise. */
export function gapAbove(aboveIsCard: boolean, isCard: boolean, gap: number, rowGap: number = ROW_GAP): number {
  return aboveIsCard && isCard ? rowGap : gap;
}

/** What a stack of one-line cards adds on top of its column's own `gap` so it sits `gapAbove` from the part above. */
export function cardStackMargin(aboveIsCard: boolean, gap: number, rowGap: number = ROW_GAP): number {
  return gapAbove(aboveIsCard, true, gap, rowGap) - gap;
}
