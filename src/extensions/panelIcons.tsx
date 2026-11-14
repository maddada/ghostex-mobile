/**
 * A panel's icons on the phone: a Tabler name the desktop draws from its own icon set, drawn with the phone's glyph of
 * the same name where it has one, and an extension's own SVG file, read from its computer (extensionIcons.tsx). A name
 * the phone has no glyph for draws nothing, so the row keeps its text.
 */

import type { ReactElement } from 'react';

import { TAG_ICONS } from '../assets/tablerIcons.generated';
import { ExtensionIcon, extensionIconPath } from './extensionIcons';

import {
  ArchiveGlyph,
  BoxGlyph,
  BriefcaseGlyph,
  CircleCheckGlyph,
  CircleDotGlyph,
  ClockGlyph,
  CloudGlyph,
  CopyGlyph,
  EyeGlyph,
  FileCodeGlyph,
  FileGlyph,
  FilterGlyph,
  FolderGlyph,
  FolderOpenGlyph,
  GitBranchGlyph,
  GitPullRequestGlyph,
  HashGlyph,
  LinkGlyph,
  ListGlyph,
  MessageCircleGlyph,
  MessagePlusGlyph,
  NoteGlyph,
  PencilGlyph,
  PinGlyph,
  PlayGlyph,
  PlusGlyph,
  RefreshGlyph,
  SearchGlyph,
  ServerGlyph,
  SettingsGlyph,
  SparklesGlyph,
  StarGlyph,
  TagGlyph,
  TerminalGlyph,
  TilesGlyph,
  TrashGlyph,
  UserGlyph,
  WorldGlyph,
} from '../components/sessions/icons';

type Glyph = (props: { size: number; color: string }) => ReactElement;

const GLYPHS: Record<string, Glyph> = {
  archive: ArchiveGlyph,
  box: BoxGlyph,
  briefcase: BriefcaseGlyph,
  check: CircleCheckGlyph,
  'circle-check': CircleCheckGlyph,
  'circle-dot': CircleDotGlyph,
  clock: ClockGlyph,
  cloud: CloudGlyph,
  copy: CopyGlyph,
  eye: EyeGlyph,
  file: FileGlyph,
  'file-code': FileCodeGlyph,
  'file-text': NoteGlyph,
  filter: FilterGlyph,
  folder: FolderGlyph,
  'folder-open': FolderOpenGlyph,
  'git-branch': GitBranchGlyph,
  'git-pull-request': GitPullRequestGlyph,
  globe: WorldGlyph,
  hash: HashGlyph,
  'layout-grid': TilesGlyph,
  link: LinkGlyph,
  list: ListGlyph,
  'list-check': ListGlyph,
  message: MessageCircleGlyph,
  'message-circle': MessageCircleGlyph,
  'message-plus': MessagePlusGlyph,
  note: NoteGlyph,
  pencil: PencilGlyph,
  pin: PinGlyph,
  puzzle: TAG_ICONS.feature,
  play: PlayGlyph,
  'player-play': PlayGlyph,
  plus: PlusGlyph,
  refresh: RefreshGlyph,
  search: SearchGlyph,
  server: ServerGlyph,
  settings: SettingsGlyph,
  sparkles: SparklesGlyph,
  star: StarGlyph,
  tag: TagGlyph,
  terminal: TerminalGlyph,
  'terminal-2': TerminalGlyph,
  trash: TrashGlyph,
  user: UserGlyph,
  world: WorldGlyph,
};

/** Which extension, on which computer, an icon belongs to: its own `*.svg` files are read from there. */
export type PanelIconSource = { machineId: string; extensionId: string };

function iconKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/^icon-?/u, '');
}

/**
 * The glyph for a panel's icon: a Tabler name in the phone's glyph, or, with `source`, the extension's own SVG
 * (extensionIcons.tsx). Null for no icon and for a name the phone has no glyph for, so the row keeps its text.
 */
export function PanelIcon({
  name,
  size,
  color,
  source,
}: {
  name: string | undefined;
  size: number;
  color: string;
  source?: PanelIconSource;
}): ReactElement | null {
  if (name === undefined) return null;
  const Glyph = GLYPHS[iconKey(name)];
  if (Glyph !== undefined) return <Glyph size={size} color={color} />;
  const path = source === undefined ? null : extensionIconPath(source.extensionId, name);
  return path === null ? null : <ExtensionIcon machineId={source!.machineId} path={path} size={size} color={color} />;
}

/** Whether PanelIcon draws something for this icon (from `source`, when given). */
export function hasPanelIcon(name: string | undefined, source?: PanelIconSource): boolean {
  if (name === undefined) return false;
  if (GLYPHS[iconKey(name)] !== undefined) return true;
  return source !== undefined && extensionIconPath(source.extensionId, name) !== null;
}
