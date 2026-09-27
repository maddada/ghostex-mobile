/**
 * The Tabler glyphs the chat cards draw, copied from the desktop's `apps/desktop/assets/titlebar/`
 * SVGs (the same files the GPUI cards name, e.g. `titlebar/help-circle.svg`).
 */

import Svg, { Path } from 'react-native-svg';

type GlyphSpec = { paths: string[]; strokeWidth?: number; filled?: boolean };

const GLYPHS = {
  'help-circle': { paths: ['M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0', 'M12 16v.01', 'M12 13a2 2 0 0 0 .914 -3.782a1.98 1.98 0 0 0 -2.414 .483'] },
  'chevron-right': { paths: ['M9 6l6 6l-6 6'] },
  'chevron-down': { paths: ['M6 9l6 6l6-6'] },
  'chevron-left': { paths: ['M15 6l-6 6l6 6'] },
  'chevron-up': { paths: ['M6 15l6-6l6 6'] },
  'message-circle': { paths: ['M3 20l1.3 -3.9c-2.324 -3.437 -1.426 -7.872 2.1 -10.374c3.526 -2.501 8.59 -2.296 11.845 .48c3.255 2.777 3.695 7.266 1.029 10.501c-2.666 3.235 -7.615 4.215 -11.574 2.293l-4.7 1'] },
  'git-fork': {
    paths: [
      'M10 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
      'M5 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
      'M15 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
      'M7 8v2a2 2 0 0 0 2 2h6a2 2 0 0 0 2 -2v-2',
      'M12 12l0 4',
    ],
    strokeWidth: 1.8,
  },
  check: { paths: ['M5 12l4 4L19 6'] },
  x: { paths: ['M18 6l-12 12', 'M6 6l12 12'], strokeWidth: 1.8 },
  'shield-check': { paths: ['M11.46 20.846a12 12 0 0 1 -7.96 -14.846a12 12 0 0 0 8.5 -3a12 12 0 0 0 8.5 3a12 12 0 0 1 -.09 7.06', 'M15 19l2 2l4 -4'] },
  'alert-circle': { paths: ['M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0', 'M12 8v4', 'M12 16h.01'], strokeWidth: 1.8 },
  'alert-triangle': { paths: ['M12 9v4', 'M12 17h.01', 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z'] },
  'info-circle': { paths: ['M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0', 'M12 9h.01', 'M11 12h1v4h1'] },
  'terminal-2': { paths: ['M8 9l3 3l-3 3', 'M13 15l3 0', 'M3 6a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -12'] },
  users: { paths: ['M5 7a4 4 0 1 0 8 0a4 4 0 1 0 -8 0', 'M3 21v-2a4 4 0 0 1 4 -4h4a4 4 0 0 1 4 4v2', 'M16 3.13a4 4 0 0 1 0 7.75', 'M21 21v-2a4 4 0 0 0 -3 -3.85'], strokeWidth: 1.8 },
  'list-check': { paths: ['M3.5 5.5l1.5 1.5l2.5 -2.5', 'M3.5 11.5l1.5 1.5l2.5 -2.5', 'M3.5 17.5l1.5 1.5l2.5 -2.5', 'M11 6l9 0', 'M11 12l9 0', 'M11 18l9 0'] },
  loader: { paths: ['M12 3a9 9 0 1 0 9 9'], strokeWidth: 1.8 },
  'circle-check-filled': {
    paths: [
      'M17 3.34a10 10 0 1 1 -14.995 8.984l-.005 -.324l.005 -.324a10 10 0 0 1 14.995 -8.336zm-1.293 5.953a1 1 0 0 0 -1.32 -.083l-.094 .083l-3.293 3.292l-1.293 -1.292l-.094 -.083a1 1 0 0 0 -1.403 1.403l.083 .094l2 2l.094 .083a1 1 0 0 0 1.226 0l.094 -.083l4 -4l.083 -.094a1 1 0 0 0 -.083 -1.32z',
    ],
    filled: true,
  },
  message: { paths: ['M8 9h8', 'M8 13h5', 'M5 19l2.5 -2h9.5a3 3 0 0 0 3 -3v-6a3 3 0 0 0 -3 -3h-10a3 3 0 0 0 -3 3v10.5z'] },
  'switch-horizontal': { paths: ['M16 3l4 4l-4 4', 'M10 7l10 0', 'M8 13l-4 4l4 4', 'M4 17l9 0'] },
  refresh: { paths: ['M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4', 'M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4'] },
  copy: {
    paths: [
      'M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666',
      'M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1',
    ],
  },
  robot: {
    paths: ['M6 6a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v4a2 2 0 0 1 -2 2h-8a2 2 0 0 1 -2 -2l0 -4', 'M12 2v2', 'M9 12v9', 'M15 12v9', 'M5 16l4 -2', 'M15 14l4 2', 'M9 18h6', 'M10 8v.01', 'M14 8v.01'],
  },
  photo: { paths: ['M15 8h.01', 'M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12', 'M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5', 'M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3'] },
} satisfies Record<string, GlyphSpec>;

export type GlyphName = keyof typeof GLYPHS;

export function Glyph({ name, size, color, strokeWidth }: { name: GlyphName; size: number; color: string; strokeWidth?: number }) {
  const spec: GlyphSpec = GLYPHS[name];
  const width = strokeWidth ?? spec.strokeWidth ?? 2;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {spec.paths.map((d) =>
        spec.filled ? (
          <Path key={d} d={d} fill={color} />
        ) : (
          <Path key={d} d={d} stroke={color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" fill="none" />
        )
      )}
    </Svg>
  );
}

/** The working strip's spark (`sparkPath` in packages/gx-chat-core/visual/working-strip.json). */
export const SPARK_PATH =
  'M12 0.8c.5 4.6 1.8 7.4 3.6 9.1 1.6 1.6 4.2 2.5 7.6 2.1-3.4-.4-6 .5-7.6 2.1-1.8 1.7-3.1 4.5-3.6 9.1-.5-4.6-1.8-7.4-3.6-9.1C6.8 12.5 4.2 11.6.8 12c3.4.4 6-.5 7.6-2.1C10.2 8.2 11.5 5.4 12 .8z';

export function Spark({ size, color }: { size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path d={SPARK_PATH} fill={color} />
    </Svg>
  );
}
