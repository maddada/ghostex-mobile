/**
 * Space row, the phone's counterpart to the desktop sidebar's Spaces row
 * (apps/desktop/src/app/native_sidebar/selectors.rs `render_native_sidebar_space_row`): the
 * Active projects star first, then the selected machine's Spaces in their manual order (Sidebar
 * organization sync), then the built-in "Other" view last.
 *
 * There is no "All Projects" view any more — Other shows exactly what no Space
 * claims (src/spaces/otherSpace.ts) — so the row is always a complete cover of
 * the machine's projects.
 *
 * CDXC:Spaces 2026-11-12 DECISION: User: the phone's Space chips match the desktop's Spaces row:
 * icon-only tiles (no names), bigger icons, the desktop's tile style and order. Each tile is a
 * rounded square with a hairline outline and no fill, the Space's icon in the Space's own color
 * (the Gray Space in the list's muted ink, like the desktop's header grey), and the selected tile
 * is filled and outlined (dark: white at 12% and 16%; light: a raised white tile). The tiles share
 * the row's whole width as the desktop's do; when they cannot fit at their minimum width the row
 * scrolls instead. With no names on the tiles, a long press opens the Space's menu, titled with its
 * name, and each tile's accessibility label carries the name.
 *
 * Each tile shows the status of the sessions it holds with the desktop Space's
 * overlapping dots (StatusDotStack; selectors.rs), hung under the icon and over its lower
 * edge as on the desktop, the icon dimmed to 80% while they show.
 */

import type { ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { COMMAND_ICONS } from '../../assets/tablerIcons.generated';
import { ACTIVE_SPACE_COLOR, ACTIVE_SPACE_ICON, ACTIVE_SPACE_ID } from '../../spaces/activeProjects';
import { OTHER_SIDEBAR_SPACE_ICON, OTHER_SIDEBAR_SPACE_ID, OTHER_SIDEBAR_SPACE_LABEL } from '../../spaces/otherSpace';
import { tabStatusCounts, type SessionCounts } from '../../contract/grouping';
import type { SpaceRowItem } from '../../spaces/spaceFilter';
import { GhostexStrokeWidth } from '../../theme/palette';
import { inkStyleSheets, SIDEBAR_BACKGROUND, useSidebarInk, type SidebarInk } from './rows';
import { StarGlyph } from './icons';
import StatusDotStack from './StatusDotStack';

/** The Active projects star, first in the row (src/spaces/activeProjects.ts), in the desktop star's yellow. */
export const ACTIVE_ROW_ITEM: SpaceRowItem = {
  spaceId: ACTIVE_SPACE_ID,
  name: 'Active projects',
  icon: ACTIVE_SPACE_ICON,
  color: ACTIVE_SPACE_COLOR,
};

const OTHER_ROW_ITEM: SpaceRowItem = {
  spaceId: OTHER_SIDEBAR_SPACE_ID,
  name: OTHER_SIDEBAR_SPACE_LABEL,
  icon: OTHER_SIDEBAR_SPACE_ICON,
  color: '#4f5663',
};

/** The desktop's Gray Space, in either of its stored values (space_editor_modal.rs `is_space_gray`). */
function isSpaceGray(color: string): boolean {
  const value = color.trim().toLowerCase();
  return value === '#4f5663' || value === '#808080';
}

/** The color a Space's icon draws in (selectors.rs): its own, the Gray Space in the list's muted ink. */
export function spaceIconColor(color: string, ink: SidebarInk): string {
  return isSpaceGray(color) ? ink.muted : color;
}

/** A Space's icon at a menu row's 14 (the Space menu's Show Space row). */
export function spaceMenuIcon(item: SpaceRowItem, ink: SidebarInk): ReactElement {
  if (item.spaceId === ACTIVE_SPACE_ID) return <StarGlyph size={14} color={ACTIVE_SPACE_COLOR} filled />;
  const Icon = COMMAND_ICONS[item.icon] ?? COMMAND_ICONS.stack;
  return <Icon size={14} color={spaceIconColor(item.color, ink)} />;
}

export default function SpaceTabs({
  spaces,
  selectedSpaceId,
  countsBySpaceId,
  onSelect,
  activeProjects = false,
  onSpaceMenu,
  style,
}: {
  /** The machine's own Spaces, in order; the star leads them and Other is appended here. */
  spaces: readonly SpaceRowItem[];
  selectedSpaceId: string;
  /** spaceSessionCounts: what each tile's status dots draw. */
  countsBySpaceId: Readonly<Record<string, SessionCounts>>;
  onSelect: (spaceId: string) => void;
  /** The computer shows the Active projects star (its `sidebarActiveProjects`); it leads the row. */
  activeProjects?: boolean;
  /** A long press on a tile: that Space's menu (the star's has Remove Active projects), as the desktop's right click. */
  onSpaceMenu?: (item: SpaceRowItem) => void;
  /** Overrides for the row's own box, e.g. when it shares a line with the workspace tile. */
  style?: StyleProp<ViewStyle>;
}) {
  const items = activeProjects ? [ACTIVE_ROW_ITEM, ...spaces, OTHER_ROW_ITEM] : [...spaces, OTHER_ROW_ITEM];
  const ink = useSidebarInk();
  const styles = spaceStyles(ink);
  return (
    <ScrollView
      contentContainerStyle={styles.row}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={[styles.scroll, style]}
    >
      {items.map((item) => {
        const selected = item.spaceId === selectedSpaceId;
        const star = item.spaceId === ACTIVE_SPACE_ID;
        const Icon = COMMAND_ICONS[item.icon] ?? COMMAND_ICONS.stack;
        const sessionCounts = countsBySpaceId[item.spaceId];
        // The Space being shown has its sessions on screen, so only the other tiles carry status dots (desktop `assemble.rs`).
        const counts = sessionCounts === undefined || selected ? undefined : tabStatusCounts(sessionCounts);
        const hasStatus =
          counts !== undefined &&
          (counts.workingCount > 0 ||
            counts.attentionCount > 0 ||
            counts.backgroundWorkCount > 0 ||
            counts.questionCount > 0 ||
            counts.approvalCount > 0);
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityLabel={star ? item.name : `Space ${item.name}`}
            accessibilityHint="Long press for the Space's menu"
            accessibilityState={{ selected }}
            key={item.spaceId}
            onPress={() => onSelect(item.spaceId)}
            onLongPress={onSpaceMenu === undefined ? undefined : () => onSpaceMenu(item)}
            style={({ pressed }) => [
              styles.tile,
              selected ? styles.tileSelected : null,
              pressed && !selected ? styles.tilePressed : null,
            ]}
          >
            <View style={hasStatus ? styles.iconWithStatus : null}>
              {star ? (
                <StarGlyph size={SPACE_ICON_SIZE} color={ACTIVE_SPACE_COLOR} filled />
              ) : (
                <Icon size={SPACE_ICON_SIZE} color={spaceIconColor(item.color, ink)} />
              )}
            </View>
            {hasStatus ? (
              <View pointerEvents="none" style={styles.dots}>
                <StatusDotStack
                  workingCount={counts.workingCount}
                  attentionCount={counts.attentionCount}
                  backgroundWorkCount={counts.backgroundWorkCount}
                  questionCount={counts.questionCount}
                  approvalCount={counts.approvalCount}
                  ringColor={ink.light ? '#FFFFFF' : SIDEBAR_BACKGROUND}
                />
              </View>
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/**
 * Tile height, and with it the row's: fixed so content cannot resize it. The desktop's 28pt tile
 * and 16pt icon, grown for a finger (the workspace tile matches it, WorkspaceTile.tsx).
 */
export const SPACE_CHIP_HEIGHT = 34;
const SPACE_ICON_SIZE = 20;
/** The narrowest a tile gets before the row scrolls instead (the desktop's 28, grown with the tile). */
const SPACE_TILE_MIN_WIDTH = 40;
/**
 * The desktop's dots stand 20.5 down a 28 tile, over the icon's lower edge. Here they stay inside
 * the tile, since the row's scroll view clips what hangs out of it.
 */
const SPACE_DOTS_TOP = 22;

const spaceStyles = inkStyleSheets((ink) =>
  StyleSheet.create({
    /*
     * A horizontal ScrollView takes its height from its content and inherits
     * `flexShrink: 1` from ScrollView's base style, so in a column beside a
     * filling list it is the first thing Yoga squeezes. The row is one tile tall
     * by definition, so it says so and opts out of shrinking.
     */
    scroll: {
      marginTop: 6,
      height: SPACE_CHIP_HEIGHT,
      flexGrow: 0,
      flexShrink: 0,
    },
    /** At least the row's width, so the tiles stretch across it; wider, and the row scrolls. */
    row: {
      flexGrow: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    tile: {
      flexGrow: 1,
      flexBasis: SPACE_TILE_MIN_WIDTH,
      minWidth: SPACE_TILE_MIN_WIDTH,
      height: SPACE_CHIP_HEIGHT,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: 8,
      borderWidth: GhostexStrokeWidth,
      borderColor: ink.light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)',
    },
    /** selectors.rs `space_tile_selected_colors`. */
    tileSelected: ink.light
      ? {
          backgroundColor: '#FFFFFF',
          borderColor: 'rgba(0,0,0,0.16)',
          shadowColor: '#000000',
          shadowOpacity: 0.08,
          shadowRadius: 2,
          shadowOffset: { width: 0, height: 1 },
          elevation: 1,
        }
      : {
          backgroundColor: 'rgba(255,255,255,0.12)',
          borderColor: 'rgba(255,255,255,0.16)',
        },
    tilePressed: {
      backgroundColor: ink.light ? 'rgba(38,38,38,0.08)' : 'rgba(200,205,213,0.08)',
    },
    iconWithStatus: {
      opacity: 0.8,
    },
    dots: {
      position: 'absolute',
      top: SPACE_DOTS_TOP,
      left: 0,
      right: 0,
      height: 11,
      alignItems: 'center',
      justifyContent: 'center',
    },
  }),
);
