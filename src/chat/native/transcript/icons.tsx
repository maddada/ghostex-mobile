/**
 * The glyphs the transcript draws. Tabler paths copied from the files desktop names
 * (`apps/desktop/assets/titlebar/*.svg`) and from
 * `packages/gx-chat-core/visual/message-action-icons.json` (`chat-actions/*`).
 */

import { memo } from 'react';
import Svg, { Path } from 'react-native-svg';

const GLYPHS = {
  'chevron-right': ['M9 6l6 6l-6 6'],
  'chevron-down': ['M6 9l6 6l6-6'],
  'chevron-up': ['M6 15l6-6l6 6'],
  'arrow-up-right': ['M17 7l-10 10', 'M8 7l9 0l0 9'],
  'arrow-down-left': ['M17 7l-10 10', 'M16 17l-9 0l0 -9'],
  'arrow-back-up': ['M9 14l-4 -4l4 -4', 'M5 10h11a4 4 0 1 1 0 8h-1'],
  clock: ['M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0', 'M12 7v5l3 3'],
  'device-desktop': [
    'M3 5a1 1 0 0 1 1 -1h16a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-16a1 1 0 0 1 -1 -1v-10z',
    'M7 20h10',
    'M9 16v4',
    'M15 16v4',
  ],
  pencil: ['M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4', 'M13.5 6.5l4 4'],
  'file-text': [
    'M14 3v4a1 1 0 0 0 1 1h4',
    'M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2',
    'M9 9l1 0',
    'M9 13l6 0',
    'M9 17l6 0',
  ],
  'terminal-2': [
    'M8 9l3 3l-3 3',
    'M13 15l3 0',
    'M3 6a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2l0 -12',
  ],
  world: [
    'M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0',
    'M3.6 9h16.8',
    'M3.6 15h16.8',
    'M11.5 3a17 17 0 0 0 0 18',
    'M12.5 3a17 17 0 0 1 0 18',
  ],
  tool: ['M7 10h3v-3l-3.5 -3.5a6 6 0 0 1 8 8l6 6a2 2 0 0 1 -3 3l-6 -6a6 6 0 0 1 -8 -8l3.5 3.5'],
  file: ['M14 3v4a1 1 0 0 0 1 1h4', 'M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2'],
  'file-plus': [
    'M14 3v4a1 1 0 0 0 1 1h4',
    'M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z',
    'M12 11l0 6',
    'M9 14l6 0',
  ],
  'file-minus': [
    'M14 3v4a1 1 0 0 0 1 1h4',
    'M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z',
    'M9 14l6 0',
  ],
  download: ['M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2 -2v-2', 'M7 11l5 5l5 -5', 'M12 4l0 12'],
  'external-link': ['M12 6h-6a2 2 0 0 0 -2 2v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-6', 'M11 13l9 -9', 'M15 4h5v5'],
  'file-code': [
    'M14 3v4a1 1 0 0 0 1 1h4',
    'M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2',
    'M10 13l-1 2l1 2',
    'M14 13l1 2l-1 2',
  ],
  'file-type-html': [
    'M14 3v4a1 1 0 0 0 1 1h4',
    'M5 12v-7a2 2 0 0 1 2 -2h7l5 5v4',
    'M2 21v-6',
    'M5 15v6',
    'M2 18h3',
    'M20 15v6h2',
    'M13 21v-6l2 3l2 -3v6',
    'M7.5 15h3',
    'M9 15v6',
  ],
  markdown: [
    'M3 7a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-10',
    'M7 15v-6l2 2l2 -2v6',
    'M14 13l2 2l2 -2m-2 2v-6',
  ],
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z'],
  /** A Changes view review comment pill (`comment` in reference-visual.json). */
  comment: ['M8 9h8', 'M8 13h6', 'M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-5l-5 3v-3H6a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3z'],
  skill: ['m12 3-1.9 5.1L5 10l5.1 1.9L12 18l1.9-5.1L19 11l-5.1-1.9z', 'M5 3v4', 'M3 5h4', 'M19 17v4', 'M17 19h4'],
  link: [
    'M9 15l6 -6',
    'M11 6l.463 -.536a5 5 0 0 1 7.071 7.072l-.534 .464',
    'M13 18l-.397 .534a5.068 5.068 0 0 1 -7.127 0a4.972 4.972 0 0 1 0 -7.071l.524 -.463',
  ],
  check: ['m5 12 4 4L19 6'],
  // The chat look's quiet steps (`titlebar/loader2.svg`, `circle-dashed.svg`).
  'loader-2': ['M12 3a9 9 0 1 0 9 9'],
  'circle-dashed': [
    'M8.56 3.69a9 9 0 0 0 -2.92 1.95',
    'M3.69 8.56a9 9 0 0 0 -.69 3.44',
    'M3.69 15.44a9 9 0 0 0 1.95 2.92',
    'M8.56 20.31a9 9 0 0 0 3.44 .69',
    'M15.44 20.31a9 9 0 0 0 2.92 -1.95',
    'M20.31 15.44a9 9 0 0 0 .69 -3.44',
    'M20.31 8.56a9 9 0 0 0 -1.95 -2.92',
    'M15.44 3.69a9 9 0 0 0 -3.44 -.69',
  ],
  'adjustments-horizontal': [
    'M12 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
    'M4 6l8 0',
    'M16 6l4 0',
    'M6 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
    'M4 12l2 0',
    'M10 12l10 0',
    'M15 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
    'M4 18l11 0',
    'M19 18l1 0',
  ],
  'question-mark': ['M8.5 8.5a3.5 3.5 0 1 1 4.9 3.2c-.8 .4 -1.4 1.1 -1.4 2v.3', 'M12 18.5v.01'],
  'help-circle': [
    'M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0',
    'M12 16v.01',
    'M12 13a2 2 0 0 0 .914 -3.782a1.98 1.98 0 0 0 -2.414 .483',
  ],
  'alert-triangle': [
    'M12 9v4',
    'M12 17h.01',
    'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
  ],
  'info-circle': ['M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0', 'M12 9h.01', 'M11 12h1v4h1'],
  'git-branch': [
    'M5 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
    'M5 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
    'M15 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
    'M7 8l0 8',
    'M9 18h6a2 2 0 0 0 2 -2v-5',
    'M14 14l3 -3l3 3',
  ],
  sitemap: [
    'M3 17a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2l0 -2',
    'M15 17a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2l0 -2',
    'M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2l0 -2',
    'M6 15v-1a2 2 0 0 1 2 -2h8a2 2 0 0 1 2 2v1',
    'M12 9l0 3',
  ],
  sparkles: [
    'M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2m-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6',
  ],
  brain: [
    'M15.5 13a3.5 3.5 0 0 0 -3.5 3.5v1a3.5 3.5 0 0 0 7 0v-1.8',
    'M8.5 13a3.5 3.5 0 0 1 3.5 3.5v1a3.5 3.5 0 0 1 -7 0v-1.8',
    'M17.5 16a3.5 3.5 0 0 0 0 -7h-.5',
    'M19 9.3v-2.8a3.5 3.5 0 0 0 -7 0',
    'M6.5 16a3.5 3.5 0 0 1 0 -7h.5',
    'M5 9.3v-2.8a3.5 3.5 0 0 1 7 0v10',
  ],
  bulb: [
    'M3 12h1m8 -9v1m8 8h1m-15.4 -6.4l.7 .7m12.1 -.7l-.7 .7',
    'M9 16a5 5 0 1 1 6 0a3.5 3.5 0 0 0 -1 3a2 2 0 0 1 -4 0a3.5 3.5 0 0 0 -1 -3',
    'M9.7 17l4.6 0',
  ],
  messages: [
    'M21 14l-3 -3h-7a1 1 0 0 1 -1 -1v-6a1 1 0 0 1 1 -1h9a1 1 0 0 1 1 1v10',
    'M14 15v2a1 1 0 0 1 -1 1h-7l-3 3v-10a1 1 0 0 1 1 -1h2',
  ],
  // Desktop `chat-card-question.svg` (the answer cards' tile) on this 24pt grid.
  'message-question': [
    'M4.5 5.25h15a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1 -1.5 1.5h-9l-4.5 3.75v-3.75h-1.5a1.5 1.5 0 0 1 -1.5 -1.5v-9a1.5 1.5 0 0 1 1.5 -1.5z',
    'M9.9 9.3a2.25 2.25 0 1 1 3.15 2.1c-.75 .3 -1.05 .75 -1.05 1.5',
    'M12 15v.01',
  ],
  'message-report': [
    'M18 4a3 3 0 0 1 3 3v8a3 3 0 0 1 -3 3h-5l-5 3v-3h-2a3 3 0 0 1 -3 -3v-8a3 3 0 0 1 3 -3h12',
    'M12 8v3',
    'M12 14v.01',
  ],
  'alert-octagon': [
    'M12.802 2.165l5.575 2.389c.48 .206 .863 .589 1.07 1.07l2.388 5.574c.22 .512 .22 1.092 0 1.604l-2.389 5.575c-.206 .48 -.589 .863 -1.07 1.07l-5.574 2.388c-.512 .22 -1.092 .22 -1.604 0l-5.575 -2.389a2.036 2.036 0 0 1 -1.07 -1.07l-2.388 -5.574a2.036 2.036 0 0 1 0 -1.604l2.389 -5.575c.206 -.48 .589 -.863 1.07 -1.07l5.574 -2.388a2.036 2.036 0 0 1 1.604 0',
    'M12 8v4',
    'M12 16h.01',
  ],
  'focus-2': ['M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2'],
  search: ['M3 10a7 7 0 1 0 14 0a7 7 0 1 0 -14 0', 'M21 21l-6 -6'],
  x: ['M18 6l-12 12', 'M6 6l12 12'],
  'arrow-up': ['M12 5l0 14', 'M18 11l-6 -6', 'M6 11l6 -6'],
  'arrow-down': ['M12 5l0 14', 'M18 13l-6 6', 'M6 13l6 6'],
  table: ['M3 5a2 2 0 0 1 2 -2h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14', 'M3 10h18', 'M10 3v18'],
  'chart-bar': [
    'M3 13a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v6a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z',
    'M15 9a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v10a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z',
    'M9 5a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v14a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z',
    'M4 20h14',
  ],
  copy: [
    'M7 9.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667l0 -8.666',
    'M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1',
  ],
  save: ['M14 3v4a1 1 0 0 0 1 1h4', 'M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2'],
  rewind: ['M9 14l-4 -4l4 -4', 'M5 10h11a4 4 0 1 1 0 8h-1'],
  savePrompt: ['M6 10l-2 1l8 4l8 -4l-2 -1', 'M4 15l8 4l8 -4', 'M12 4v7', 'M15 8l-3 3l-3 -3'],
  saved: ['M5 12l5 5l10 -10'],
  trash: [
    'M4 7l16 0',
    'M10 11l0 6',
    'M14 11l0 6',
    'M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12',
    'M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3',
  ],
  'player-play': ['M7 4v16l13 -8l-13 -8'],
  'photo-off': [
    'M15 8h.01',
    'M7 3h11a3 3 0 0 1 3 3v11m-.856 3.099a2.991 2.991 0 0 1 -2.144 .901h-12a3 3 0 0 1 -3 -3v-12c0 -.845 .349 -1.608 .91 -2.153',
    'M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5',
    'M16.33 12.338c.574 -.054 1.155 .166 1.67 .662l3 3',
    'M3 3l18 18',
  ],
  photo: [
    'M15 8h.01',
    'M3 6a3 3 0 0 1 3 -3h12a3 3 0 0 1 3 3v12a3 3 0 0 1 -3 3h-12a3 3 0 0 1 -3 -3v-12z',
    'M3 16l5 -5c.928 -.893 2.072 -.893 3 0l5 5',
    'M14 14l1 -1c.928 -.893 2.072 -.893 3 0l3 3',
  ],
  'text-wrap': ['M4 6l16 0', 'M4 18l5 0', 'M4 12h13a3 3 0 0 1 0 6h-4l2 -2m0 4l-2 -2'],
  'arrows-diagonal': ['M16 4l4 0l0 4', 'M14 10l6 -6', 'M8 20l-4 0l0 -4', 'M4 20l6 -6'],
  'arrows-diagonal-minimize': ['m4 4 6 6M4 10h6V4M20 20l-6-6M20 14h-6v6M20 4l-6 6M14 4v6h6M4 20l6-6M10 20v-6H4'],
  maximize: [
    'M4 8v-2a2 2 0 0 1 2 -2h2',
    'M4 16v2a2 2 0 0 0 2 2h2',
    'M16 4h2a2 2 0 0 1 2 2v2',
    'M16 20h2a2 2 0 0 0 2 -2v-2',
  ],
} as const;

export type GlyphName = keyof typeof GLYPHS;

export const Glyph = memo(function Glyph({
  name,
  size,
  color,
  strokeWidth = 1.9,
}: {
  name: GlyphName;
  size: number;
  color: string;
  strokeWidth?: number;
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {GLYPHS[name].map((d) => (
        <Path key={d} d={d} />
      ))}
    </Svg>
  );
});

/** The glyph a tool row draws for each `glyph` the core classifies a tool into (`tool_run.rs`). */
export function toolGlyph(glyph: string): GlyphName {
  switch (glyph) {
    case 'edit':
      return 'pencil';
    case 'file':
      return 'file-text';
    case 'terminal':
      return 'terminal-2';
    case 'web':
      return 'world';
    default:
      return 'tool';
  }
}
