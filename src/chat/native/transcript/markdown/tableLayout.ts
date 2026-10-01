/**
 * Column widths for a chat table that fits its width, shared by the transcript's tables
 * (`Markdown.tsx`) and the larger table preview (`cards/TablePreview.tsx`).
 *
 * The rule is the GPUI chat's adaptive table layout (`render_scroll_table` in gpui-component's
 * text/node.rs; keep the two in step): a column whose longest cell is short stays on one line, a
 * longer one may narrow to its widest word or a quarter of its one-line width (at most 10 ems),
 * whichever is wider, kept between 6 and 12 ems, the room left is shared in
 * proportion to how much wider each column wants to be, and the table scrolls sideways only when
 * even those floors are wider than it.
 */

/** A column whose longest cell is at most this many ems wide stays on one line. */
const SHORT_COLUMN_EM = 8;
/** A wrapping column never narrows below this many ems... */
const WRAP_MIN_EM = 6;
/** ...nor keeps a longer word whole: a path or URL breaks rather than making the table scroll. */
const WORD_FLOOR_MAX_EM = 12;
/** A column of sentences keeps this share of its one-line width, so a table too wide to fit still reads a few words per line... */
const LONG_TEXT_FLOOR_SHARE = 0.25;
/** ...up to this many ems. */
const LONG_TEXT_FLOOR_MAX_EM = 10;

/** One column's text widths: `max` with every cell on one line, `min` its widest word. */
export type TableColumnExtent = { max: number; min: number };

/**
 * Each column's width, padding included (`inset`), for a table `available` wide. The widths add up
 * to `available` unless the floors alone are wider, which is when the table scrolls.
 */
export function fitTableColumns(columns: TableColumnExtent[], inset: number, available: number, em: number): number[] {
  const max = columns.map((column) => Math.ceil(column.max) + inset);
  const floor = columns.map((column, index) => {
    if (column.max <= SHORT_COLUMN_EM * em) return max[index]!;
    const text = Math.max(Math.ceil(column.min), Math.min(column.max * LONG_TEXT_FLOOR_SHARE, LONG_TEXT_FLOOR_MAX_EM * em));
    return Math.min(max[index]!, Math.min(Math.max(text, WRAP_MIN_EM * em), WORD_FLOOR_MAX_EM * em) + inset);
  });
  const extra = available - floor.reduce((sum, value) => sum + value, 0);
  if (extra <= 0) return floor;
  let want = max.map((width, index) => Math.max(0, width - floor[index]!));
  if (want.reduce((sum, value) => sum + value, 0) < 1) want = max;
  const wanted = want.reduce((sum, value) => sum + value, 0);
  return floor.map((width, index) => Math.floor(width + (extra * want[index]!) / wanted));
}
