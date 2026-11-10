/**
 * Draws a gx-core-shaped sidebar menu (./sidebar-menus.ts) in the phone's
 * ContextMenu card: icon ids become glyphs, headings and separators keep
 * their places, danger rows keep their red label, and every submenu opens as
 * a page with a Back row, the way the desktop opens its `page` submenus (the
 * phone has no room for side flyouts).
 *
 * SEE-ALSO: apps/desktop/src/app/native_sidebar/menus.rs, the desktop reader of the same shape.
 */

import type { ReactElement } from 'react';

import { AlarmGlyph } from '../../components/sessions/unified/glyphs';
import { COMMAND_ICONS, TAG_ICONS } from '../../assets/tablerIcons.generated';
import type { ContextMenuItem } from '../../components/sessions/ContextMenu';
import {
  ArchiveGlyph,
  BoxGlyph,
  BriefcaseGlyph,
  ChevronLeftGlyph,
  CircleCheckGlyph,
  CircleDotGlyph,
  ClockGlyph,
  CoordinatorGlyph,
  CopyGlyph,
  DotsGlyph,
  FileExportGlyph,
  GitBranchGlyph,
  GitForkGlyph,
  GitPullRequestGlyph,
  HashGlyph,
  LinkGlyph,
  NoteGlyph,
  PencilGlyph,
  PinGlyph,
  PinnedGlyph,
  PinnedOffGlyph,
  PlayGlyph,
  PlusGlyph,
  RefreshGlyph,
  RotateClockwiseGlyph,
  SleepGlyph,
  TagGlyph,
  TagOffGlyph,
  UnlinkGlyph,
  WorldGlyph,
  XGlyph,
  type GlyphProps,
} from '../../components/sessions/icons';

import { HeadsetGlyph } from '../../voice/VoiceButton';
import { BUILTIN_TAG_ICON_IDS, type SidebarMenuCommand, type SidebarMenuItem } from './sidebar-menus';

const MENU_ICON_SIZE = 14;

/** The desktop menu icon ids the phone's menus use (`titlebar/<id>.svg`). */
const MENU_GLYPHS: Readonly<Record<string, (props: GlyphProps) => ReactElement>> = {
  alarm: AlarmGlyph,
  archive: ArchiveGlyph,
  box: BoxGlyph,
  brain: COMMAND_ICONS.brain,
  briefcase: BriefcaseGlyph,
  checklist: COMMAND_ICONS.checklist,
  'chevron-left': ChevronLeftGlyph,
  'circle-check': CircleCheckGlyph,
  'circle-dot': CircleDotGlyph,
  clock: ClockGlyph,
  'coordinator-captain-hat': CoordinatorGlyph,
  copy: CopyGlyph,
  dots: DotsGlyph,
  'file-diff': COMMAND_ICONS.fileDiff,
  'file-export': FileExportGlyph,
  'git-branch': GitBranchGlyph,
  'git-fork': GitForkGlyph,
  'git-pull-request': GitPullRequestGlyph,
  hash: HashGlyph,
  headset: HeadsetGlyph,
  link: LinkGlyph,
  moon: SleepGlyph,
  note: NoteGlyph,
  pencil: PencilGlyph,
  pin: PinGlyph,
  pinned: PinnedGlyph,
  'pinned-off': PinnedOffGlyph,
  'player-play': PlayGlyph,
  plus: PlusGlyph,
  refresh: RefreshGlyph,
  'rotate-clockwise': RotateClockwiseGlyph,
  tag: TagGlyph,
  'tag-off': TagOffGlyph,
  unlink: UnlinkGlyph,
  world: WorldGlyph,
  x: XGlyph,
};

/** Built-in tag glyph id → the tag value TAG_ICONS is keyed by. */
const TAG_VALUE_BY_ICON_ID: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(BUILTIN_TAG_ICON_IDS).map(([tag, icon]) => [icon, tag]),
);

/**
 * The glyph for a row. A tag row carries its tag's colour; every other row, danger rows
 * included, draws its icon in the menu foreground like the desktop does.
 */
function menuIcon(item: SidebarMenuItem, foreground: string): ReactElement | undefined {
  const icon = item.icon;
  if (icon === undefined) return undefined;
  const color = item.iconColor ?? foreground;
  if (item.iconColor !== undefined) {
    const tagValue = TAG_VALUE_BY_ICON_ID[icon];
    const TagIcon = tagValue === undefined ? undefined : TAG_ICONS[tagValue];
    if (TagIcon !== undefined) return <TagIcon size={MENU_ICON_SIZE} color={color} strokeWidth={1.9} />;
    const CustomIcon = COMMAND_ICONS[icon];
    if (CustomIcon !== undefined) return <CustomIcon size={MENU_ICON_SIZE} color={color} strokeWidth={1.9} />;
  }
  const Glyph = MENU_GLYPHS[icon];
  return Glyph === undefined ? undefined : <Glyph size={MENU_ICON_SIZE} color={color} />;
}

export type SidebarMenuView = {
  /** The opened submenu's label, or null at the root. */
  openedLabel: string | null;
  items: ContextMenuItem[];
};

/**
 * The rows of `menu` at `menuPath` (the labels of the submenus opened so far). A path whose
 * submenu no longer exists stops at the deepest one that does.
 */
export function sidebarMenuView(
  menu: readonly SidebarMenuItem[],
  menuPath: readonly string[],
  handlers: {
    openPath: (menuPath: string[]) => void;
    run: (command: SidebarMenuCommand) => void;
  },
  foreground: string,
): SidebarMenuView {
  let items: readonly SidebarMenuItem[] = menu;
  const opened: string[] = [];
  for (const label of menuPath) {
    const next = items.find((item) => item.children !== undefined && item.label === label);
    if (next?.children === undefined) break;
    items = next.children;
    opened.push(label);
  }
  const prefix = opened.join('/');
  const rows: ContextMenuItem[] = [];
  if (opened.length > 0) {
    rows.push({
      kind: 'item',
      key: `${prefix}:back`,
      label: 'Back',
      icon: <ChevronLeftGlyph size={MENU_ICON_SIZE} color={foreground} />,
      onPress: () => handlers.openPath(opened.slice(0, -1)),
    });
    rows.push({ kind: 'separator', key: `${prefix}:back-separator` });
  }
  items.forEach((item, index) => {
    const key = `${prefix}:${index}`;
    if (item.separator === true) {
      rows.push({ kind: 'separator', key });
      return;
    }
    const label = item.label ?? '';
    if (item.heading === true) {
      rows.push({ kind: 'heading', key, label });
      return;
    }
    const children = item.children;
    const command = item.command;
    const onPress =
      children !== undefined
        ? () => handlers.openPath([...opened, label])
        : command !== undefined
          ? () => handlers.run(command)
          : () => undefined;
    const base = {
      kind: 'item' as const,
      key,
      label,
      selected: item.checked,
      submenu: children !== undefined,
      destructive: item.danger === true,
      disabled: item.disabled || (children === undefined && command === undefined),
      suffix: item.suffix,
      onPress,
    };
    if (item.color !== undefined) {
      rows.push({ ...base, swatch: item.color });
      return;
    }
    const icon = menuIcon(item, foreground);
    rows.push(icon === undefined ? base : { ...base, icon });
  });
  return { openedLabel: opened.length > 0 ? opened[opened.length - 1] : null, items: rows };
}
