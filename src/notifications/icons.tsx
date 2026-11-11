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

/**
 * The desktop panel's glyphs (`apps/desktop/assets/titlebar/*.svg` in the Ghostex repo, Tabler outlines): a card's
 * kind icon when its session has no agent logo, the card's check, the header actions and the computer chip.
 */
const PANEL_GLYPH_PATHS = {
  messageCircle: [
    'M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1',
  ],
  helpCircle: ['M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0', 'M12 16v.01', 'M12 13a2 2 0 0 0 .914 -3.782a1.98 1.98 0 0 0 -2.414 .483'],
  bell: ['M10 5a2 2 0 1 1 4 0a7 7 0 0 1 4 6v3a4 4 0 0 0 2 3h-16a4 4 0 0 0 2 -3v-3a7 7 0 0 1 4 -6', 'M9 17v1a3 3 0 0 0 6 0v-1'],
  alertCircle: ['M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0', 'M12 8v4', 'M12 16h.01'],
  shieldCheck: ['M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06', 'M15 19l2 2l4 -4'],
  infoCircle: ['M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0', 'M12 9h.01', 'M11 12h1v4h1'],
  check: ['m5 12 4 4L19 6'],
  chevronRight: ['M9 6l6 6l-6 6'],
  xmark: ['M7 7l10 10', 'M17 7l-10 10'],
  deviceDesktop: [
    'M3 5a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1v-10',
    'M7 20h10',
    'M9 16v4',
    'M15 16v4',
  ],
} as const;

export type PanelGlyphName = keyof typeof PANEL_GLYPH_PATHS;

export function PanelGlyph({ name, size, color }: GlyphProps & { name: PanelGlyphName }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {PANEL_GLYPH_PATHS[name].map((d) => (
        <Path key={d} d={d} stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </Svg>
  );
}

/** The card's tile icon for a kind, when its session has no agent logo (`GpuiNotificationFeedKind::icon_path`). */
export function feedKindGlyph(kind: string): PanelGlyphName {
  switch (kind) {
    case 'finished':
      return 'messageCircle';
    case 'needsInput':
      return 'helpCircle';
    case 'bell':
      return 'bell';
    case 'failed':
      return 'alertCircle';
    case 'security':
      return 'shieldCheck';
    default:
      return 'infoCircle';
  }
}
