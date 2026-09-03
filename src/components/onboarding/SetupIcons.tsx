/**
 * Stroke glyphs for the setup flow (Welcome, Choose, Scan, Connected), drawn
 * with react-native-svg from the Tabler outlines the mockup's shared.js uses
 * (terminal, sparkles, folders, qrcode, shield, camera, paste, help-circle,
 * check, alert-triangle, loader, info, lock), so no icon font is needed.
 */

import Svg, { Circle, Path } from 'react-native-svg';

export type SetupGlyphProps = {
  color: string;
  size?: number;
  strokeWidth?: number;
};

function Glyph({
  color,
  size = 20,
  strokeWidth = 1.9,
  children,
}: SetupGlyphProps & { children: React.ReactNode }) {
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
      {children}
    </Svg>
  );
}

export function TerminalGlyph(props: SetupGlyphProps) {
  return (
    <Glyph {...props}>
      <Path d="M5 7l5 5l-5 5" />
      <Path d="M12 19l7 0" />
    </Glyph>
  );
}

export function SparklesGlyph(props: SetupGlyphProps) {
  return (
    <Glyph {...props}>
      <Path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6z" />
    </Glyph>
  );
}

export function FoldersGlyph(props: SetupGlyphProps) {
  return (
    <Glyph {...props}>
      <Path d="M9 4h3l2 2h5a2 2 0 0 1 2 2v7a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2" />
      <Path d="M17 17v2a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2h2" />
    </Glyph>
  );
}

export function QrcodeGlyph(props: SetupGlyphProps) {
  return (
    <Glyph {...props}>
      <Path d="M4 4m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" />
      <Path d="M7 17l0 .01" />
      <Path d="M14 4m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" />
      <Path d="M7 7l0 .01" />
      <Path d="M4 14m0 1a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v4a1 1 0 0 1 -1 1h-4a1 1 0 0 1 -1 -1z" />
      <Path d="M17 7l0 .01" />
      <Path d="M14 14l3 0" />
      <Path d="M20 14l0 .01" />
      <Path d="M14 14l0 3" />
      <Path d="M14 20l3 0" />
      <Path d="M17 17l3 0" />
      <Path d="M20 17l0 3" />
    </Glyph>
  );
}

export function ShieldGlyph(props: SetupGlyphProps) {
  return (
    <Glyph {...props}>
      <Path d="M12 3a12 12 0 0 0 8.5 3a12 12 0 0 1 -8.5 15a12 12 0 0 1 -8.5 -15a12 12 0 0 0 8.5 -3" />
    </Glyph>
  );
}

export function CameraGlyph(props: SetupGlyphProps) {
  return (
    <Glyph {...props}>
      <Path d="M5 7h1a2 2 0 0 0 2 -2a1 1 0 0 1 1 -1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-9a2 2 0 0 1 2 -2" />
      <Path d="M9 13a3 3 0 1 0 6 0a3 3 0 0 0 -6 0" />
    </Glyph>
  );
}

export function PasteGlyph(props: SetupGlyphProps) {
  return (
    <Glyph {...props}>
      <Path d="M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2" />
      <Path d="M9 3m0 2a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v0a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2z" />
    </Glyph>
  );
}

export function HelpCircleGlyph(props: SetupGlyphProps) {
  return (
    <Glyph {...props}>
      <Path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" />
      <Path d="M12 16v.01" />
      <Path d="M12 13a2 2 0 0 0 .914 -3.782a1.98 1.98 0 0 0 -2.414 .483" />
    </Glyph>
  );
}

export function CheckGlyph(props: SetupGlyphProps) {
  return (
    <Glyph {...props}>
      <Path d="M5 12l5 5l10 -10" />
    </Glyph>
  );
}

export function AlertTriangleGlyph(props: SetupGlyphProps) {
  return (
    <Glyph {...props}>
      <Path d="M12 9v4" />
      <Path d="M10.363 3.591l-8.106 13.534a1.914 1.914 0 0 0 1.636 2.871h16.214a1.914 1.914 0 0 0 1.636 -2.87l-8.106 -13.536a1.914 1.914 0 0 0 -3.274 0z" />
      <Path d="M12 16h.01" />
    </Glyph>
  );
}

export function LoaderGlyph(props: SetupGlyphProps) {
  return (
    <Glyph {...props}>
      <Path d="M12 6l0 -3" />
      <Path d="M16.25 7.75l2.15 -2.15" />
      <Path d="M18 12l3 0" />
      <Path d="M16.25 16.25l2.15 2.15" />
      <Path d="M12 18l0 3" />
      <Path d="M7.75 16.25l-2.15 2.15" />
      <Path d="M6 12l-3 0" />
      <Path d="M7.75 7.75l-2.15 -2.15" />
    </Glyph>
  );
}

export function InfoGlyph(props: SetupGlyphProps) {
  return (
    <Glyph {...props}>
      <Path d="M3 12a9 9 0 1 0 18 0a9 9 0 0 0 -18 0" />
      <Path d="M12 9h.01" />
      <Path d="M11 12h1v4h1" />
    </Glyph>
  );
}

export function LockGlyph(props: SetupGlyphProps) {
  return (
    <Glyph {...props}>
      <Path d="M5 13a2 2 0 0 1 2 -2h10a2 2 0 0 1 2 2v6a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-6z" />
      <Circle cx={12} cy={16} r={1} />
      <Path d="M8 11v-4a4 4 0 1 1 8 0v4" />
    </Glyph>
  );
}
