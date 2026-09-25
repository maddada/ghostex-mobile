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

import { COMMAND_ICONS, TAG_ICONS } from '../../assets/tablerIcons.generated';
import type { ContextMenuItem } from '../../components/sessions/ContextMenu';
import {
  ArchiveGlyph,
  ChevronLeftGlyph,
  ClockGlyph,
  CopyGlyph,
  DotsGlyph,
  FileExportGlyph,
  GitForkGlyph,
  NoteGlyph,
  PencilGlyph,
  PinGlyph,
  PinnedGlyph,
  PinnedOffGlyph,
  PlayGlyph,
  PlusGlyph,
  RefreshGlyph,
  SleepGlyph,
  TagGlyph,
  TagOffGlyph,
  XGlyph,
  type GlyphProps,
} from '../../components/sessions/icons';
import { GhostexPalette } from '../../theme/palette';
import { BUILTIN_TAG_ICON_IDS, type SidebarMenuCommand, type SidebarMenuItem } from './sidebar-menus';

const MENU_ICON_SIZE = 14;
const MENU_ICON_COLOR = GhostexPalette.FOREGROUND;

/** The desktop menu icon ids the phone's menus use (`titlebar/<id>.svg`). */
const MENU_GLYPHS: Readonly<Record<string, (props: GlyphProps) => ReactElement>> = {
  archive: ArchiveGlyph,
  'chevron-left': ChevronLeftGlyph,
  clock: ClockGlyph,
  copy: CopyGlyph,
  dots: DotsGlyph,
  'file-export': FileExportGlyph,
  'git-fork': GitForkGlyph,
  moon: SleepGlyph,
  note: NoteGlyph,
  pencil: PencilGlyph,
  pin: PinGlyph,
  pinned: PinnedGlyph,
  'pinned-off': PinnedOffGlyph,
  'player-play': PlayGlyph,
  plus: PlusGlyph,
  refresh: RefreshGlyph,
  tag: TagGlyph,
  'tag-off': TagOffGlyph,
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
function menuIcon(item: SidebarMenuItem): ReactElement | undefined {
  const icon = item.icon;
  if (icon === undefined) return undefined;
  const color = item.iconColor ?? MENU_ICON_COLOR;
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
      icon: <ChevronLeftGlyph size={MENU_ICON_SIZE} color={MENU_ICON_COLOR} />,
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
      onPress,
    };
    if (item.color !== undefined) {
      rows.push({ ...base, swatch: item.color });
      return;
    }
    const icon = menuIcon(item);
    rows.push(icon === undefined ? base : { ...base, icon });
  });
  return { openedLabel: opened.length > 0 ? opened[opened.length - 1] : null, items: rows };
}
