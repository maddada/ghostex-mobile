/**
 * Keyboard geometry of the iOS terminal (docs/specs/terminal-screen.md §2 "Keyboard: the terminal slides").
 * The terminal view keeps its size while the software keyboard comes and goes, so its grid (columns x
 * rows) and the pty behind it stay as they are; the view slides up instead, by as much as the cursor row
 * puts the bottom row above the key bar (above the keyboard, with the key bar off), or less when that would push the cursor row out at the top. All lengths are
 * points, in the terminal view's own coordinates (y grows downwards from its top edge) unless named
 * otherwise.
 */

/**
 * How much of the terminal view's bottom is covered while the keyboard (`keyboardOverlap`: from the
 * window's bottom edge up) and the key bar on top of it (`keyBarHeight`, 0 while it is off) are shown.
 * The view ends `bottomInset` above the window's bottom edge (the home indicator's margin), so that much
 * of the cover is not over the view.
 */
export function terminalObstruction(keyboardOverlap: number, keyBarHeight: number, bottomInset: number): number {
  return Math.max(0, keyboardOverlap + keyBarHeight - bottomInset);
}

/**
 * How far the terminal view moves up with the keyboard (owner decision 2026-10-28T19:54:22Z, "Unterkante
 * sichtbar, Cursor gewinnt"): as far as the bottom row stands directly above the covered part (`obstruction`),
 * so what the program draws below the cursor stays visible, but never so far that the cursor row's top edge
 * (`caretTop`) would leave the top of the visible part; then the cursor row stands at that top edge.
 * `caretTop` is null while the terminal has not reported one: the bottom is visible then, no known cursor
 * can be lost. 0 while the view is not laid out yet (`viewHeight` 0) and while nothing is covered.
 */
export function terminalSlideOffset(caretTop: number | null, viewHeight: number, obstruction: number): number {
  if (viewHeight <= 0) return 0;
  const covered = Math.max(obstruction, 0);
  if (caretTop === null) return covered;
  return Math.min(Math.max(caretTop, 0), covered);
}
