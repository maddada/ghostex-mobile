/**
 * The chat's tabs side by side (`TabSplit`): on a wide window (`splitWindow`) a tab dragged onto the right half of the
 * chat opens beside the selected one, each side with its own tab bar; at most two sides. The tab list keeps one order
 * for both: the left side's tabs, then the right side's (`splitOrder`), so merging the two bars back into one keeps
 * the order the user sees. The selected tab is the side the user is in (its keyboard, its menus); the other side
 * shows the tab it showed last (`leftShown`/`rightShown`). Kept in the terminal store beside the tabs, in memory as
 * the tabs are. A window too narrow for two sides shows one bar in that same order and keeps the split for when it
 * is wide again. Free of React Native.
 *
 * CDXC:Terminal 2026-11-12 DECISION:
 * User: hold a tab and drag it to reorder the tabs, on every phone; on wide windows (the unfolded foldable, a
 * tablet) drag it to the right half of the chat to show that session side by side with the current one, two at most;
 * each side has its own tab bar and a tab drags between them; a handle at the top merges the two back into one bar
 * with the order kept. Order and split live where the tabs do.
 */

import { SETTINGS_LIST_WIDTH, SETTINGS_PAGE_MIN_WIDTH } from '../components/common/verticalBar/layout';

/** The narrowest content a window splits at: the two-column breakpoint Settings already uses (`twoColumnWindow`). */
export const SPLIT_MIN_WIDTH = SETTINGS_LIST_WIDTH + SETTINGS_PAGE_MIN_WIDTH;

export type TabSide = 'left' | 'right';

export type TabSplit = {
  /** The tabs on the right side; every other tab is on the left. Their order is the tab list's. */
  readonly right: readonly string[];
  /** What each side shows while the selection is on the other side. */
  readonly leftShown: string;
  readonly rightShown: string;
};

export type SplitView = {
  readonly left: readonly string[];
  readonly right: readonly string[];
  readonly leftShown: string;
  readonly rightShown: string;
  /** The side of the selected tab. */
  readonly focus: TabSide;
};

/** Whether a window `width` wide, less its left and right insets, splits. */
export function splitWindow(width: number, insetLeft = 0, insetRight = 0): boolean {
  return width - insetLeft - insetRight >= SPLIT_MIN_WIDTH;
}

function sides(keys: readonly string[], split: TabSplit | null): { left: string[]; right: string[] } {
  if (split === null) return { left: [...keys], right: [] };
  const right = new Set(split.right);
  return { left: keys.filter((key) => !right.has(key)), right: keys.filter((key) => right.has(key)) };
}

/** The tabs in the order the user sees them: the left side's, then the right side's. */
export function splitOrder(keys: readonly string[], split: TabSplit | null): string[] {
  const { left, right } = sides(keys, split);
  return [...left, ...right];
}

/** Both sides and what each shows, or null while the tabs are on one side. */
export function splitView(keys: readonly string[], selected: string | null, split: TabSplit | null): SplitView | null {
  const { left, right } = sides(keys, split);
  if (split === null || left.length === 0 || right.length === 0) return null;
  const focus: TabSide = selected !== null && right.includes(selected) ? 'right' : 'left';
  const shown = (side: TabSide, list: string[], kept: string): string =>
    focus === side && selected !== null && list.includes(selected) ? selected : list.includes(kept) ? kept : list[0];
  return {
    left,
    right,
    leftShown: shown('left', left, split.leftShown),
    rightShown: shown('right', right, split.rightShown),
    focus,
  };
}

/**
 * The split as the tabs and the selection now have it: closed tabs leave it, a side left without tabs ends it, and the
 * selected tab is what its side shows. The same object while nothing changed.
 */
export function syncSplit(keys: readonly string[], selected: string | null, split: TabSplit | null): TabSplit | null {
  if (split === null) return null;
  const view = splitView(keys, selected, split);
  if (view === null) return null;
  const right = split.right.filter((key) => keys.includes(key));
  if (
    right.length === split.right.length &&
    view.leftShown === split.leftShown &&
    view.rightShown === split.rightShown
  ) {
    return split;
  }
  return { right, leftShown: view.leftShown, rightShown: view.rightShown };
}

/** Where a dragged tab is dropped: a place in one side's bar, or in the only bar (`single`). */
export type TabDrop = { readonly bar: TabSide | 'single'; readonly index: number };

export type TabsAndSplit = { readonly keys: string[]; readonly split: TabSplit | null };

/**
 * `key` dropped at `drop`: the tab list in its new order and the split after it. `index` counts the bar's tabs without
 * the dragged one. Into the other side's bar it changes sides and shows there; a side it leaves empty ends the split.
 * In the only bar while a split is kept (a narrow window), it changes sides when it lands among the other side's tabs.
 */
export function moveTab(keys: readonly string[], split: TabSplit | null, key: string, drop: TabDrop): TabsAndSplit {
  if (!keys.includes(key)) return { keys: [...keys], split };
  const { left, right } = sides(
    keys.filter((entry) => entry !== key),
    split,
  );
  const from: TabSide = split?.right.includes(key) === true ? 'right' : 'left';
  let to: TabSide;
  let index: number;
  if (drop.bar === 'single') {
    const at = Math.max(0, Math.min(drop.index, left.length + right.length));
    // At the seam between the sides the tab stays on its own side.
    to = at < left.length ? 'left' : at > left.length ? 'right' : from;
    index = to === 'left' ? at : at - left.length;
  } else {
    to = drop.bar;
    index = drop.index;
  }
  const list = to === 'left' ? left : right;
  list.splice(Math.max(0, Math.min(index, list.length)), 0, key);
  const order = [...left, ...right];
  if (split === null) return { keys: order, split: null };
  if (left.length === 0 || right.length === 0) return { keys: order, split: null };
  return {
    keys: order,
    split: {
      right,
      leftShown: to === 'left' && from !== to ? key : split.leftShown,
      rightShown: to === 'right' && from !== to ? key : split.rightShown,
    },
  };
}

/**
 * `key` opened on a new right side beside the rest (a drop on the chat's right half): it goes to the end of the order,
 * and the left side shows the selected tab, or the dragged tab's neighbour when it was the selected one.
 */
export function openSplit(keys: readonly string[], selected: string | null, key: string): TabsAndSplit | null {
  const index = keys.indexOf(key);
  if (index < 0 || keys.length < 2) return null;
  const left = keys.filter((entry) => entry !== key);
  const leftShown =
    selected !== null && selected !== key && left.includes(selected) ? selected : (left[index - 1] ?? left[0]);
  return { keys: [...left, key], split: { right: [key], leftShown, rightShown: key } };
}

/** The tab a side moves to when `key` closes on it: its neighbour on that side, else what the other side shows. */
export function splitSuccessor(keys: readonly string[], split: TabSplit | null, key: string): string | null {
  const view = splitView(keys, key, split);
  if (view === null) return null;
  const list = view.focus === 'left' ? view.left : view.right;
  const index = list.indexOf(key);
  return list[index + 1] ?? list[index - 1] ?? (view.focus === 'left' ? view.rightShown : view.leftShown);
}
