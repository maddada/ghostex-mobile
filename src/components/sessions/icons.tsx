/**
 * Simple SVG glyphs for the sessions drawer header buttons and rows
 * (sessions-drawer.md §§1-2). Stroke-based line icons tinted via `color`.
 */

import Svg, { Circle, Path, Rect } from 'react-native-svg';

export type GlyphProps = { size: number; color: string };

/** Circled information glyph for Details context-menu rows. */
export function InfoGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2} />
      <Circle cx={12} cy={7.5} r={1.2} fill={color} />
      <Path d="M 12 11 v 6" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/** Directional arrow for Back and project-reordering context-menu rows. */
export function ArrowGlyph({
  size,
  color,
  direction,
}: GlyphProps & { direction: 'left' | 'up' | 'down' }) {
  const path =
    direction === 'left'
      ? 'M 19 12 H 5 M 10 7 l -5 5 5 5'
      : direction === 'up'
        ? 'M 12 19 V 5 M 7 10 l 5 -5 5 5'
        : 'M 12 5 v 14 M 7 14 l 5 5 5 -5';
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d={path}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Door-and-arrow glyph for the Android-only explicit app exit action. */
export function ExitGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 10 4 h 8 a 1 1 0 0 1 1 1 v 14 a 1 1 0 0 1 -1 1 h -8 v -2 h 7 V 6 h -7 Z"
        fill={color}
      />
      <Path
        d="M 5 12 h 9 M 9.5 7.5 L 5 12 l 4.5 4.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Clock glyph (desktop IconClock) for Delayed Send / Close After Done. */
export function ClockGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2} />
      <Path
        d="M 12 7 v 5 l 3 3"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Circular-arrows refresh glyph. */
export function RefreshGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 20 12 a 8 8 0 1 1 -2.34 -5.66"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path d="M 20 3 v 4 h -4" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Laptop/workstation glyph for the Machines button. */
export function MachinesGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={4} y={5} width={16} height={11} rx={1.5} stroke={color} strokeWidth={2} />
      <Path d="M 2 19 h 20" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/** Gear glyph for the Settings button. */
/** Three-line hamburger for the sessions header's app menu. */
export function MenuGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 4 7 h 16 M 4 12 h 16 M 4 17 h 16"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

export function SettingsGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.09a2 2 0 0 1 1 1.73v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.09a2 2 0 0 1-1-1.74v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Circle
        cx={12}
        cy={12}
        r={3}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Crescent-moon sleep glyph (SESSION row sleeping indicator). */
export function SleepGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 20 14.5 A 8.5 8.5 0 1 1 9.5 4 a 7 7 0 0 0 10.5 10.5 Z"
        fill={color}
      />
    </Svg>
  );
}

/** Plus glyph for the project create-session pill. */
export function PlusGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M 12 5 v 14 M 5 12 h 14" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/** Vertical-ellipsis glyph for overflow pills. */
export function MoreGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={5.5} r={1.8} fill={color} />
      <Circle cx={12} cy={12} r={1.8} fill={color} />
      <Circle cx={12} cy={18.5} r={1.8} fill={color} />
    </Svg>
  );
}

/** Filled caret-right (desktop IconCaretRightFilled); rotate 90° when open. */
export function CaretRightGlyph({ size, color, rotated }: GlyphProps & { rotated?: boolean }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={rotated === true ? { transform: [{ rotate: '90deg' }] } : undefined}
    >
      <Path d="M 9 6 l 8 6 -8 6 Z" fill={color} />
    </Svg>
  );
}

/** Closed folder outline (desktop IconFolder, collapsed project header). */
export function FolderGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 3 6.5 a 1.5 1.5 0 0 1 1.5 -1.5 H 9 l 2.4 2.5 h 8.1 A 1.5 1.5 0 0 1 21 9 v 8.5 a 1.5 1.5 0 0 1 -1.5 1.5 h -15 A 1.5 1.5 0 0 1 3 17.5 V 6.5 Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Open folder outline (desktop IconFolderOpen, expanded project header). */
export function FolderOpenGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 3 6.5 a 1.5 1.5 0 0 1 1.5 -1.5 H 9 l 2.4 2.5 h 7.1 A 1.5 1.5 0 0 1 20 9 v 1 H 6.2 a 1.6 1.6 0 0 0 -1.5 1.1 L 3 16.4 V 6.5 Z M 3.4 18.3 5.5 12 a 1 1 0 0 1 0.95 -0.7 H 21.3 a 0.8 0.8 0 0 1 0.76 1.05 l -1.9 5.7 A 1.5 1.5 0 0 1 18.7 19 H 4.4 a 1 1 0 0 1 -1 -0.7 Z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Chat bubble (desktop IconMessageCircle, Chats collection header). */
export function MessageCircleGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 12 4 c 4.97 0 9 3.36 9 7.5 S 16.97 19 12 19 c -1.1 0 -2.16 -0.16 -3.13 -0.46 L 4 20 l 1.32 -3.95 C 3.87 14.75 3 13.2 3 11.5 3 7.36 7.03 4 12 4 Z"
        stroke={color}
        strokeWidth={1.8}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Two stacked squares (desktop IconCopy, Copy Path). */
export function CopyGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={8} y={8} width={12} height={12} rx={2} stroke={color} strokeWidth={2} />
      <Path
        d="M 16 8 V 6 a 2 2 0 0 0 -2 -2 H 6 a 2 2 0 0 0 -2 2 v 8 a 2 2 0 0 0 2 2 h 2"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/**
 * Pencil (desktop IconPencil, Rename, and the draft session's leading icon):
 * the path of the desktop's apps/desktop/assets/titlebar/pencil.svg (Tabler).
 */
export function PencilGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4M13.5 6.5l4 4"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Crown (a coordinator row's icon in place of its agent logo): the paths of the
 * desktop's apps/desktop/assets/titlebar/coordinator-crown.svg.
 */
export function CoordinatorGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
      <Path
        d="M3.2 8.2 7.8 12.4 12 5.2 16.2 12.4 20.8 8.2 19.2 17.2H4.8Z"
        stroke={color}
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
      <Rect x={4.8} y={18.8} width={14.4} height={2.4} rx={1.2} />
      <Circle cx={3.2} cy={7} r={1.9} />
      <Circle cx={12} cy={3.8} r={1.9} />
      <Circle cx={20.8} cy={7} r={1.9} />
    </Svg>
  );
}

/**
 * Crew (a coordinator row's badge beside its thread count): the paths of the
 * desktop's apps/desktop/assets/titlebar/users-group.svg.
 */
export function CrewGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {[
        'M10 13a2 2 0 1 0 4 0a2 2 0 0 0 -4 0',
        'M8 21v-1a2 2 0 0 1 2 -2h4a2 2 0 0 1 2 2v1',
        'M15 5a2 2 0 1 0 4 0a2 2 0 0 0 -4 0',
        'M17 10h2a2 2 0 0 1 2 2v1',
        'M5 5a2 2 0 1 0 4 0a2 2 0 0 0 -4 0',
        'M3 13v-1a2 2 0 0 1 2 -2h2',
      ].map((d) => (
        <Path key={d} d={d} stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </Svg>
  );
}

/** X cross (desktop IconX, Close/Kill rows). */
export function XGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M 6 6 l 12 12 M 18 6 L 6 18" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/** Axe (Tabler IconAxe) for terminating a Ghostex session. */
export function AxeGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 13 9 l 7.383 7.418 a 2.095 2.095 0 0 1 0 2.967 a 2.11 2.11 0 0 1 -2.976 0 L 10 12"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M 6.66 15.66 l -3.32 -3.32 a 1.25 1.25 0 0 1 0.42 -2.044 L 7 9 l 6 -6 3 3 -6 6 -1.296 3.24 a 1.25 1.25 0 0 1 -2.044 0.42"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Trash can (desktop IconTrash, Delete group). */
export function TrashGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 4 7 h 16 M 10 11 v 6 M 14 11 v 6 M 5 7 l 1 12 a 2 2 0 0 0 2 2 h 8 a 2 2 0 0 0 2 -2 l 1 -12 M 9 7 V 4 a 1 1 0 0 1 1 -1 h 4 a 1 1 0 0 1 1 1 v 3"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Painter palette (desktop IconPalette, Group color). */
export function PaletteGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 12 3 a 9 9 0 1 0 0 18 c 1.1 0 1.9 -0.9 1.9 -2 0 -0.5 -0.2 -1 -0.5 -1.3 -0.3 -0.4 -0.5 -0.8 -0.5 -1.3 0 -1.1 0.9 -2 2 -2 h 2.3 A 3.8 3.8 0 0 0 21 10.6 C 20.8 6.3 16.8 3 12 3 Z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Circle cx={7.5} cy={11} r={1.2} fill={color} />
      <Circle cx={10.5} cy={7.5} r={1.2} fill={color} />
      <Circle cx={15} cy={7.5} r={1.2} fill={color} />
    </Svg>
  );
}

/** Price-tag (desktop IconTag, Tag session). */
export function TagGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 4 5.5 A 1.5 1.5 0 0 1 5.5 4 h 5.2 a 2 2 0 0 1 1.4 0.6 l 7.3 7.3 a 2 2 0 0 1 0 2.8 l -4.7 4.7 a 2 2 0 0 1 -2.8 0 L 4.6 12.1 A 2 2 0 0 1 4 10.7 Z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Circle cx={9} cy={9} r={1.4} fill={color} />
    </Svg>
  );
}

/** Terminal window (desktop IconTerminal2, create-terminal header button). */
export function TerminalGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={4} width={18} height={16} rx={2} stroke={color} strokeWidth={2} />
      <Path
        d="M 7 9 l 3 3 -3 3 M 12.5 15 H 17"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Globe (desktop IconWorld, browser quick actions). */
export function WorldGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2} />
      <Path
        d="M 3 12 h 18 M 12 3 c 2.7 2.4 4 5.4 4 9 s -1.3 6.6 -4 9 c -2.7 -2.4 -4 -5.4 -4 -9 s 1.3 -6.6 4 -9 Z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Play triangle (desktop IconPlayerPlay, terminal quick actions). */
export function PlayGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 7 5 v 14 l 11 -7 Z"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Git fork (desktop IconGitFork, session Fork action). */
export function GitForkGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={6} cy={6} r={2.2} stroke={color} strokeWidth={2} />
      <Circle cx={18} cy={6} r={2.2} stroke={color} strokeWidth={2} />
      <Circle cx={12} cy={18} r={2.2} stroke={color} strokeWidth={2} />
      <Path
        d="M 6 8.2 v 1.3 a 2 2 0 0 0 2 2 h 8 a 2 2 0 0 0 2 -2 V 8.2 M 12 11.5 v 4.3"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Archive box for Park, matching the desktop session action. */
export function ArchiveGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={3} width={18} height={4} rx={1} stroke={color} strokeWidth={2} />
      <Path
        d="M 5 7 v 12 a 2 2 0 0 0 2 2 h 10 a 2 2 0 0 0 2 -2 V 7 M 10 11 h 4"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Tabler git-branch (the Copy submenu's Copy Branch row). */
export function GitBranchGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={6} cy={18} r={2} stroke={color} strokeWidth={2} />
      <Circle cx={6} cy={6} r={2} stroke={color} strokeWidth={2} />
      <Circle cx={18} cy={6} r={2} stroke={color} strokeWidth={2} />
      <Path d="M 6 8 v 8 M 15 6 a 9 9 0 0 0 -9 9" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/** Tabler hash (Copy Linear ID). */
export function HashGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 5 9 h 14 M 5 15 h 14 M 11 4 l -4 16 M 17 4 l -4 16"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Tabler link (Copy Linear Link). */
export function LinkGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 9 15 l 6 -6 M 11 6 l 0.463 -0.536 a 5 5 0 0 1 7.071 7.072 l -0.534 0.464 M 13 18 l -0.397 0.534 a 5.068 5.068 0 0 1 -7.127 0 a 4.972 4.972 0 0 1 0 -7.071 l 0.524 -0.463"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Tabler unlink (the Link to submenu's Unlink rows). */
export function UnlinkGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 17 22 v -2 M 9 15 l 6 -6 M 11 6 l 0.463 -0.536 a 5 5 0 0 1 7.071 7.072 l -0.534 0.464 M 13 18 l -0.397 0.534 a 5.068 5.068 0 0 1 -7.127 0 a 4.972 4.972 0 0 1 0 -7.071 l 0.524 -0.463 M 20 17 h 2 M 2 7 h 2 M 7 2 v 2"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Tabler git-pull-request (Copy PR Link). */
export function GitPullRequestGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={6} cy={18} r={2} stroke={color} strokeWidth={2} />
      <Circle cx={18} cy={18} r={2} stroke={color} strokeWidth={2} />
      <Circle cx={6} cy={6} r={2} stroke={color} strokeWidth={2} />
      <Path
        d="M 6 8 v 8 M 11 6 h 5 a 2 2 0 0 1 2 2 v 8 M 14 9 l -3 -3 l 3 -3"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Tabler circle-dot (Copy Issue Link). */
export function CircleDotGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2} />
      <Circle cx={12} cy={12} r={1} stroke={color} strokeWidth={2} />
    </Svg>
  );
}

/** Tabler box (Copy Linear Project Link). */
export function BoxGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 12 3 l 8 4.5 v 9 l -8 4.5 l -8 -4.5 v -9 l 8 -4.5 M 12 12 l 8 -4.5 M 12 12 v 9 M 12 12 l -8 -4.5"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Tabler briefcase (the project menu's Work Mode row). */
export function BriefcaseGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={7} width={18} height={13} rx={2} stroke={color} strokeWidth={2} />
      <Path
        d="M 8 7 v -2 a 2 2 0 0 1 2 -2 h 4 a 2 2 0 0 1 2 2 v 2 M 3 13 a 20 20 0 0 0 18 0"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
      />
    </Svg>
  );
}

/** Pin (desktop IconPin, mirrored like the sidebar's pinned marker). */
export function PinGlyph({ size, color }: GlyphProps) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ transform: [{ scaleX: -1 }] }}
    >
      <Path
        d="M 9 4 h 6 l -0.8 6 2.8 2.5 v 1.5 H 7 v -1.5 L 9.8 10 Z M 12 14 v 6"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Magnifier (desktop IconSearch, Search Conversation action). */
export function SearchGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={10.5} cy={10.5} r={6.5} stroke={color} strokeWidth={2} />
      <Path d="M 15.3 15.3 L 20 20" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/** Dog-eared note page (desktop IconNote, Session note action). */
export function NoteGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 13 20 H 7 a 2 2 0 0 1 -2 -2 V 6 a 2 2 0 0 1 2 -2 h 10 a 2 2 0 0 1 2 2 v 7 h -5 a 1 1 0 0 0 -1 1 v 6 z M 13 20 l 6 -7"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Stacked prompt with down arrow (Tabler IconStackPush, Saved Prompts). */
export function StackPushGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 6 10 l -2 1 l 8 4 l 8 -4 l -2 -1 M 4 15 l 8 4 l 8 -4 M 12 4 v 7 M 15 8 l -3 3 l -3 -3"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** File with an out-arrow (desktop IconFileExport, Export Transcript action). */
export function FileExportGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 14 3 v 4 a 1 1 0 0 0 1 1 h 4"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M 11.5 21 H 7 a 2 2 0 0 1 -2 -2 V 5 a 2 2 0 0 1 2 -2 h 7 l 5 5 v 5 m -5 6 h 7 m -3 -3 l 3 3 l -3 3"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Chevron-right (desktop IconChevronRight behind the in-project Browser /
 * Pinned / Sessions labels); rotate 90deg for the expanded state.
 */
export function ChevronRightGlyph({ size, color, rotated }: GlyphProps & { rotated?: boolean }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={rotated === true ? { transform: [{ rotate: '90deg' }] } : undefined}
    >
      <Path d="M 9 6 l 6 6 -6 6" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Chevron-down (Show more / expand affordances); rotate for up. */
export function ChevronDownGlyph({ size, color, rotated }: GlyphProps & { rotated?: boolean }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={rotated === true ? { transform: [{ rotate: '180deg' }] } : undefined}
    >
      <Path d="M 6 9 l 6 6 6 -6" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Cloud glyph: the machine tab's connection control (desktop IconCloud). */
export function CloudGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 6.657 18 C 4.085 18 2 15.993 2 13.517 c 0 -2.475 2.085 -4.482 4.657 -4.482 c 0.393 -1.762 1.794 -3.2 3.675 -3.773 c 1.88 -0.572 3.956 -0.193 5.444 1 c 1.488 1.19 2.162 3.007 1.77 4.769 h 0.99 c 1.913 0 3.464 1.56 3.464 3.486 C 22 16.443 20.449 18 18.536 18 H 6.657"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Three-quarter ring loader (desktop IconLoader2); the caller rotates it. */
export function LoaderGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M 12 3 a 9 9 0 1 0 9 9" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

/** Eye with a slash: "Hide from this strip" menu rows (desktop IconEyeOff). */
export function EyeOffGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 10.585 10.587 a 2 2 0 0 0 2.829 2.828"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M 16.681 16.673 A 8.717 8.717 0 0 1 12 18 c -3.6 0 -6.6 -2 -9 -6 c 1.272 -2.12 2.712 -3.678 4.32 -4.674 m 2.86 -1.146 A 9.055 9.055 0 0 1 12 6 c 3.6 0 6.6 2 9 6 c -0.666 1.11 -1.379 2.067 -2.138 2.87"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M 3 3 l 18 18" stroke={color} strokeWidth={2} strokeLinecap="round" />
    </Svg>
  );
}

/** Upright pushpin (Tabler IconPinned): the session menu's Pin row. */
export function PinnedGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 9 4 v 6 l -2 4 v 2 h 10 v -2 l -2 -4 v -6 M 12 16 v 5 M 8 4 h 8"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Crossed-out pushpin (Tabler IconPinnedOff): the session menu's Unpin row. */
export function PinnedOffGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 3 3 l 18 18 M 15 4.5 l -3.249 3.249 m -2.57 1.433 l -2.181 0.818 l -1.5 1.5 l 7 7 l 1.5 -1.5 l 0.82 -2.186 m 1.43 -2.563 l 3.25 -3.251 M 9 15 l -4.5 4.5 M 14.5 4 l 5.5 5.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Horizontal ellipsis (Tabler IconDots): the session menu's Advanced row. */
export function DotsGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={5} cy={12} r={1} stroke={color} strokeWidth={2} />
      <Circle cx={12} cy={12} r={1} stroke={color} strokeWidth={2} />
      <Circle cx={19} cy={12} r={1} stroke={color} strokeWidth={2} />
    </Svg>
  );
}

/** Tag with a slash (Tabler IconTagOff): Park's "No Tag Change" row. */
export function TagOffGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 7.149 7.144 a 0.498 0.498 0 0 0 0.351 0.856 a 0.498 0.498 0 0 0 0.341 -0.135 M 3.883 3.875 a 2.99 2.99 0 0 0 -0.883 2.125 v 5.172 a 2 2 0 0 0 0.586 1.414 l 7.71 7.71 a 2.41 2.41 0 0 0 3.408 0 l 2.796 -2.796 m 2.005 -2.005 l 0.79 -0.79 a 2.41 2.41 0 0 0 0 -3.41 l -7.71 -7.71 a 2 2 0 0 0 -1.412 -0.585 h -4.173 M 3 3 l 18 18"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** Chevron-left (Tabler IconChevronLeft): the Back row of a context-menu submenu. */
export function ChevronLeftGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M 15 6 l -6 6 l 6 6" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Star (Tabler IconStar / IconStarFilled): a Find prompt's favorite toggle. */
export function StarGlyph({ size, color, filled }: GlyphProps & { filled?: boolean }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 12 17.75 l -6.172 3.245 l 1.179 -6.873 l -5 -4.867 l 6.9 -1 l 3.086 -6.253 l 3.086 6.253 l 6.9 1 l -5 4.867 l 1.179 6.873 z"
        stroke={color}
        fill={filled === true ? color : 'none'}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
