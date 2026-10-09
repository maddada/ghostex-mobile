/**
 * The workspace tile at the left end of the Space row: the shown workspace's letter on its color
 * with a small chevron badge, like the desktop's
 * apps/desktop/src/app/native_sidebar/workspace_tile.rs. Tapping it opens the workspace menu
 * (`workspaceMenuItems`), which lists the computer's workspaces with the shown one checked.
 *
 * CDXC:Workspaces 2026-10-09 WHY:
 * The phone's menu keeps only the workspace rows of the desktop's (gx-core
 * sidebar_menu/workspace.rs): opening a workspace in a new window, workspace settings and creating
 * a workspace are desktop windows and settings pages the phone does not have.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { GhostexWorkspace, GhostexWorkspaces } from '../../contract/mobileSummary';
import { SidebarPalette } from '../../theme/palette';
import { orderedWorkspaces } from '../../workspaces/workspaceFilter';
import type { ContextMenuItem } from './ContextMenu';
import { BriefcaseGlyph, ChevronDownGlyph, UserGlyph } from './icons';

const TILE_SIZE = 28;

export default function WorkspaceTile({
  workspace,
  onPress,
}: {
  workspace: GhostexWorkspace;
  onPress: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Workspace ${workspace.name}`}
        accessibilityHint="Opens the workspace menu"
        onPress={onPress}
        style={({ pressed }) => [styles.tile, { backgroundColor: workspace.color }, pressed ? styles.pressed : null]}
      >
        <Text style={styles.letter} numberOfLines={1}>
          {workspace.letter}
        </Text>
        <View style={styles.badge}>
          <ChevronDownGlyph size={8} color="#FFFFFF" />
        </View>
      </Pressable>
      <View style={styles.hairline} />
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
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.85,
  },
  letter: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  badge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 12,
    height: 12,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  hairline: {
    width: 1,
    height: 16,
    backgroundColor: SidebarPalette.HEADER_BUTTON_BORDER,
  },
});
