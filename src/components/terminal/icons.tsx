/**
 * Stroke-based SVG glyphs for the terminal screen chrome
 * (docs/specs/terminal-screen.md §§1,2). Sized via a square viewBox.
 */

import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type IconProps = {
  size?: number;
  color?: string;
  strokeWidth?: number;
};

function iconDefaults(props: IconProps): Required<IconProps> {
  return {
    size: props.size ?? 16,
    color: props.color ?? '#FAFAFA',
    strokeWidth: props.strokeWidth ?? 2,
  };
}

export function ChevronLeftIcon(props: IconProps) {
  const { size, color, strokeWidth } = iconDefaults(props);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M15 18l-6-6 6-6"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function EllipsisIcon(props: IconProps) {
  const { size, color } = iconDefaults(props);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={5} cy={12} r={1.8} fill={color} />
      <Circle cx={12} cy={12} r={1.8} fill={color} />
      <Circle cx={19} cy={12} r={1.8} fill={color} />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  const { size, color, strokeWidth } = iconDefaults(props);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M18 6L6 18M6 6l12 12"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export type ArrowDirection = 'up' | 'down' | 'left' | 'right';

const ARROW_PATHS: Record<ArrowDirection, string> = {
  up: 'M12 19V5M5 12l7-7 7 7',
  down: 'M12 5v14M19 12l-7 7-7-7',
  left: 'M19 12H5M12 19l-7-7 7-7',
  right: 'M5 12h14M12 5l7 7-7 7',
};

export function ArrowIcon({ direction, ...props }: IconProps & { direction: ArrowDirection }) {
  const { size, color, strokeWidth } = iconDefaults(props);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d={ARROW_PATHS[direction]}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function KeyboardIcon(props: IconProps) {
  const { size, color, strokeWidth } = iconDefaults(props);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={2} y={6} width={20} height={12} rx={2} stroke={color} strokeWidth={strokeWidth} />
      <Path
        d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** keyboard.chevron.compact.down equivalent: keyboard above a down chevron. */
export function KeyboardDismissIcon(props: IconProps) {
  const { size, color, strokeWidth } = iconDefaults(props);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={3} width={18} height={10} rx={2} stroke={color} strokeWidth={strokeWidth} />
      <Path
        d="M6.5 6.5h.01M10.5 6.5h.01M14.5 6.5h.01M8 9.5h8"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <Path
        d="M9 17.5l3 3 3-3"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** A compact text-composer glyph for the terminal toolbar page toggle. */
export function TextEditorIcon(props: IconProps) {
  const { size, color, strokeWidth } = iconDefaults(props);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M5 6h14M5 11h14M5 16h8M17 15v6M14 18h6"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function PaperclipIcon(props: IconProps) {
  const { size, color, strokeWidth } = iconDefaults(props);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function HourglassIcon(props: IconProps) {
  const { size, color, strokeWidth } = iconDefaults(props);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M6 2h12M6 22h12M8 2v3.5L12 10l4-4.5V2M8 22v-3.5L12 14l4 4.5V22"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function WarningTriangleIcon(props: IconProps) {
  const { size, color, strokeWidth } = iconDefaults(props);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M12 9v4M12 17h.01" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
    </Svg>
  );
}
