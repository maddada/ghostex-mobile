/**
 * How the phone's machine tabs share the row (gx-core `sidebar_view/machine_tab_layout.rs` on the
 * desktop, which carries the decision). Tabs share the row while each gets a readable width; past
 * that they keep a readable width and scroll sideways, always showing part of the next tab. The
 * phone has no "this computer" to pin, so every machine scrolls; its "+" stays put.
 */

/** The narrowest a tab may get: its glyph, padding and about eight characters of label. */
export const MACHINE_TAB_MIN_WIDTH = 96;
/** How much of the next tab a scrolling row aims to show, in tab widths. */
export const MACHINE_TAB_PEEK = 0.4;
/** The least of it the row may show, so a row never ends flush on a tab and hides that it scrolls. */
const MACHINE_TAB_MIN_PEEK = 0.25;

export type MachineTabLayout = { kind: 'fit' } | { kind: 'scroll'; tabWidth: number };

export function machineTabLayout(count: number, rowWidth: number): MachineTabLayout {
  if (count <= 2 || rowWidth / count >= MACHINE_TAB_MIN_WIDTH) return { kind: 'fit' };
  const whole = Math.max(1, Math.floor(rowWidth / MACHINE_TAB_MIN_WIDTH - MACHINE_TAB_MIN_PEEK));
  return {
    kind: 'scroll',
    // The minimum wins over the aimed-for peek.
    tabWidth: Math.max(rowWidth / (whole + MACHINE_TAB_PEEK), Math.min(MACHINE_TAB_MIN_WIDTH, rowWidth)),
  };
}

/** The scroll offset that shows tab `index` with room for its neighbours, moving as little as it can. */
export function machineTabRevealOffset(
  index: number,
  count: number,
  tabWidth: number,
  viewport: number,
  offset: number,
): number {
  const room = Math.min(tabWidth * MACHINE_TAB_PEEK, Math.max(viewport - tabWidth, 0) / 2);
  const left = index * tabWidth;
  const right = left + tabWidth;
  let next = offset;
  if (left - room < next) next = left - room;
  if (right + room > next + viewport) next = right + room - viewport;
  return Math.min(Math.max(next, 0), Math.max(count * tabWidth - viewport, 0));
}

/**
 * Which tabs are scrolled out of view, as `[firstVisible, firstAfter]`: a tab whose middle is off
 * the row can't show its status dots, so the row's edge shows them for it.
 */
export function machineTabsOutOfView(
  count: number,
  tabWidth: number,
  viewport: number,
  offset: number,
): [number, number] {
  const middle = (index: number): number => (index + 0.5) * tabWidth;
  let first = 0;
  while (first < count && middle(first) < offset) first += 1;
  let after = first;
  while (after < count && middle(after) <= offset + viewport) after += 1;
  return [first, after];
}
