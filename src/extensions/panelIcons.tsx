/**
 * A panel's icons on the phone: a Tabler name the desktop draws from its own icon set, drawn with the phone's glyph of
 * the same name where it has one. A name the phone has no glyph for, and an extension's own SVG file (served by the
 * computer's gxserver, which the phone's sessions list does not reach), draw nothing, so the row keeps its text.
 */

import type { ReactElement } from 'react';

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

/** The glyph for a panel's icon name, or null (no name, an extension's own file, a name the phone lacks). */
export function PanelIcon({
  name,
  size,
  color,
}: {
  name: string | undefined;
  size: number;
  color: string;
}): ReactElement | null {
  if (name === undefined) return null;
  const key = name
    .trim()
    .toLowerCase()
    .replace(/^icon-?/u, '');
  if (key.endsWith('.svg')) return null;
  const Glyph = GLYPHS[key];
  return Glyph === undefined ? null : <Glyph size={size} color={color} />;
}

export function hasPanelIcon(name: string | undefined): boolean {
  if (name === undefined) return false;
  const key = name
    .trim()
    .toLowerCase()
    .replace(/^icon-?/u, '');
  return GLYPHS[key] !== undefined;
}
