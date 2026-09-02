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

/** Speech bubble: shown in terminal view to switch the tab to Session Chat. */
export function ChatBubbleIcon(props: IconProps) {
  const { size, color, strokeWidth } = iconDefaults(props);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** `>_` prompt glyph: shown in chat view to switch the tab back to the terminal. */
export function TerminalPromptIcon(props: IconProps) {
  const { size, color, strokeWidth } = iconDefaults(props);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 17l6-6-6-6M12 19h8"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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

export function RefreshIcon(props: IconProps) {
  const { size, color, strokeWidth } = iconDefaults(props);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M20 12a8 8 0 1 1-2.34-5.66"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      <Path
        d="M20 3v4.5h-4.5"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
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

/** A compact pencil glyph for the terminal toolbar page toggle. */
export function PencilIcon(props: IconProps) {
  const { size, color, strokeWidth } = iconDefaults(props);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 20h9M16.5 3.5a2.12 2.12 0 0 1 3 3L8 18l-4 1 1-4L16.5 3.5z"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Return/newline glyph: arrow turning down and left. */
export function ReturnIcon(props: IconProps) {
  const { size, color, strokeWidth } = iconDefaults(props);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M19 5v6a4 4 0 0 1-4 4H6M10 11l-4 4 4 4"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Compact send glyph used in place of keyboard-dismiss while composing text. */
export function SendIcon(props: IconProps) {
  const { size, color, strokeWidth } = iconDefaults(props);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 4l17 8-17 8 3-8-3-8zM7 12h14"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
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

/** Box with an out-arrow: hand the current address to another app on the phone. */
export function ExternalLinkIcon(props: IconProps) {
  const { size, color, strokeWidth } = iconDefaults(props);
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M15 3h6v6M10 14L21 3"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
