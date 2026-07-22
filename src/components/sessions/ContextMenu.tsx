/**
 * Desktop sidebar context-menu clone (sidebar/styles/session-overlays.css
 * .session-context-menu): a fixed 220dp dark popup anchored under a header
 * button — right edge aligned to the anchor, 6dp below it, clamped 12dp from
 * the screen edges. Items are icon + label + optional trailing check, with
 * hover-gray press feedback, 1dp dividers, and danger tinting.
 */

import type { ReactElement } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';

import { SidebarPalette } from '../../theme/palette';

/** Window-coordinate frame of the pressed button (measureInWindow). */
export type MenuAnchor = { x: number; y: number; width: number; height: number };

export type ContextMenuItem =
  | { kind: 'separator'; key: string }
  | { kind: 'label'; key: string; label: string }
  | {
      kind: 'item';
      key: string;
      label: string;
      /** 14dp leading glyph, already tinted (brand agent icons keep tints). */
      icon?: ReactElement;
      /** 14dp leading color swatch circle (collection colors). */
      swatch?: string;
      /** Trailing IconCheck on the currently-selected row. */
      selected?: boolean;
      /** Trailing chevron marking a submenu row. */
      submenu?: boolean;
      destructive?: boolean;
      disabled?: boolean;
      onPress: () => void;
    };

export type ContextMenuProps = {
  visible: boolean;
  anchor: MenuAnchor | null;
  items: ContextMenuItem[];
  onClose: () => void;
};

const MENU_WIDTH = 220;
const EDGE_MARGIN = 12;
const ANCHOR_GAP = 6;

/** Filled 14dp check glyph (desktop IconCheck) drawn with two rotated bars. */
function CheckGlyph({ color }: { color: string }) {
  return (
    <View style={checkStyles.box}>
      <View style={[checkStyles.short, { backgroundColor: color }]} />
      <View style={[checkStyles.long, { backgroundColor: color }]} />
    </View>
  );
}

const checkStyles = StyleSheet.create({
  box: { width: 14, height: 14 },
  short: {
    position: 'absolute',
    left: 1,
    top: 7.2,
    width: 5.4,
    height: 1.8,
    borderRadius: 1,
    transform: [{ rotate: '45deg' }],
  },
  long: {
    position: 'absolute',
    left: 3.6,
    top: 6.1,
    width: 9.8,
    height: 1.8,
    borderRadius: 1,
    transform: [{ rotate: '-50deg' }],
  },
});

export default function ContextMenu({ visible, anchor, items, onClose }: ContextMenuProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  if (!visible || anchor === null) return null;

  const left = Math.min(
    Math.max(EDGE_MARGIN, anchor.x + anchor.width - MENU_WIDTH),
    screenWidth - MENU_WIDTH - EDGE_MARGIN,
  );
  const top = Math.max(EDGE_MARGIN, anchor.y + anchor.height + ANCHOR_GAP);
  const maxHeight = Math.max(120, screenHeight - top - EDGE_MARGIN);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={[styles.menu, { left, top, maxHeight }]}>
          <ScrollView contentContainerStyle={styles.menuContent}>
            {items.map((item) => {
              if (item.kind === 'separator') return <View key={item.key} style={styles.separator} />;
              if (item.kind === 'label') {
                return (
                  <Text key={item.key} style={styles.sectionLabel} numberOfLines={1}>
                    {item.label}
                  </Text>
                );
              }
              return (
                <Pressable
                  key={item.key}
                  accessibilityRole="menuitem"
                  disabled={item.disabled === true}
                  style={({ pressed }) => [
                    styles.item,
                    pressed || item.selected === true ? styles.itemActive : null,
                    item.disabled === true ? styles.itemDisabled : null,
                  ]}
                  onPress={item.onPress}
                >
                  {item.swatch !== undefined ? (
                    <View
                      style={[
                        styles.itemSwatch,
                        item.swatch === 'transparent'
                          ? styles.itemSwatchTransparent
                          : { backgroundColor: item.swatch },
                      ]}
                    />
                  ) : item.icon !== undefined ? (
                    <View style={styles.itemIcon}>{item.icon}</View>
                  ) : null}
                  <Text
                    style={[
                      styles.itemLabel,
                      item.destructive === true ? styles.itemLabelDanger : null,
                    ]}
                    numberOfLines={1}
                  >
                    {item.label}
                  </Text>
                  {item.selected === true ? (
                    <View style={styles.itemCheck}>
                      <CheckGlyph color={SidebarPalette.FOREGROUND} />
                    </View>
                  ) : item.submenu === true ? (
                    <Text style={styles.itemChevron}>›</Text>
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
  },
  menu: {
    position: 'absolute',
    width: MENU_WIDTH,
    backgroundColor: SidebarPalette.MENU_BG,
    borderWidth: 1,
    borderColor: SidebarPalette.MENU_BORDER,
    borderRadius: 0,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.32,
    shadowRadius: 28,
    elevation: 12,
  },
  menuContent: {
    padding: 6,
    gap: 2,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 0,
  },
  itemActive: {
    backgroundColor: SidebarPalette.MENU_HOVER,
  },
  itemDisabled: {
    opacity: 0.42,
  },
  itemIcon: {
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemLabel: {
    flex: 1,
    color: SidebarPalette.FOREGROUND,
    fontSize: 13,
  },
  itemLabelDanger: {
    color: SidebarPalette.MENU_DANGER,
  },
  itemCheck: {
    width: 14,
    height: 14,
  },
  itemChevron: {
    color: SidebarPalette.MUTED,
    fontSize: 14,
    lineHeight: 16,
  },
  itemSwatch: {
    width: 14,
    height: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  itemSwatchTransparent: {
    backgroundColor: 'transparent',
  },
  sectionLabel: {
    color: SidebarPalette.MUTED,
    fontSize: 10,
    fontWeight: '600',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: 8,
    paddingTop: 6,
    paddingBottom: 2,
  },
  separator: {
    height: 1,
    marginVertical: 6,
    marginHorizontal: 4,
    backgroundColor: SidebarPalette.MENU_DIVIDER,
  },
});
