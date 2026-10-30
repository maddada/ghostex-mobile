/**
 * The Unified card's glyphs, drawn from the desktop's own Tabler files (apps/desktop/assets/titlebar/)
 * so the two cards show the same shapes.
 */

import Svg, { Path } from 'react-native-svg';

import type { GlyphProps } from '../icons';

type Shape = { d: string; fill?: boolean };

function TablerGlyph({ size, color, shapes, strokeWidth = 2 }: GlyphProps & { shapes: Shape[]; strokeWidth?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {shapes.map((shape, index) => (
        <Path
          key={index}
          d={shape.d}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
          fill={shape.fill === true ? color : 'none'}
        />
      ))}
    </Svg>
  );
}

/** pin-filled.svg: the pinned card's pin, as the desktop's Links list and account usage button draw a pinned thing. */
export function PinFilledGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill={color}
        d="M15.113 3.21l.094 .083l5.5 5.5a1 1 0 0 1 -1.175 1.59l-3.172 3.171l-1.424 3.797a1 1 0 0 1 -.158 .277l-.07 .08l-1.5 1.5a1 1 0 0 1 -1.32 .082l-.095 -.083l-2.793 -2.792l-3.793 3.792a1 1 0 0 1 -1.497 -1.32l.083 -.094l3.792 -3.793l-2.792 -2.793a1 1 0 0 1 -.083 -1.32l.083 -.094l1.5 -1.5a1 1 0 0 1 .258 -.187l.098 -.042l3.796 -1.425l3.171 -3.17a1 1 0 0 1 1.497 -1.26z"
      />
    </Svg>
  );
}

export function AlertTriangleGlyph(props: GlyphProps) {
  return (
    <TablerGlyph
      {...props}
      shapes={[
        { d: 'M12 9v4' },
        { d: 'M12 17h.01' },
        { d: 'M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' },
      ]}
    />
  );
}

export function HelpCircleGlyph(props: GlyphProps) {
  return (
    <TablerGlyph
      {...props}
      shapes={[
        { d: 'M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0' },
        { d: 'M12 16v.01' },
        { d: 'M12 13a2 2 0 0 0 .914 -3.782a1.98 1.98 0 0 0 -2.414 .483' },
      ]}
    />
  );
}

export function AlertCircleGlyph(props: GlyphProps) {
  return (
    <TablerGlyph
      {...props}
      shapes={[{ d: 'M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0' }, { d: 'M12 8v4' }, { d: 'M12 16h.01' }]}
    />
  );
}

export function CircleDashedGlyph(props: GlyphProps) {
  return (
    <TablerGlyph
      {...props}
      shapes={[
        { d: 'M8.56 3.69a9 9 0 0 0 -2.92 1.95' },
        { d: 'M3.69 8.56a9 9 0 0 0 -.69 3.44' },
        { d: 'M3.69 15.44a9 9 0 0 0 1.95 2.92' },
        { d: 'M8.56 20.31a9 9 0 0 0 3.44 .69' },
        { d: 'M15.44 20.31a9 9 0 0 0 2.92 -1.95' },
        { d: 'M20.31 15.44a9 9 0 0 0 .69 -3.44' },
        { d: 'M20.31 8.56a9 9 0 0 0 -1.95 -2.92' },
        { d: 'M15.44 3.69a9 9 0 0 0 -3.44 -.69' },
      ]}
    />
  );
}

export function StatusCircleDotGlyph(props: GlyphProps) {
  return (
    <TablerGlyph
      {...props}
      shapes={[
        { d: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0' },
        { d: 'M9.5 12a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0', fill: true },
      ]}
    />
  );
}

export function StatusCircleCheckGlyph(props: GlyphProps) {
  return (
    <TablerGlyph
      {...props}
      strokeWidth={1.8}
      shapes={[{ d: 'M3 12a9 9 0 1 0 18 0a9 9 0 1 0 -18 0' }, { d: 'M9 12l2 2l4 -4' }]}
    />
  );
}

export function FilterGlyph(props: GlyphProps) {
  return (
    <TablerGlyph
      {...props}
      strokeWidth={1.8}
      shapes={[
        {
          d: 'M4 4h16v2.172a2 2 0 0 1 -.586 1.414l-4.414 4.414v7l-6 2v-8.5l-4.48 -4.928a2 2 0 0 1 -.52 -1.345v-2.227',
        },
      ]}
    />
  );
}

export function AlarmGlyph(props: GlyphProps) {
  return (
    <TablerGlyph
      {...props}
      strokeWidth={1.8}
      shapes={[
        { d: 'M5 13a7 7 0 1 0 14 0a7 7 0 1 0 -14 0' },
        { d: 'M12 10l0 3l2 0' },
        { d: 'M7 4l-2.75 2' },
        { d: 'M17 4l2.75 2' },
      ]}
    />
  );
}

export function ArrowBackUpGlyph(props: GlyphProps) {
  return <TablerGlyph {...props} shapes={[{ d: 'M9 14l-4 -4l4 -4' }, { d: 'M5 10h11a4 4 0 1 1 0 8h-1' }]} />;
}

export function CheckGlyph(props: GlyphProps) {
  return <TablerGlyph {...props} shapes={[{ d: 'm5 12 4 4L19 6' }]} />;
}

export function FolderPlusGlyph(props: GlyphProps) {
  return (
    <TablerGlyph
      {...props}
      strokeWidth={1.8}
      shapes={[
        { d: 'M12 19h-7a2 2 0 0 1 -2 -2v-11a2 2 0 0 1 2 -2h4l3 3h7a2 2 0 0 1 2 2v3.5' },
        { d: 'M16 19h6' },
        { d: 'M19 16v6' },
      ]}
    />
  );
}

/** edit.svg: the header's New session button. */
export function EditGlyph(props: GlyphProps) {
  return (
    <TablerGlyph
      {...props}
      shapes={[
        { d: 'M7 7h-1a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2 -2v-1' },
        { d: 'M20.385 6.585a2.1 2.1 0 0 0 -2.97 -2.97l-8.415 8.385v3h3l8.385 -8.415' },
        { d: 'M16 5l3 3' },
      ]}
    />
  );
}

/** git-branch.svg: the card's branch line. */
export function BranchGlyph(props: GlyphProps) {
  return (
    <TablerGlyph
      {...props}
      shapes={[
        { d: 'M5 18a2 2 0 1 0 4 0a2 2 0 1 0 -4 0' },
        { d: 'M5 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0' },
        { d: 'M15 6a2 2 0 1 0 4 0a2 2 0 1 0 -4 0' },
        { d: 'M7 8l0 8' },
        { d: 'M9 18h6a2 2 0 0 0 2 -2v-5' },
        { d: 'M14 14l3 -3l3 3' },
      ]}
    />
  );
}
