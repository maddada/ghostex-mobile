/**
 * A Session Tags row's drag in Settings (SessionTagsSection.tsx): where a drop lands and whether it writes. The finger's
 * position and the list's frame are both window coordinates measured at the drop, so the page's scroll is in them; a
 * drop outside the list on either axis, a cancelled drag, or a drag started on a list that has changed since (an edit
 * synced in) writes nothing. A drop inside writes the whole held list with the entry moved (`moveHeldTagItem`), every
 * held entry the selected computer's catalog lacks kept in its place.
 */

import type { GhostexCustomSessionTags } from '../../contract/mobileSummary/model';
import {
  listedTagItems,
  moveHeldTagItem,
  normalizeTagListItems,
  type TagListItem,
} from '../../contract/sessionTagList';

/** A frame in window coordinates (`measureInWindow`). */
export type WindowFrame = { x: number; y: number; width: number; height: number };

/** A listed row's place inside the list (its `onLayout`). */
export type RowFrame = { y: number; height: number };

/** The drag under way: the entry and the stored list it started on. Held by the screen, changed only by events. */
export type TagDragState = { lifted: { id: string; from: string } | null };

export type TagDragDeps = {
  /** The stored list as the stores hold it now (not as a render last drew it); `null` when the phone holds none. */
  readHeld: () => unknown[] | null;
  /** The selected computer's custom tags the list is read with; `null` without a computer. */
  catalog: GhostexCustomSessionTags | null;
  grouping: boolean;
  /** Saves the whole list. */
  write: (next: unknown[]) => void;
  /** VoiceOver's word on the move: the entry and its new 0-based place among the listed entries. */
  announce: (item: TagListItem, position: number) => void;
};

const signature = (held: readonly unknown[] | null): string => JSON.stringify(held);

/** The listed position under the finger, or `null` when the finger is outside the list on either axis. */
export function dropPosition(
  listed: readonly TagListItem[],
  rows: ReadonlyMap<string, RowFrame>,
  list: WindowFrame,
  finger: { x: number; y: number },
): number | null {
  if (finger.x < list.x || finger.x > list.x + list.width) return null;
  if (finger.y < list.y || finger.y > list.y + list.height) return null;
  const y = finger.y - list.y;
  for (const [index, item] of listed.entries()) {
    const row = rows.get(item.id);
    if (row !== undefined && y >= row.y && y < row.y + row.height) return index;
  }
  return null;
}

export function liftTag(state: TagDragState, deps: TagDragDeps, id: string): void {
  state.lifted = { id, from: signature(deps.readHeld()) };
}

export function cancelTagDrag(state: TagDragState): void {
  state.lifted = null;
}

/** Ends the drag of `id` at `finger`; true when it wrote a new order. */
export function dropTag(
  state: TagDragState,
  deps: TagDragDeps,
  id: string,
  finger: { x: number; y: number },
  list: WindowFrame,
  rows: ReadonlyMap<string, RowFrame>,
): boolean {
  const started = state.lifted;
  state.lifted = null;
  if (started === null || started.id !== id) return false;
  const held = deps.readHeld();
  if (signature(held) !== started.from) return false;
  const listed = listedTagItems(normalizeTagListItems(held, deps.catalog), deps.grouping);
  const position = dropPosition(listed, rows, list, finger);
  const item = listed.find((entry) => entry.id === id);
  if (position === null || item === undefined) return false;
  const next = moveHeldTagItem(held, deps.catalog, id, position, deps.grouping);
  if (next === null) return false;
  deps.write(next);
  deps.announce(item, position);
  return true;
}
