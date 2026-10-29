/**
 * How the Terminal's tab strip sizes its tabs and when it fades its edges (kept free of React Native so
 * `bun test` reaches it).
 *
 * CDXC:Terminal 2026-10-29 DECISION:
 * User, asked "terminal tabs get wider with the next one peeking in, and only the active tab has a close
 * button. On every phone?" (Q762): "Every phone". Where the strip cannot show every tab, the next tab always
 * peeks in and only the active tab shows its close button, on Android and every iPhone. WHY the peek: in the
 * iPhone Duo's narrow status band (which keeps the chat button) a strip of whole tabs gave no sign that it
 * swipes; a quarter of the next tab does, and a peeking tab shows its title rather than a lone close button.
 */

export const TRACK_INNER_PAD = 4;
export const TAB_SPACING = 4;
/** Equal-width tabs while each would be at least this wide; scrolling tabs are about this wide. */
export const MIN_TAB_WIDTH = 120;
/** The narrowest a scrolling tab gets: its title still reads (with an ellipsis), beside the close button. */
export const TAB_READABLE_WIDTH = 80;
/** How much of the next tab shows at the strip's edge, as a fraction of a tab: the cue that the strip swipes. */
export const TAB_PEEK_FRACTION = 0.25;

export type TabStripLayout = { readonly equal: true } | { readonly equal: false; readonly tabWidth: number };

/**
 * Equal-width tabs filling the track while every tab gets at least `MIN_TAB_WIDTH` (wide strips, one tab,
 * and before the track is measured); otherwise a scrolling strip whose tab width leaves `TAB_PEEK_FRACTION`
 * of the next tab showing after the last whole one, no narrower than `TAB_READABLE_WIDTH`.
 */
export function tabStripLayout(trackWidth: number, count: number): TabStripLayout {
  if (trackWidth === 0 || count <= 1) return { equal: true };
  const visible = trackWidth - TRACK_INNER_PAD * 2;
  if ((visible - TAB_SPACING * (count - 1)) / count >= MIN_TAB_WIDTH) return { equal: true };
  // As many whole tabs as still leave the peek at tabs no narrower than the old minimum; at least one.
  const whole = Math.max(1, Math.floor((visible - TAB_PEEK_FRACTION * MIN_TAB_WIDTH) / (MIN_TAB_WIDTH + TAB_SPACING)));
  const tabWidth = (visible - whole * TAB_SPACING) / (whole + TAB_PEEK_FRACTION);
  return { equal: false, tabWidth: Math.max(TAB_READABLE_WIDTH, tabWidth) };
}

/**
 * Where a scrolling strip rests with tab `index` (0-based) active: that tab at the strip's start, so the
 * tab after it peeks in by the quarter (or more) the widths leave (centring would show only part of that
 * peek, which hid that the strip swipes), clamped to the content: the last tab rests at the end, where the
 * previous tab peeks in instead. `tabWidth` is the scrolling tabs' width (`tabStripLayout`).
 */
export function stripScrollOffset(index: number, count: number, tabWidth: number, trackWidth: number): number {
  const content = TRACK_INNER_PAD * 2 + count * tabWidth + (count - 1) * TAB_SPACING;
  const end = Math.max(0, content - trackWidth);
  return Math.min(end, Math.max(0, index * (tabWidth + TAB_SPACING)));
}

/** Which edges of the strip hide more tabs (and so fade): left once scrolled, right while more follow. */
export function stripFades(
  offset: number,
  contentWidth: number,
  trackWidth: number,
): { left: boolean; right: boolean } {
  return { left: offset > 1, right: offset + trackWidth < contentWidth - 1 };
}

/** The track's own tint over the header (the capsule around the tabs): white at this opacity. */
export const TRACK_TINT_ALPHA = 0.08;

/** `#rgb`, `#rrggbb`, `rgb(r,g,b)` or `rgba(r,g,b,a)` as 0-255 channels, or null for anything else. */
function parseColor(color: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (hex !== null) {
    const digits = hex[1].length === 3 ? [...hex[1]].map((digit) => digit + digit).join('') : hex[1];
    return [0, 2, 4].map((at) => parseInt(digits.slice(at, at + 2), 16)) as [number, number, number];
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color.trim());
  return rgb === null ? null : [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
}

/**
 * The colour of a tab strip's edge fade for a header of colour `header`: the track is a translucent white
 * over the header, so the fade is that blended colour (what the track looks like there), opaque as the
 * shared `HorizontalFade` needs (the chat's pill rows fade the same way, from the card's own fill). A colour
 * that cannot be read falls back to the header colour itself.
 */
export function stripFadeColor(header: string): string {
  const base = parseColor(header);
  if (base === null) return header;
  const [r, g, b] = base.map((channel) => Math.round(channel + (255 - channel) * TRACK_TINT_ALPHA));
  return `rgb(${r},${g},${b})`;
}
