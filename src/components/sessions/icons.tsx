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

/** Pencil (desktop IconPencil, Rename). */
export function PencilGlyph({ size, color }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M 4 20 l 1 -4 L 16.5 4.5 a 2.1 2.1 0 0 1 3 3 L 8 19 Z M 13.5 6.5 l 3 3"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
