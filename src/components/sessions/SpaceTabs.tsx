/**
 * Space row, the phone's counterpart to the desktop sidebar's Space switcher
 * (packages/core-ui/space-filter-row.tsx): the selected machine's saved
 * sidebar filters in their manual order, with the built-in "Other" view last.
 *
 * There is no "All Projects" view any more — Other shows exactly what no Space
 * claims (src/spaces/otherSpace.ts) — so the row is always a complete cover of
 * the machine's projects. The phone has no overflow menu: the row scrolls
 * horizontally instead, since a chip that is off-screen is still one swipe away.
 *
 * Each chip shows the status of the sessions it holds with the desktop Space's
 * overlapping dots (StatusDotStack; apps/desktop/src/app/native_sidebar/
 * selectors.rs), its icon dimmed to 80% while it does, like the desktop. The
 * phone chip carries its name, so the dots follow the name instead of hanging
 * under the icon.
 */

import { Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import { COMMAND_ICONS } from '../../assets/tablerIcons.generated';
import { ACTIVE_SPACE_COLOR, ACTIVE_SPACE_ICON, ACTIVE_SPACE_ID } from '../../spaces/activeProjects';
import { OTHER_SIDEBAR_SPACE_ICON, OTHER_SIDEBAR_SPACE_ID, OTHER_SIDEBAR_SPACE_LABEL } from '../../spaces/otherSpace';
import { tabStatusCounts, type SessionCounts } from '../../contract/grouping';
import type { SpaceRowItem } from '../../spaces/spaceFilter';
import { GhostexPalette, GhostexRadii, GhostexStrokeWidth, SidebarPalette } from '../../theme/palette';
import { inkStyleSheets, useSidebarInk } from './rows';
import { StarGlyph } from './icons';
import StatusDotStack from './StatusDotStack';

/**
 * The Active projects star, first in the row (src/spaces/activeProjects.ts): a short name, since the phone's chips
 * carry one, and the desktop star's yellow.
 */
const ACTIVE_ROW_ITEM: SpaceRowItem = {
  spaceId: ACTIVE_SPACE_ID,
  name: 'Active',
  icon: ACTIVE_SPACE_ICON,
  color: ACTIVE_SPACE_COLOR,
};

const OTHER_ROW_ITEM: SpaceRowItem = {
  spaceId: OTHER_SIDEBAR_SPACE_ID,
  name: OTHER_SIDEBAR_SPACE_LABEL,
  icon: OTHER_SIDEBAR_SPACE_ICON,
  color: '#4f5663',
};

export default function SpaceTabs({
  spaces,
  selectedSpaceId,
  countsBySpaceId,
  onSelect,
  activeProjects = false,
  onActiveProjectsMenu,
  style,
}: {
  /** The machine's own Spaces, in order; Other is appended here. */
  spaces: readonly SpaceRowItem[];
  selectedSpaceId: string;
  /** spaceSessionCounts: what each chip's status dots draw. */
  countsBySpaceId: Readonly<Record<string, SessionCounts>>;
  onSelect: (spaceId: string) => void;
  /** The computer shows the Active projects star (its `sidebarActiveProjects`); it leads the row. */
  activeProjects?: boolean;
  /** A long press on the star: its menu (Remove Active projects), as the desktop's right click. */
  onActiveProjectsMenu?: () => void;
  /** Overrides for the row's own box, e.g. when it shares a line with the workspace tile. */
  style?: StyleProp<ViewStyle>;
}) {
  const items = activeProjects ? [ACTIVE_ROW_ITEM, ...spaces, OTHER_ROW_ITEM] : [...spaces, OTHER_ROW_ITEM];
  const ink = useSidebarInk();
  const styles = spaceStyles(ink);
  // The ring between overlapping dots is drawn in the chip's own card (dark: its active card, as before).
  const ringColor = ink.chipCard;
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
        // The Space being shown has its sessions on screen, so only the other tabs carry status dots (desktop `assemble.rs`).
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
            accessibilityLabel={item.name}
            accessibilityState={{ selected }}
            key={item.spaceId}
            onPress={() => onSelect(item.spaceId)}
            onLongPress={star ? onActiveProjectsMenu : undefined}
            style={[styles.chip, selected ? styles.chipSelected : null]}
          >
            <View style={hasStatus ? styles.iconWithStatus : null}>
              {star ? (
                <StarGlyph size={14} color={ACTIVE_SPACE_COLOR} filled />
              ) : (
                <Icon size={14} color={selected ? styles.labelSelected.color : styles.label.color} />
              )}
            </View>
            <Text ellipsizeMode="tail" numberOfLines={1} style={[styles.label, selected ? styles.labelSelected : null]}>
              {item.name}
            </Text>
            {hasStatus ? (
              <StatusDotStack
                workingCount={counts.workingCount}
                attentionCount={counts.attentionCount}
                backgroundWorkCount={counts.backgroundWorkCount}
                questionCount={counts.questionCount}
                approvalCount={counts.approvalCount}
                ringColor={ringColor}
              />
            ) : null}
            {selected ? <View style={[styles.selectedRail, { backgroundColor: item.color }]} /> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Chip height, and with it the row's: fixed so content cannot resize it. */
const SPACE_CHIP_HEIGHT = 30;

const spaceStyles = inkStyleSheets((ink) =>
  StyleSheet.create({
    /*
     * A horizontal ScrollView takes its height from its content and inherits
     * `flexShrink: 1` from ScrollView's base style, so in a column beside a
     * filling list it is the first thing Yoga squeezes. The row is one chip tall
     * by definition, so it says so and opts out of shrinking.
     */
    scroll: {
      marginTop: 6,
      height: SPACE_CHIP_HEIGHT,
      flexGrow: 0,
      flexShrink: 0,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingRight: 8,
    },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      height: SPACE_CHIP_HEIGHT,
      maxWidth: 180,
      paddingHorizontal: 10,
      borderRadius: GhostexRadii.pill,
      borderWidth: GhostexStrokeWidth,
      borderColor: ink.chipBorder,
      backgroundColor: ink.chipCard,
      overflow: 'hidden',
    },
    chipSelected: {
      backgroundColor: ink.chipSelected,
    },
    label: {
      flexShrink: 1,
      minWidth: 0,
      color: ink.light ? ink.muted : SidebarPalette.MUTED,
      fontSize: 12,
      fontWeight: '600',
    },
    labelSelected: {
      color: ink.light ? ink.text : GhostexPalette.FOREGROUND,
    },
    iconWithStatus: {
      opacity: 0.8,
    },
    /** The Space's own color, drawn under the selected chip like the desktop rail. */
    selectedRail: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: 2,
    },
  }),
);
