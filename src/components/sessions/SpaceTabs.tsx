/**
 * Space row, the phone's counterpart to the desktop sidebar's Space switcher
 * (packages/core-ui/space-filter-row.tsx): the selected machine's saved
 * sidebar filters in their manual order, with the built-in "Other" view last.
 *
 * There is no "All Projects" view any more — Other shows exactly what no Space
 * claims (src/spaces/otherSpace.ts) — so the row is always a complete cover of
 * the machine's projects. The phone has no overflow menu: the row scrolls
 * horizontally instead, since a chip that is off-screen is still one swipe away.
 */

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { COMMAND_ICONS } from '../../assets/tablerIcons.generated';
import {
  OTHER_SIDEBAR_SPACE_ICON,
  OTHER_SIDEBAR_SPACE_ID,
  OTHER_SIDEBAR_SPACE_LABEL,
} from '../../spaces/otherSpace';
import type { SpaceRowItem } from '../../spaces/spaceFilter';
import { GhostexPalette, GhostexRadii, GhostexStrokeWidth, SidebarPalette } from '../../theme/palette';

const OTHER_ROW_ITEM: SpaceRowItem = {
  spaceId: OTHER_SIDEBAR_SPACE_ID,
  name: OTHER_SIDEBAR_SPACE_LABEL,
  icon: OTHER_SIDEBAR_SPACE_ICON,
  color: '#4f5663',
};

export default function SpaceTabs({
  spaces,
  selectedSpaceId,
  onSelect,
}: {
  /** The machine's own Spaces, in order; Other is appended here. */
  spaces: readonly SpaceRowItem[];
  selectedSpaceId: string;
  onSelect: (spaceId: string) => void;
}) {
  const items = [...spaces, OTHER_ROW_ITEM];
  return (
    <ScrollView
      contentContainerStyle={styles.row}
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.scroll}
    >
      {items.map((item) => {
        const selected = item.spaceId === selectedSpaceId;
        const Icon = COMMAND_ICONS[item.icon] ?? COMMAND_ICONS.stack;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityLabel={item.name}
            accessibilityState={{ selected }}
            key={item.spaceId}
            onPress={() => onSelect(item.spaceId)}
            style={[styles.chip, selected ? styles.chipSelected : null]}
          >
            <Icon
              size={14}
              color={selected ? GhostexPalette.FOREGROUND : SidebarPalette.MUTED}
            />
            <Text
              ellipsizeMode="tail"
              numberOfLines={1}
              style={[styles.label, selected ? styles.labelSelected : null]}
            >
              {item.name}
            </Text>
            {selected ? (
              <View style={[styles.selectedRail, { backgroundColor: item.color }]} />
            ) : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

/** Chip height, and with it the row's: fixed so content cannot resize it. */
const SPACE_CHIP_HEIGHT = 30;

const styles = StyleSheet.create({
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
    borderColor: SidebarPalette.HEADER_BUTTON_BORDER,
    backgroundColor: SidebarPalette.HEADER_BUTTON_BG,
    overflow: 'hidden',
  },
  chipSelected: {
    backgroundColor: GhostexPalette.CARD_ACTIVE,
  },
  label: {
    flexShrink: 1,
    minWidth: 0,
    color: SidebarPalette.MUTED,
    fontSize: 12,
    fontWeight: '600',
  },
  labelSelected: {
    color: GhostexPalette.FOREGROUND,
  },
  /** The Space's own color, drawn under the selected chip like the desktop rail. */
  selectedRail: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
  },
});
