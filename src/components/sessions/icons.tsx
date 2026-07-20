/**
 * Simple SVG glyphs for the sessions drawer header buttons and rows
 * (sessions-drawer.md §§1-2). Stroke-based line icons tinted via `color`.
 */

import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type GlyphProps = { size: number; color: string };

/** Circular-arrows refresh glyph. */
export function RefreshGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 20 12 a 8 8 0 1 1 -2.34 -5.66"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path d="M 20 3 v 4 h -4" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Laptop/workstation glyph for the Machines button. */
export function MachinesGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={4} y={5} width={16} height={11} rx={1.5} stroke={color} strokeWidth={2} />
      <Path d="M 2 19 h 20" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/** Gear glyph for the Settings button. */
export function SettingsGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={3.2} stroke={color} strokeWidth={2} />
      <Path
        d="M 12 2.8 v 3 M 12 18.2 v 3 M 21.2 12 h -3 M 5.8 12 h -3 M 18.5 5.5 l -2.1 2.1 M 7.6 16.4 l -2.1 2.1 M 18.5 18.5 l -2.1 -2.1 M 7.6 7.6 L 5.5 5.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Crescent-moon sleep glyph (SESSION row sleeping indicator). */
export function SleepGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 20 14.5 A 8.5 8.5 0 1 1 9.5 4 a 7 7 0 0 0 10.5 10.5 Z"
        fill={color}
      />
    </Svg>
  );
}

/** Plus glyph for the project create-session pill. */
export function PlusGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M 12 5 v 14 M 5 12 h 14" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/** Vertical-ellipsis glyph for overflow pills. */
export function MoreGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={5.5} r={1.8} fill={color} />
      <Circle cx={12} cy={12} r={1.8} fill={color} />
      <Circle cx={12} cy={18.5} r={1.8} fill={color} />
    </Svg>
  );
}
