/**
 * The workspace tile at the left end of the Space row, the phone's take on the desktop's split
 * button (apps/desktop/src/app/native_sidebar/workspace_tile.rs): the shown workspace's letter on
 * its color, then a chevron part, in a box sized and bordered like a Space chip. Tapping the letter
 * switches to the other workspace (`workspaceSwitchTarget`), or opens the menu when there is only
 * one; the chevron opens the workspace menu (`workspaceMenuItems`), which lists the computer's
 * workspaces with the shown one checked.
 *
 * CDXC:Workspaces 2026-10-09 WHY:
 * The phone's menu keeps only the workspace rows of the desktop's (gx-core
 * sidebar_menu/workspace.rs): opening a workspace in a new window, workspace settings and creating
 * a workspace are desktop windows and settings pages the phone does not have.
 *
 * CDXC:Workspaces 2026-10-10 SEE-ALSO:
 * The desktop dropped the hairline after the tile and made it a split button the size of a Space
 * button (user decision in workspace_tile.rs); the phone follows, with no divider before the chips.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { GhostexWorkspace, GhostexWorkspaces } from '../../contract/mobileSummary';
import { GhostexRadii, GhostexStrokeWidth, SidebarPalette } from '../../theme/palette';
import { orderedWorkspaces } from '../../workspaces/workspaceFilter';
import type { ContextMenuItem } from './ContextMenu';
import { BriefcaseGlyph, ChevronDownGlyph, UserGlyph } from './icons';

/** A Space chip's height (SpaceTabs `SPACE_CHIP_HEIGHT`), so the tile lines up with the chips. */
const TILE_HEIGHT = 30;
const LETTER_PART_WIDTH = 34;
const CHEVRON_PART_WIDTH = 22;
const LETTER_BLOCK_SIZE = 20;

export default function WorkspaceTile({
  workspace,
  switchTo,
  onSwitch,
  onOpenMenu,
}: {
  workspace: GhostexWorkspace;
  /** The workspace one tap on the letter shows; null with a single workspace. */
  switchTo: GhostexWorkspace | null;
  onSwitch: (workspaceId: string) => void;
  onOpenMenu: () => void;
}) {
  return (
    <View style={styles.tile}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={switchTo === null ? `Workspace ${workspace.name}` : `Switch to ${switchTo.name}`}
        accessibilityHint={switchTo === null ? 'Opens the workspace menu' : undefined}
        hitSlop={{ top: 8, bottom: 8, left: 8 }}
        onPress={() => (switchTo === null ? onOpenMenu() : onSwitch(switchTo.workspaceId))}
        style={({ pressed }) => [styles.letterPart, pressed ? styles.pressed : null]}
      >
        <View style={[styles.letterBlock, { backgroundColor: workspace.color }]}>
          <Text style={styles.letter} numberOfLines={1}>
            {workspace.letter}
          </Text>
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Workspace ${workspace.name} menu`}
        hitSlop={{ top: 8, bottom: 8, right: 4 }}
        onPress={onOpenMenu}
        style={({ pressed }) => [styles.chevronPart, pressed ? styles.pressed : null]}
      >
        <ChevronDownGlyph size={12} color={SidebarPalette.MUTED} />
      </Pressable>
    </View>
  );
}

/** The workspace menu's rows: a heading, then every workspace, the shown one checked. */
export function workspaceMenuItems(
  workspaces: GhostexWorkspaces,
  currentWorkspaceId: string,
  onSelect: (workspaceId: string) => void,
): ContextMenuItem[] {
  return [
    { kind: 'heading', key: 'heading', label: 'Workspaces' },
    ...orderedWorkspaces(workspaces).map(
      (workspace): ContextMenuItem => ({
        kind: 'item',
        key: workspace.workspaceId,
        label: workspace.name,
        icon:
          workspace.kind === 'work' ? (
            <BriefcaseGlyph size={14} color={workspace.color} />
          ) : (
            <UserGlyph size={14} color={workspace.color} />
          ),
        selected: workspace.workspaceId === currentWorkspaceId,
        onPress: () => onSelect(workspace.workspaceId),
      }),
    ),
  ];
}

const styles = StyleSheet.create({
  tile: {
    flexDirection: 'row',
    height: TILE_HEIGHT,
    flexShrink: 0,
    borderRadius: GhostexRadii.pill,
    borderWidth: GhostexStrokeWidth,
    borderColor: SidebarPalette.HEADER_BUTTON_BORDER,
    backgroundColor: SidebarPalette.HEADER_BUTTON_BG,
    overflow: 'hidden',
  },
  letterPart: {
    width: LETTER_PART_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronPart: {
    width: CHEVRON_PART_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: GhostexStrokeWidth,
    borderLeftColor: SidebarPalette.HEADER_BUTTON_BORDER,
  },
  pressed: {
    backgroundColor: 'rgba(200,205,213,0.08)',
  },
  letterBlock: {
    width: LETTER_BLOCK_SIZE,
    height: LETTER_BLOCK_SIZE,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  letter: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
});
