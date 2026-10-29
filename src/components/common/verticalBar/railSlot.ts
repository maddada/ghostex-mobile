/**
 * The side bar's single slot for the focused screen's header buttons and the colour of the strip they
 * stand on (VerticalBarArea renders it): the screen's own background, so the strip continues the
 * screen rather than reading as a bar beside it. Kept free of React Native so its update rule
 * (`nextRailSlot`) is testable under `bun test`.
 */

import { createContext, useContext, useId, useLayoutEffect, type ReactElement } from 'react';

import type { WindowRect } from '../../../../modules/ghostex-native/src/GhostexNative.types';
import type { RailMoreMenu } from './layout';

/**
 * One header button: drawn as a round rail button, or, when the rail has no room for it, offered as an
 * item of the screen's "More options" menu with the same label and action.
 */
export type RailEntry = {
  readonly key: string;
  readonly label: string;
  /** The button's glyph at `size` points. */
  readonly icon: (size: number) => ReactElement;
  /**
   * Pressed: as a button with its window frame, for a menu it opens to stand at it (F3); as a menu item
   * without one.
   */
  readonly onPress: (anchor?: WindowRect) => void;
  /** Not available right now (drawn dimmed, not pressable). */
  readonly disabled?: boolean;
  /** A switch: on or off (announced as a switch, drawn pressed in while on). */
  readonly selected?: boolean;
};

/**
 * A screen's rail: its buttons top to bottom with its "More options" last, how many leading ones never
 * move, whether that "More options" always shows or only when the other buttons do not fit
 * (`RailMoreMenu`), and whether a keyboard can appear while the rail shows (its own text inputs, or a
 * sheet, menu or dialog it opens with one), so the rail keeps clear of it (owner decisions K-15, D1,
 * D3, 2026-10-26).
 */
export type RailButtons = {
  readonly entries: readonly RailEntry[];
  readonly pinned: number;
  readonly moreMenu: RailMoreMenu;
  readonly reserveKeyboard: boolean;
};

export type RailSlot = { readonly owner: string; readonly buttons: RailButtons; readonly background: string };
export type SetRailSlot = (update: (current: RailSlot | null) => RailSlot | null) => void;

/** A screen showing its buttons in the side bar, or leaving it (unfocused, header elsewhere, unmounted). */
export type RailEvent =
  | { readonly kind: 'show'; readonly owner: string; readonly buttons: RailButtons; readonly background: string }
  | { readonly kind: 'leave'; readonly owner: string };

/**
 * The slot after `event`. Showing what the slot already holds for the same owner keeps the current
 * slot, so React bails out of the side bar's re-render; leaving clears only the leaving owner's
 * buttons, never those a screen focused since has put there.
 */
export function nextRailSlot(current: RailSlot | null, event: RailEvent): RailSlot | null {
  if (event.kind === 'leave') return current?.owner === event.owner ? null : current;
  if (current?.owner === event.owner && current.buttons === event.buttons && current.background === event.background) {
    return current;
  }
  return { owner: event.owner, buttons: event.buttons, background: event.background };
}

export const RailContext = createContext<SetRailSlot>(() => undefined);

/**
 * Stands `buttons` in the side bar region (VerticalBarArea) on a strip of the screen's own `background`
 * while `active` (the screen is focused and its header is in the rail); inactive or unmounted clears
 * what this caller put there. Pass `buttons` memoized on the header's inputs: the side bar republishes
 * only when they change (REQ-NFR-003). Published before the frame is painted, so the buttons arrive in
 * the rail in the same frame the header leaves the top (owner, 2026-10-26: nothing may jump).
 */
export function useRailButtons(buttons: RailButtons, background: string, active: boolean): void {
  const setSlot = useContext(RailContext);
  const owner = useId();
  useLayoutEffect(() => {
    if (!active) return undefined;
    return () => setSlot((current) => nextRailSlot(current, { kind: 'leave', owner }));
  }, [setSlot, owner, active]);
  useLayoutEffect(() => {
    if (active) setSlot((current) => nextRailSlot(current, { kind: 'show', owner, buttons, background }));
  }, [setSlot, owner, active, buttons, background]);
}
