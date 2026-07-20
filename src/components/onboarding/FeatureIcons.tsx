/**
 * SF-symbol-free feature glyphs for the welcome screen (onboarding.md §1),
 * drawn with react-native-svg strokes so no icon font is needed.
 */

import Svg, { Circle, Line, Path, Polyline, Rect } from 'react-native-svg';

export type GlyphProps = {
  color: string;
  size?: number;
};

/** `terminal.fill` stand-in: rounded frame, prompt chevron, cursor line. */
export function TerminalGlyph({ color, size = 22 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={2.5} y={4} width={19} height={16} rx={3} stroke={color} strokeWidth={2} />
      <Polyline
        points="6.5,9.5 10,12.5 6.5,15.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Line x1={12.5} y1={15.5} x2={17.5} y2={15.5} stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/** `clock.arrow.circlepath` stand-in: circular arrow with clock hands. */
export function PersistenceGlyph({ color, size = 22 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Polyline
        points="22.5,4.5 22.5,10 17,10"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Path
        d="M20.49 15a9 9 0 1 1-2.12-9.36L22.5 10"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <Line x1={12} y1={8} x2={12} y2={12.5} stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Line x1={12} y1={12.5} x2={15} y2={14} stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/** `key.fill` stand-in: key bow, shaft, and teeth. */
export function KeyGlyph({ color, size = 22 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={7} cy={12} r={3.5} stroke={color} strokeWidth={2} />
      <Line x1={10.5} y1={12} x2={21} y2={12} stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Line x1={17} y1={12} x2={17} y2={15.5} stroke={color} strokeWidth={2} strokeLinecap="round" />
      <Line x1={20.5} y1={12} x2={20.5} y2={15} stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/** Ghostex Sessions glyph: a 2x2 grid of session panes. */
export function SessionsGlyph({ color, size = 22 }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={3} width={7.5} height={7.5} rx={2} stroke={color} strokeWidth={2} />
      <Rect x={13.5} y={3} width={7.5} height={7.5} rx={2} stroke={color} strokeWidth={2} />
      <Rect x={3} y={13.5} width={7.5} height={7.5} rx={2} stroke={color} strokeWidth={2} />
      <Rect x={13.5} y={13.5} width={7.5} height={7.5} rx={2} stroke={color} strokeWidth={2} />
    </Svg>
  );
}
