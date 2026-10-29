/**
 * Where the app's content and its screen headers go, from the system's bar regions (BarLayout).
 *
 * Built with the iOS 27.1 SDK the app reaches the screen edges on the iPhone Duo (approved S1 mockup).
 * Owner decision 2026-10-27 (§12, "1b"): the app's root view controller turns the system's vertical bar
 * off (`GhostexRootViewController`), so the status items run along the top in every pose and:
 * - band: the top bar region lies inside the status band, beside the status items (folded, unfolded in
 *   portrait and, where the system reports it so, in landscape). The header row sits there, its buttons
 *   overflowing into the screen's "…" menu when they do not fit (`bandSplit`);
 * - top: where the top bar region lies below the safe area's top inset (every other iPhone, the Duo
 *   folded in the landscape that puts the camera at the bottom), the header stays where it was;
 * - rail: only where the system does stand a vertical bar on a side. The Duo no longer has it; the code
 *   stays for a system that reports one.
 * Nothing here knows a device size: all frames come from the system.
 */

import type { ViewStyle } from 'react-native';

import type {
  BarLayout,
  FoldDivision,
  SizeClass,
  WindowRect,
} from '../../../../modules/ghostex-native/src/GhostexNative.types';

export type HorizontalInsets = { readonly left: number; readonly right: number };

export const NO_BAR_INSETS: HorizontalInsets = Object.freeze({ left: 0, right: 0 });

/**
 * How far content keeps off the window's sides: the window's safe area while the system stands a bar
 * on a side. The layout's own insets win, so they belong to the same window size as its regions.
 */
export function verticalBarInsets(layout: BarLayout | null, safeArea: HorizontalInsets): HorizontalInsets {
  if (layout?.edge === undefined) return NO_BAR_INSETS;
  const left = layout.safeLeft ?? safeArea.left;
  const right = layout.safeRight ?? safeArea.right;
  return left === 0 && right === 0 ? NO_BAR_INSETS : { left, right };
}

/** A scroll view's own style and its content's horizontal padding (`scrollToBarEdges`). */
export type ScrollEdges = { readonly scroll: ViewStyle; readonly content: ViewStyle };

const NO_SCROLL_EDGES: ScrollEdges = Object.freeze({ scroll: {}, content: {} });

/**
 * FL-LAY-05: a scroll view in the content column spans the window under the side bar, and keeps its
 * content clear of it: the side bar's insets go into the content's horizontal padding (added to the
 * content's own `contentPadding`, the same on both sides or per side), not around the scroll view.
 * Without a side bar (every other iPhone, also in landscape) nothing changes.
 */
export function scrollToBarEdges(space: HorizontalInsets, contentPadding: number | HorizontalInsets = 0): ScrollEdges {
  if (space.left === 0 && space.right === 0) return NO_SCROLL_EDGES;
  const own = typeof contentPadding === 'number' ? { left: contentPadding, right: contentPadding } : contentPadding;
  return {
    // `0 - inset` rather than `-inset`: the side without a bar gets 0, not -0.
    scroll: { marginLeft: 0 - space.left, marginRight: 0 - space.right },
    content: { paddingLeft: own.left + space.left, paddingRight: own.right + space.right },
  };
}

/**
 * A full-window layer (a modal's dimmed backdrop) that keeps what it holds clear of the side bar: its
 * own horizontal padding `base` plus the side bar's insets, so the layer itself still covers the whole
 * window (FL-LAY-05).
 */
export function barPadding(space: HorizontalInsets, base: number): ViewStyle {
  return { paddingLeft: base + space.left, paddingRight: base + space.right };
}

/** Bar layouts by `geometryKey`: the last one seen at each window size with each side bar edge. */
export type StoredBarLayouts = Readonly<Record<string, BarLayout>>;

/**
 * The system's latest bar layout and the window size React Native reported when it arrived
 * (`windowSizeKey`): the two reports of one window change come over separate paths, in either order.
 */
export type LiveBarLayout = { readonly layout: BarLayout; readonly seenAt: string };

/**
 * The bar layout the chrome follows in a window of `size` (owner, 2026-10-26: nothing may jump), or
 * null before the system has reported one (the chrome then waits, `VerticalBarArea`). Only layouts the
 * system took are used, never a guessed fallback:
 * - the live one while it belongs to this window: taken at this size, or newer than React Native's size
 *   (the system's report of a rotation, fold or unfold arrived first);
 * - once React Native reports a newer size, the layout last stored for that size with the side bar on
 *   the edge the system reports now, as the window had it before;
 * - else still the live one, until the system's own report for the new size arrives. The chrome then
 *   changes once, from the old window's layout to the new window's.
 */
export function chromeLayout(size: WindowSize, live: LiveBarLayout | null, stored: StoredBarLayouts): BarLayout | null {
  if (live === null) return null;
  const key = windowSizeKey(size);
  if (layoutSizeKey(live.layout) === key || live.seenAt === key) return live.layout;
  return stored[geometryKey(size, live.layout.edge)] ?? live.layout;
}

/**
 * The layout the screens start with before the system's first report: the one an earlier launch kept for
 * this window size (the app keeps the vertical bar off, so it is stored without a side), else none, which
 * puts the header on top. A returning iPhone Duo starts in its band; every other iPhone shows its screens at
 * once instead of waiting a native round trip on an empty page.
 */
export function provisionalLayout(size: WindowSize, stored: StoredBarLayouts): BarLayout | null {
  return stored[geometryKey(size, undefined)] ?? null;
}

/** The window size a layout was taken at, as a `windowSizeKey`, or null when it carries none. */
export function layoutSizeKey(layout: BarLayout): string | null {
  const { windowWidth, windowHeight } = layout;
  return windowWidth === undefined || windowHeight === undefined
    ? null
    : windowSizeKey({ width: windowWidth, height: windowHeight });
}

/**
 * A stored layout's key: the window size and the side bar's edge. The same size has a side bar on
 * either side (the unfolded Duo turned either way in landscape), or none.
 */
export function geometryKey(size: WindowSize, edge: BarLayout['edge']): string {
  return `${windowSizeKey(size)}:${edge ?? 'none'}`;
}

/** The `geometryKey` a layout is stored under, or null when it carries no window size. */
export function layoutGeometryKey(layout: BarLayout): string | null {
  const { windowWidth, windowHeight, edge } = layout;
  return windowWidth === undefined || windowHeight === undefined
    ? null
    : geometryKey({ width: windowWidth, height: windowHeight }, edge);
}

/**
 * The kept layouts after the system reported `layout` (§1.5 S1-10, review s1-floor-r2 #3): a stored
 * layout stands in for a window size only while the system has not contradicted it. A report that
 * differs from the layout kept for its own window size and side bar edge means the status items moved
 * since (a Live Activity starting or ending), and they moved for every window: every other kept layout
 * was taken before and is dropped, so at those sizes the chrome keeps the old window's layout until
 * the system reports the new one. A report that differs only in whether a division is active is the
 * device folding or lying flat, which moves no bar: it replaces its own layout and keeps the others.
 * Null when nothing changes.
 */
export function layoutsAfterReport(layouts: StoredBarLayouts, layout: BarLayout): StoredBarLayouts | null {
  const key = layoutGeometryKey(layout);
  if (key === null) return null;
  const kept = layouts[key];
  if (kept === undefined) return { ...layouts, [key]: layout };
  if (canonical(kept) === canonical(layout)) return null;
  return canonical(barsOf(kept)) === canonical(barsOf(layout)) ? { ...layouts, [key]: layout } : { [key]: layout };
}

/** A layout without the divisions' fold state: where the bars and the divisions are. */
function barsOf(layout: BarLayout): BarLayout {
  return layout.divisions === undefined
    ? layout
    : { ...layout, divisions: layout.divisions.map((division) => ({ ...division, active: false })) };
}

/** A value as JSON with its objects' keys in order, so two reports of one layout compare equal. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, field: unknown) =>
    field !== null && typeof field === 'object' && !Array.isArray(field)
      ? Object.fromEntries(Object.entries(field).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : field,
  );
}

export type HeaderPlacement =
  | { readonly kind: 'top' }
  | { readonly kind: 'band'; readonly frame: WindowRect }
  | { readonly kind: 'rail'; readonly frame: WindowRect };

export const TOP_PLACEMENT: HeaderPlacement = Object.freeze({ kind: 'top' });

export function headerPlacement(layout: BarLayout | null): HeaderPlacement {
  if (layout === null) return TOP_PLACEMENT;
  const { edge, sideBar, topBar, safeTop } = layout;
  if (edge !== undefined && sideBar !== undefined && sideBar.width > 0 && sideBar.height > 0) {
    return { kind: 'rail', frame: sideBar };
  }
  // The top bar region inside the top safe-area inset is the status band beside the status items;
  // below the inset (every other iPhone) the system keeps bars under the status bar, as the header is.
  if (topBar !== undefined && safeTop !== undefined && topBar.width > 0 && topBar.y + topBar.height <= safeTop) {
    return { kind: 'band', frame: clearOfDivisions(topBar, layout.divisions) };
  }
  return TOP_PLACEMENT;
}

/**
 * FL-DUO-03 (owner B1, 2026-10-27): the part of `rect` clear of the fold's divisions, for the band's
 * row: a division across it cuts it along the division's long side, and the larger part stays, so no
 * band button stands in a division.
 */
export function clearOfDivisions(rect: WindowRect, divisions: readonly WindowRect[] | undefined): WindowRect {
  let clear = rect;
  for (const division of divisions ?? []) {
    const across = division.width >= division.height;
    const [start, length] = across ? [clear.y, clear.height] : [clear.x, clear.width];
    const [otherStart, otherLength] = across ? [clear.x, clear.width] : [clear.y, clear.height];
    const from = across ? division.y : division.x;
    const to = from + (across ? division.height : division.width);
    const otherFrom = across ? division.x : division.y;
    const otherTo = otherFrom + (across ? division.width : division.height);
    if (to <= start || from >= start + length || otherTo <= otherStart || otherFrom >= otherStart + otherLength)
      continue;
    const before = from - start;
    const after = start + length - to;
    const [keptStart, keptLength] = before >= after ? [start, before] : [to, after];
    clear = across ? { ...clear, y: keptStart, height: keptLength } : { ...clear, x: keptStart, width: keptLength };
  }
  return clear;
}

/** A content row on top of a screen in the side bar's poses: a standard bar's height (F1, 2026-10-26). */
export const CONTENT_ROW_HEIGHT = 44;

/**
 * Where a screen's top row starts in the side bar's poses (F1, 2026-10-26: nothing touches the window's
 * top edge): below the system's top layout margin of the window, never above its safe area.
 */
export function railContentTop(layout: BarLayout | null, safeTop: number): number {
  return Math.max(safeTop, layout?.marginTop ?? safeTop);
}

/**
 * Settings' list column in two columns: UIKit's split view keeps its primary column 320 pt wide by
 * default.
 */
export const SETTINGS_LIST_WIDTH = 320;

/**
 * The narrowest page the right column gives a Settings page: the Settings pages are laid out for
 * iPhone windows, the narrowest of them 375 pt wide, so a page beside the list is never narrower than
 * on any iPhone they ship on.
 */
export const SETTINGS_PAGE_MIN_WIDTH = 375;

/**
 * Owner decision F2 (2026-10-26, "Zweispaltig wie iPad-Einstellungen"): Settings shows two columns where
 * the iPhone Duo's chrome is in place (status band or side bar) and the content's width holds the list
 * and a page at least `SETTINGS_PAGE_MIN_WIDTH` wide. From the window's content, not its orientation:
 * that is the unfolded Duo in landscape; unfolded in portrait, folded, Split View and every other
 * iPhone or iPad keep one column.
 */
export function twoColumnWindow(layout: BarLayout | null): boolean {
  if (layout === null || layout.windowWidth === undefined || headerPlacement(layout).kind === 'top') return false;
  const { left, right } = verticalBarInsets(layout, NO_BAR_INSETS);
  return layout.windowWidth - left - right >= SETTINGS_LIST_WIDTH + SETTINGS_PAGE_MIN_WIDTH;
}

/** A header row `rowHeight` tall centred on the band's bar region, in window points. */
export function bandRowFrame(frame: WindowRect, rowHeight: number): { left: number; top: number; width: number } {
  return { left: frame.x, top: frame.y + (frame.height - rowHeight) / 2, width: frame.width };
}

/** Where a menu stands within the window, in window points (inside safe area and side bar). */
export type MenuRoom = { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number };

/** The space between a menu and the button it opened from. */
const MENU_GAP = 8;

/**
 * F3 (2026-10-26, the owner's rule that menus do not float in the middle): a menu opened from a header
 * button on the iPhone Duo stands at that button as an iOS pull-down does. From a side bar button it
 * opens beside the side bar, toward the content, top-aligned with the button; from a status band button
 * it opens below the button, its trailing edge at the button's. Either way it stays inside `room`.
 */
export function anchoredMenuOrigin(
  anchor: WindowRect,
  menu: { readonly width: number; readonly height: number },
  room: MenuRoom,
  from: 'rail' | 'band',
  edge: BarLayout['edge'],
): { left: number; top: number } {
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
  const left =
    from === 'band'
      ? anchor.x + anchor.width - menu.width
      : edge === 'leading'
        ? anchor.x + anchor.width + MENU_GAP
        : anchor.x - MENU_GAP - menu.width;
  const top = from === 'band' ? anchor.y + anchor.height + MENU_GAP : anchor.y;
  return {
    left: clamp(left, room.left, room.right - menu.width),
    top: clamp(top, room.top, room.bottom - menu.height),
  };
}

/**
 * FL-DUO-03 (owner B1, 2026-10-27): the part of `room` on the side of the fold's active divisions where
 * the menu's button is, so a menu at its button stays wholly on that side (it scrolls in what is left).
 * An inactive division (the device lies flat) divides nothing, so a menu reaches across it (device
 * finding 2026-10-27: flat in portrait, Terminal's menu was cut at the fold line).
 */
export function menuRoomBeside(
  room: MenuRoom,
  anchor: WindowRect,
  divisions: readonly FoldDivision[] | undefined,
): MenuRoom {
  let beside = room;
  for (const division of divisions ?? []) {
    if (!division.active) continue;
    const across = division.width >= division.height;
    const [start, end] = across ? [beside.top, beside.bottom] : [beside.left, beside.right];
    const [otherStart, otherEnd] = across ? [beside.left, beside.right] : [beside.top, beside.bottom];
    const from = across ? division.y : division.x;
    const to = from + (across ? division.height : division.width);
    const otherFrom = across ? division.x : division.y;
    const otherTo = otherFrom + (across ? division.width : division.height);
    if (to < start || from > end || otherTo <= otherStart || otherFrom >= otherEnd) continue;
    const anchorMiddle = across ? anchor.y + anchor.height / 2 : anchor.x + anchor.width / 2;
    const before = anchorMiddle < (from + to) / 2;
    beside = across
      ? before
        ? { ...beside, bottom: Math.min(beside.bottom, from) }
        : { ...beside, top: Math.max(beside.top, to) }
      : before
        ? { ...beside, right: Math.min(beside.right, from) }
        : { ...beside, left: Math.max(beside.left, to) };
  }
  return beside;
}

/** The window frame of a side bar button standing at `top` (`railLayoutFor`'s `tops`), centred across it. */
export function railButtonFrame(frame: WindowRect, fit: RailFit, top: number): WindowRect {
  return { x: frame.x + (frame.width - fit.size) / 2, y: top, width: fit.size, height: fit.size };
}

/**
 * How much further down than the rail's flow (`step` from one button's top to the next, from `top`)
 * each button stands: the room of a division it steps over (owner B1), else 0.
 */
export function railStepOffsets(tops: readonly number[], top: number, step: number): number[] {
  return tops.map((buttonTop, index) => Math.max(0, buttonTop - (index === 0 ? top : tops[index - 1] + step)));
}

/**
 * Where an open menu stands (S1-5, F3: at its button): at that button as it is now, not where it was
 * pressed. In the side bar its frame follows from the side bar's layout (`railButtonFrame`); in the
 * status band it is the screen's own button (`hasBandButton`), measured again after each change of the
 * bar layout; until either is known, where it was pressed. A menu whose button has no place in the
 * band, and every menu on top (every other iPhone), is centred.
 */
export function liveMenuAnchor(
  placement: HeaderPlacement['kind'],
  railFrame: WindowRect | null,
  bandFrame: WindowRect | undefined,
  pressed: WindowRect | undefined,
  hasBandButton: boolean,
): WindowRect | undefined {
  if (placement === 'top') return undefined;
  if (placement === 'rail') return railFrame ?? pressed;
  return hasBandButton ? (bandFrame ?? pressed) : undefined;
}

/** The side bar's round buttons and the space between them, in points. */
export type RailFit = { readonly size: number; readonly gap: number };

/** Approved mockup: 46-pt buttons 12 pt apart; tightest allowed: 40-pt buttons 4 pt apart. */
export const RAIL_FIT: RailFit = Object.freeze({ size: 46, gap: 12 });
const RAIL_MIN: RailFit = Object.freeze({ size: 40, gap: 4 });
/** The smallest touch target (Apple HIG), kept by hit slop when a button is drawn smaller. */
const MIN_TOUCH = 44;

/** How far down from the side bar region's top the buttons may reach: to its end, or to the keyboard's top. */
export function railSpan(frame: WindowRect, keyboardTop: number | null): number {
  const bottom = frame.y + frame.height;
  return Math.max(0, (keyboardTop === null ? bottom : Math.min(bottom, keyboardTop)) - frame.y);
}

/** A stretch of the side bar the buttons may stand in, top to bottom in points. */
export type RailSegment = { readonly top: number; readonly bottom: number };

/** Where the side bar's buttons may stand: its span from 0 (`railSpan`), or its stretches (`railSegments`). */
export type RailRoom = number | readonly RailSegment[];

/**
 * FL-DUO-03 (owner B1, 2026-10-27): the side bar's span in window points with the fold's divisions
 * across it left out, so no button stands in a division; one stretch where none crosses it. A division
 * along the side bar (taller than wide) cannot be stepped over and is left to the system's layout.
 */
export function railSegments(
  frame: WindowRect,
  keyboardTop: number | null,
  divisions: readonly WindowRect[] | undefined,
): RailSegment[] {
  let segments: RailSegment[] = [{ top: frame.y, bottom: frame.y + railSpan(frame, keyboardTop) }];
  for (const division of divisions ?? []) {
    const acrossRail = division.x < frame.x + frame.width && division.x + division.width > frame.x;
    if (division.height > division.width || !acrossRail) continue;
    const top = division.y;
    const bottom = division.y + division.height;
    segments = segments.flatMap((segment) =>
      bottom < segment.top || top > segment.bottom
        ? [segment]
        : [
            { top: segment.top, bottom: Math.min(segment.bottom, top) },
            { top: Math.max(segment.top, bottom), bottom: segment.bottom },
          ].filter((part) => part.bottom > part.top),
    );
  }
  return segments;
}

/**
 * The tops of `count` buttons placed down the room `fit.gap` apart: a button that would reach past a
 * stretch's end stands at the next stretch's top (owner B1: the buttons flow past a division).
 * `fitted` of them have room; any others follow on below the last, as the kept Back and More options
 * do when even they have no room.
 */
function placeButtons(room: RailRoom, count: number, fit: RailFit): { tops: number[]; fitted: number } {
  const segments = typeof room === 'number' ? [{ top: 0, bottom: room }] : room;
  const tops: number[] = [];
  let index = 0;
  let next = segments[0]?.top ?? 0;
  while (tops.length < count && index < segments.length) {
    const segment = segments[index];
    next = Math.max(next, segment.top);
    if (next + fit.size <= segment.bottom) {
      tops.push(next);
      next += fit.size + fit.gap;
    } else {
      index += 1;
    }
  }
  const fitted = tops.length;
  while (tops.length < count) {
    tops.push(next);
    next += fit.size + fit.gap;
  }
  return { tops, fitted };
}

/**
 * `count` buttons in `room`: as the mockup draws them when they fit; otherwise the gap shrinks
 * (to 4 pt at least), then the buttons (to 40 pt at least). Below that they keep the minimum and
 * `railCapacity` says how many of them stay.
 */
export function railFit(room: RailRoom, count: number): RailFit {
  const fits = (fit: RailFit) => placeButtons(room, count, fit).fitted === count;
  if (count <= 0 || fits(RAIL_FIT)) return RAIL_FIT;
  for (let gap = RAIL_FIT.gap - 1; gap >= RAIL_MIN.gap; gap -= 1) {
    if (fits({ size: RAIL_FIT.size, gap })) return { size: RAIL_FIT.size, gap };
  }
  for (let size = RAIL_FIT.size - 1; size > RAIL_MIN.size; size -= 1) {
    if (fits({ size, gap: RAIL_MIN.gap })) return { size, gap: RAIL_MIN.gap };
  }
  return RAIL_MIN;
}

/**
 * How many of `count` buttons stay in the rail: all of them while they fit at the minimum (40 pt,
 * 4 pt apart), else as many as fit that way, and always one ("More options").
 */
export function railCapacity(room: RailRoom, count: number): number {
  if (count <= 1) return count;
  const { fitted } = placeButtons(room, count, RAIL_MIN);
  return fitted === count ? count : Math.max(1, fitted);
}

/**
 * Owner decision 2026-10-26 ("Überzählige ins …-Menü"): the buttons that do not fit move into the
 * screen's "More options" menu, lowest first. The last button (More options itself) and the first
 * `pinned` ones (Terminal's Back) never move; `shown` comes from `railCapacity`.
 */
export function railSplit<T>(buttons: readonly T[], shown: number, pinned: number): { rail: T[]; menu: T[] } {
  const movable = Math.max(0, buttons.length - 1 - pinned);
  const moving = Math.min(movable, Math.max(0, buttons.length - shown));
  const cut = buttons.length - 1 - moving;
  if (moving === 0) return { rail: [...buttons], menu: [] };
  return { rail: [...buttons.slice(0, cut), ...buttons.slice(-1)], menu: buttons.slice(cut, -1) };
}

/** A band row's buttons: each `size` wide, `gap` apart (the screen's own header buttons). */
export type BandButtons = { readonly size: number; readonly gap: number };

/**
 * Owner decisions 2026-10-26 ("Überzählige ins …-Menü") and 2026-10-27 (§12, "1b": the header stands in
 * the status band beside the status items in every pose): how many of `count` buttons fit in `room`
 * points across, as `railCapacity` says it for the side bar, and always one ("More options", the last).
 */
export function bandCapacity(room: number, count: number, buttons: BandButtons): number {
  if (count <= 1) return count;
  const fitting = Math.max(0, Math.floor((room + buttons.gap) / (buttons.size + buttons.gap)));
  return fitting >= count ? count : Math.max(1, fitting);
}

/** Whether `count` buttons all fit in `room` points across (none always do). */
function bandFits(room: number, count: number, buttons: BandButtons): boolean {
  return count <= 0 || count * buttons.size + (count - 1) * buttons.gap <= room;
}

/**
 * The buttons of a band row in `room`, as `railLayoutFor` has them for the side bar: those that stay in
 * the row and those that move into the screen's "More options" menu, last first. The last button is that
 * "More options", always in the row, or (`whenNeeded`) shown only while the others do not fit; the first
 * `pinned` ones never move.
 */
export function bandSplit<T>(
  room: number,
  buttons: readonly T[],
  pinned: number,
  moreMenu: RailMoreMenu,
  fit: BandButtons,
): { row: T[]; menu: T[] } {
  if (moreMenu === 'whenNeeded') {
    const own = buttons.slice(0, -1);
    if (bandFits(room, own.length, fit)) return { row: own, menu: [] };
  }
  const { rail, menu } = railSplit(buttons, bandCapacity(room, buttons.length, fit), pinned);
  return { row: rail, menu };
}

/**
 * Owner decision 2026-10-26, refined 2026-10-27 (choice A1, §1.5 S1-4): the rail does not move when the
 * keyboard shows or hides. Where a keyboard can reach the rail, it is laid out for the keyboard being
 * up, keyboard or not, so the rail reserves the keyboard's height for its window: the tallest measured
 * in a window of this size on this install (`barGeometry.ts` keeps them). Until a keyboard has appeared
 * there it reserves none. The reserve only grows, so the rail rearranges at most when a keyboard first
 * appears in a window size or a taller one does, and never moves back.
 */
export type WindowSize = { readonly width: number; readonly height: number };

/** Keyboard heights in points by `windowSizeKey`. */
export type KeyboardHeights = Readonly<Record<string, number>>;

/** A window's size as a key for the keyboard heights measured in it. */
export function windowSizeKey(size: WindowSize): string {
  return `${Math.round(size.width)}x${Math.round(size.height)}`;
}

/** The keyboard height to reserve in a window of this size, or null before one was measured there. */
export function keyboardHeightFor(size: WindowSize, measured: KeyboardHeights): number | null {
  return measured[windowSizeKey(size)] ?? null;
}

/**
 * `heights` after a keyboard `height` points tall showed in a window of `sizeKey` (owner A1): the height,
 * rounded, when it is taller than the one kept for that size, else null, since nothing changes.
 */
export function grownKeyboardHeights(
  heights: KeyboardHeights,
  sizeKey: string,
  height: number,
): KeyboardHeights | null {
  const rounded = Math.round(height);
  const kept = heights[sizeKey];
  if (rounded <= 0 || (kept !== undefined && kept >= rounded)) return null;
  return { ...heights, [sizeKey]: rounded };
}

/** Two sets of kept heights as one, each window size keeping the taller (owner A1: never shrinks). */
export function mergedKeyboardHeights(first: KeyboardHeights, second: KeyboardHeights): KeyboardHeights {
  const merged: Record<string, number> = { ...first };
  for (const [key, height] of Object.entries(second)) merged[key] = Math.max(merged[key] ?? 0, height);
  return merged;
}

/** Stored keyboard heights read back: positive numbers by key, anything else dropped. */
export function sanitizeKeyboardHeights(raw: unknown): KeyboardHeights {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  return Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, number] => typeof entry[1] === 'number' && entry[1] > 0),
  );
}

function isRect(value: unknown): value is WindowRect {
  if (typeof value !== 'object' || value === null) return false;
  return ['x', 'y', 'width', 'height'].every((field) => typeof Reflect.get(value, field) === 'number');
}

/** A division read back: a rectangle that says whether it is active (a layout stored without it is not taken). */
function isFoldDivision(value: unknown): value is FoldDivision {
  return isRect(value) && typeof Reflect.get(value, 'active') === 'boolean';
}

/** A stored bar layout read back, or null when it is not one (a region or size of the wrong shape). */
function sanitizeBarLayout(raw: unknown): BarLayout | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const field = (name: string): unknown => Reflect.get(raw, name);
  const numberField = (name: string): number | undefined => {
    const value = field(name);
    return typeof value === 'number' ? value : undefined;
  };
  const windowWidth = numberField('windowWidth');
  const windowHeight = numberField('windowHeight');
  if (windowWidth === undefined || windowHeight === undefined) return null;
  const edge = field('edge');
  const sideBar = field('sideBar');
  const topBar = field('topBar');
  const divisions = field('divisions');
  const marginTop = numberField('marginTop');
  const horizontalSizeClass = sizeClassField(field('horizontalSizeClass'));
  const verticalSizeClass = sizeClassField(field('verticalSizeClass'));
  if (edge !== undefined && edge !== 'leading' && edge !== 'trailing') return null;
  if ((sideBar !== undefined && !isRect(sideBar)) || (topBar !== undefined && !isRect(topBar))) return null;
  if (divisions !== undefined && !(Array.isArray(divisions) && divisions.every(isFoldDivision))) return null;
  return {
    windowWidth,
    windowHeight,
    safeTop: numberField('safeTop'),
    safeLeft: numberField('safeLeft'),
    safeRight: numberField('safeRight'),
    ...(marginTop === undefined ? {} : { marginTop }),
    ...(horizontalSizeClass === undefined ? {} : { horizontalSizeClass }),
    ...(verticalSizeClass === undefined ? {} : { verticalSizeClass }),
    ...(edge === undefined ? {} : { edge }),
    ...(isRect(sideBar) ? { sideBar } : {}),
    ...(isRect(topBar) ? { topBar } : {}),
    ...(Array.isArray(divisions) ? { divisions: divisions.filter(isFoldDivision) } : {}),
  };
}

function sizeClassField(value: unknown): SizeClass | undefined {
  return value === 'regular' || value === 'compact' ? value : undefined;
}

/** Stored bar layouts read back: those that are layouts and sit under their own `geometryKey`. */
export function sanitizeBarLayouts(raw: unknown): StoredBarLayouts {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};
  const layouts: Record<string, BarLayout> = {};
  for (const [key, value] of Object.entries(raw)) {
    const layout = sanitizeBarLayout(value);
    if (layout !== null && layoutGeometryKey(layout) === key) layouts[key] = layout;
  }
  return layouts;
}

/** The top of the reserved keyboard in window points, or null without one (the rail then ends with its region). */
export function reservedKeyboardTop(size: WindowSize, keyboardHeight: number | null): number | null {
  return keyboardHeight === null ? null : size.height - keyboardHeight;
}

/**
 * The rail in `room`: which buttons stay (`railSplit` at `railCapacity`), the fit of those actually
 * drawn, which can be more than the capacity when Back and More options are kept anyway, and their tops.
 */
export function railLayout<T>(
  room: RailRoom,
  buttons: readonly T[],
  pinned: number,
): { shown: number; rail: T[]; menu: T[]; fit: RailFit; tops: number[] } {
  const shown = railCapacity(room, buttons.length);
  const { rail, menu } = railSplit(buttons, shown, pinned);
  const fit = railFit(room, rail.length);
  return { shown, rail, menu, fit, tops: placeButtons(room, rail.length, fit).tops };
}

/**
 * Whose "More options" the rail's last button is: the screen's own, always in the rail (Sessions,
 * Terminal, Web Preview), or one the rail shows only when the screen's other buttons do not fit, holding
 * those that do not (owner overflow rule and D1, 2026-10-26; the stack screens, e.g. DocViewer).
 */
export type RailMoreMenu = 'always' | 'whenNeeded';

/**
 * `railLayout` for a rail whose last button is its "More options": a `whenNeeded` one is left out while
 * all the other buttons fit at the minimum, so it appears only when the side bar's span shrinks (the
 * status items moving), never because of the keyboard, whose height is reserved either way.
 */
export function railLayoutFor<T>(
  room: RailRoom,
  buttons: readonly T[],
  pinned: number,
  moreMenu: RailMoreMenu,
): { shown: number; rail: T[]; menu: T[]; fit: RailFit; tops: number[] } {
  if (moreMenu === 'whenNeeded') {
    const own = buttons.slice(0, -1);
    if (railCapacity(room, own.length) >= own.length) {
      const fit = railFit(room, own.length);
      return { shown: buttons.length, rail: own, menu: [], fit, tops: placeButtons(room, own.length, fit).tops };
    }
  }
  return railLayout(room, buttons, pinned);
}

/** Hit slop that keeps a `size`-pt button a 44-pt touch target. */
export function railHitSlop(size: number): number {
  return Math.max(0, Math.ceil((MIN_TOUCH - size) / 2));
}
