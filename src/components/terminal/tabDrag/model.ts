/**
 * Where a held tab would land and how the other tabs make room for it (`useTabDrag` in tabDrag/TabDrag.tsx). Everything is in window
 * points, measured when the drag starts; the tabs slide by whole tab places, so the places measured then hold for the
 * whole drag. Free of React Native.
 */

import type { TabSide } from '../../../terminal/tabSplit';

export type Rect = { readonly x: number; readonly y: number; readonly width: number; readonly height: number };

/** A tab bar: the only one, or one side's. */
export type BarId = 'single' | TabSide;

export type BarFrames = {
  readonly id: BarId;
  /** The bar's capsule. */
  readonly track: Rect;
  /** Its tabs in order, the held one included when it is this bar's. */
  readonly slots: readonly { readonly key: string; readonly rect: Rect }[];
};

/**
 * What a drop there does: put the tab at `index` (among the bar's tabs without the held one) of a bar; open it beside
 * the rest (`split`, the chat's right half on a wide window); or move it to a side by dropping on that side's chat.
 */
export type DropTarget =
  | { readonly kind: 'bar'; readonly bar: BarId; readonly index: number }
  | { readonly kind: 'split' }
  | { readonly kind: 'side'; readonly side: TabSide };

/** How far above and below a bar a held tab still drops into it: about a finger. */
export const BAR_REACH = 28;

function inside(rect: Rect, x: number, y: number, reachY = 0): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y - reachY && y <= rect.y + rect.height + reachY;
}

/** The right half of the chat's area: where a drop opens the tab beside the rest. */
export function splitZone(chat: Rect): Rect {
  return { x: chat.x + chat.width / 2, y: chat.y, width: chat.width / 2, height: chat.height };
}

/** The place among a bar's other tabs that a finger at `x` points to: after every tab whose middle it passed. */
export function insertionIndex(bar: BarFrames, key: string, x: number): number {
  return bar.slots.filter((slot) => slot.key !== key && slot.rect.x + slot.rect.width / 2 < x).length;
}

export type DropZones = {
  readonly bars: readonly BarFrames[];
  /** The chat's area while a drop there can open the tab beside the rest, else null. */
  readonly splitChat: Rect | null;
  /** Each side's chat while the tabs are side by side. */
  readonly sides: readonly { readonly side: TabSide; readonly rect: Rect }[];
};

/**
 * Where a tab `key` held from bar `from` lands with the finger at (`x`, `y`), or null where a drop does nothing (it goes
 * back to its place).
 */
export function dropTarget(zones: DropZones, key: string, from: BarId, x: number, y: number): DropTarget | null {
  for (const bar of zones.bars) {
    if (inside(bar.track, x, y, BAR_REACH)) return { kind: 'bar', bar: bar.id, index: insertionIndex(bar, key, x) };
  }
  if (zones.splitChat !== null && inside(splitZone(zones.splitChat), x, y)) return { kind: 'split' };
  for (const { side, rect } of zones.sides) {
    if (side !== from && inside(rect, x, y)) return { kind: 'side', side };
  }
  return null;
}

/**
 * How far each tab of a bar slides while tab `key` (`heldWidth` wide) is held: the bar's other tabs close up where the
 * held one left and open a gap where it would land (`target` in this bar). In its own bar a place is a tab's width and
 * the gap between tabs; in another bar the gap is the held tab's width, at most a place (a lone tab filling its bar
 * moves aside by that much instead of out of sight).
 */
export function tabShifts(
  bar: BarFrames,
  key: string,
  target: DropTarget | null,
  spacing: number,
  heldWidth: number,
): Map<string, number> {
  const shifts = new Map<string, number>();
  const place = (bar.slots[0]?.rect.width ?? 0) + spacing;
  const own = bar.slots.some((slot) => slot.key === key);
  const gapWidth = own ? place : Math.min(place, heldWidth + spacing);
  const gap = target?.kind === 'bar' && target.bar === bar.id ? target.index : null;
  let rest = 0;
  bar.slots.forEach((slot, at) => {
    if (slot.key === key) return;
    // Closing up where the held tab left (its own bar), then the gap where it would land.
    const closed = (rest - at) * place;
    shifts.set(slot.key, closed + (gap !== null && rest >= gap ? gapWidth : 0));
    rest += 1;
  });
  return shifts;
}

/** Whether a drop changes anything: a bar place other than the one the tab left, a new side, or a split. */
export function dropMoves(target: DropTarget | null, bars: readonly BarFrames[], key: string, from: BarId): boolean {
  if (target === null) return false;
  if (target.kind !== 'bar' || target.bar !== from) return true;
  const bar = bars.find((entry) => entry.id === from);
  const was = bar?.slots.findIndex((slot) => slot.key === key) ?? -1;
  return was !== target.index;
}
