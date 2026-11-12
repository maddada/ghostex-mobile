/**
 * A computer's icon (machines/computerIcons.ts), drawn from the desktop's own drawings (computerIconPaths.ts).
 */

import Svg, { Path } from 'react-native-svg';

import { COMPUTER_ICON_DRAWINGS } from './computerIconPaths';
import type { GlyphProps } from './icons';

export function ComputerIconGlyph({ drawing, size, color }: GlyphProps & { drawing: string }) {
  const art = COMPUTER_ICON_DRAWINGS[drawing] ?? COMPUTER_ICON_DRAWINGS.desktop;
  if (art === undefined) return null;
  return (
    <Svg width={size} height={size} viewBox={art.viewBox} fill="none">
      {art.paths.map((path) =>
        art.filled ? (
          <Path key={path.d} d={path.d} transform={path.transform} fill={color} />
        ) : (
          <Path
            key={path.d}
            d={path.d}
            transform={path.transform}
            stroke={color}
            strokeWidth={art.strokeWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ),
      )}
    </Svg>
  );
}
