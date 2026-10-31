/**
 * A body text colour (`#rrggbb`) at Text strength `percent`: unchanged at 0, full white in dark mode
 * or full black in light mode at 100. Same mix as `strengthened_channels` in gx-chat-core
 * `transcript/text_strength.rs` (CDXC:SessionChat 2026-10-31 DECISION).
 */
export function strengthenedText(color: string, percent: number, light: boolean): string {
  if (percent <= 0) return color;
  const ink = light ? 0 : 255;
  const amount = Math.min(percent, 100) / 100;
  const channel = (start: number) => {
    const base = parseInt(color.slice(start, start + 2), 16);
    return Math.round(base + (ink - base) * amount)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}
