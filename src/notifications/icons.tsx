/**
 * Line glyphs of the attention list and the bell (the notifications design: bell, the state glyphs, blocked and
 * offline), drawn like the sessions drawer's glyphs (`components/sessions/icons.tsx`): 24-unit view box, 2-unit
 * strokes, tinted through `color`.
 */

import Svg, { Circle, Path } from 'react-native-svg';

import type { GlyphProps } from '../components/sessions/icons';
import type { ListKind } from './attentionRows';

export function BellGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 6 16 V 11 a 6 6 0 0 1 12 0 v 5 l 1.5 2 h -15 Z M 10 20.5 a 2 2 0 0 0 4 0"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function BellOffGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 8.5 6 A 6 6 0 0 1 18 11 v 4 M 6 9.5 V 16 l -1.5 2 H 18 M 10 20.5 a 2 2 0 0 0 4 0 M 3 3 l 18 18"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function CloudOffGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 7 18 a 4.5 4.5 0 0 1 -0.6 -8.96 A 6 6 0 0 1 17.6 9.4 A 4.3 4.3 0 0 1 17.5 18 Z M 3 3 l 18 18"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function CheckCircleGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2} />
      <Path
        d="M 8.5 12 l 2.5 2.5 l 4.5 -5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function ClockGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2} />
      <Path d="M 12 7 v 5 l 3 3" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

function QuestionGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2} />
      <Path
        d="M 9.5 9.5 a 2.5 2.5 0 1 1 3.5 2.3 c -0.6 0.3 -1 0.8 -1 1.5 v 0.4"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Circle cx={12} cy={16.6} r={1.1} fill={color} />
    </Svg>
  );
}

function AlertGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 12 4 L 21 19.5 H 3 Z M 12 10 v 4"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={16.8} r={1.1} fill={color} />
    </Svg>
  );
}

function LockGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 6 11 h 12 v 9 H 6 Z M 8.5 11 V 8 a 3.5 3.5 0 0 1 7 0 v 3"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

function StopGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2} />
      <Path d="M 9.5 9.5 h 5 v 5 h -5 Z" stroke={color} strokeWidth={2} strokeLinejoin="round" />
    </Svg>
  );
}

/** The glyph beside a row's state word; word and glyph both carry the meaning, never the colour alone. */
export function KindGlyph({ kind, size, color }: GlyphProps & { kind: ListKind | 'ended' }) {
  switch (kind) {
    case 'finished':
      return <CheckCircleGlyph size={size} color={color} />;
    case 'waiting':
      return <ClockGlyph size={size} color={color} />;
    case 'question':
      return <QuestionGlyph size={size} color={color} />;
    case 'approval':
      return <LockGlyph size={size} color={color} />;
    case 'ended':
      return <StopGlyph size={size} color={color} />;
    default:
      return <AlertGlyph size={size} color={color} />;
  }
}
