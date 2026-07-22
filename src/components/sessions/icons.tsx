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

/** Filled caret-right (desktop IconCaretRightFilled); rotate 90° when open. */
export function CaretRightGlyph({ size, color, rotated }: GlyphProps & { rotated?: boolean }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={rotated === true ? { transform: [{ rotate: '90deg' }] } : undefined}
    >
      <Path d="M 9 6 l 8 6 -8 6 Z" fill={color} />
    </Svg>
  );
}

/** Closed folder outline (desktop IconFolder, collapsed project header). */
export function FolderGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 3 6.5 a 1.5 1.5 0 0 1 1.5 -1.5 H 9 l 2.4 2.5 h 8.1 A 1.5 1.5 0 0 1 21 9 v 8.5 a 1.5 1.5 0 0 1 -1.5 1.5 h -15 A 1.5 1.5 0 0 1 3 17.5 V 6.5 Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Open folder outline (desktop IconFolderOpen, expanded project header). */
export function FolderOpenGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 3 6.5 a 1.5 1.5 0 0 1 1.5 -1.5 H 9 l 2.4 2.5 h 7.1 A 1.5 1.5 0 0 1 20 9 v 1 H 6.2 a 1.6 1.6 0 0 0 -1.5 1.1 L 3 16.4 V 6.5 Z M 3.4 18.3 5.5 12 a 1 1 0 0 1 0.95 -0.7 H 21.3 a 0.8 0.8 0 0 1 0.76 1.05 l -1.9 5.7 A 1.5 1.5 0 0 1 18.7 19 H 4.4 a 1 1 0 0 1 -1 -0.7 Z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Chat bubble (desktop IconMessageCircle, Chats collection header). */
export function MessageCircleGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 12 4 c 4.97 0 9 3.36 9 7.5 S 16.97 19 12 19 c -1.1 0 -2.16 -0.16 -3.13 -0.46 L 4 20 l 1.32 -3.95 C 3.87 14.75 3 13.2 3 11.5 3 7.36 7.03 4 12 4 Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Chevron-down (Show more / expand affordances); rotate for up. */
export function ChevronDownGlyph({ size, color, rotated }: GlyphProps & { rotated?: boolean }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={rotated === true ? { transform: [{ rotate: '180deg' }] } : undefined}
    >
      <Path d="M 6 9 l 6 6 6 -6" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
