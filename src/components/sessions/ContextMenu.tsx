/**
 * Desktop sidebar context-menu clone (sidebar/styles/session-overlays.css
 * .session-context-menu): a 220dp dark popup that prefers 6dp below its
 * anchor, flips above near the bottom edge, and uses the full safe viewport
 * before scrolling. Items are icon + label + optional trailing check, with
 * hover-gray press feedback, 1dp dividers, and danger tinting.
 */

import { useState, type ReactElement } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SidebarPalette } from '../../theme/palette';

/** Window-coordinate frame of the pressed button (measureInWindow). */
export type MenuAnchor = { x: number; y: number; width: number; height: number };

type ContextMenuAction = {
  kind: 'item';
  key: string;
  label: string;
  /** Trailing IconCheck on the currently-selected row. */
  selected?: boolean;
  /** Trailing chevron marking a submenu row. */
  submenu?: boolean;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

type ContextMenuLeadingVisual =
  | {
      /** 14dp leading glyph, already tinted (brand agent icons keep tints). */
      icon: ReactElement;
      swatch?: never;
    }
  | {
      icon?: never;
      /** 14dp leading color swatch circle (collection colors). */
      swatch: string;
    };

export type ContextMenuItem =
  | { kind: 'separator'; key: string }
  | { kind: 'label'; key: string; label: string }
  | (ContextMenuAction & ContextMenuLeadingVisual);

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
  const safeArea = useSafeAreaInsets();
  const contentKey = items.map((item) => `${item.kind}:${item.key}`).join('|');
  const [measurement, setMeasurement] = useState({ contentKey: '', height: 0 });
  if (!visible || anchor === null) return null;

  const horizontalStart = Math.max(EDGE_MARGIN, safeArea.left);
  const horizontalEnd = screenWidth - Math.max(EDGE_MARGIN, safeArea.right);
  const menuWidth = Math.max(1, Math.min(MENU_WIDTH, horizontalEnd - horizontalStart));
  const left = Math.min(
    Math.max(horizontalStart, anchor.x + anchor.width - menuWidth),
    horizontalEnd - menuWidth,
  );
  const verticalStart = Math.max(EDGE_MARGIN, safeArea.top);
  const verticalEnd = screenHeight - Math.max(EDGE_MARGIN, safeArea.bottom);
  const maxHeight = Math.max(1, verticalEnd - verticalStart);
  const menuHeight =
    measurement.contentKey === contentKey ? Math.min(measurement.height, maxHeight) : 0;
  const belowTop = anchor.y + anchor.height + ANCHOR_GAP;
  const aboveTop = anchor.y - ANCHOR_GAP - menuHeight;
  const top =
    menuHeight === 0
      ? verticalStart
      : belowTop + menuHeight <= verticalEnd
        ? belowTop
        : aboveTop >= verticalStart
          ? aboveTop
          : Math.max(verticalStart, Math.min(belowTop, verticalEnd - menuHeight));

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View
          onLayout={({ nativeEvent }) => {
            const nextHeight = Math.min(nativeEvent.layout.height, maxHeight);
            setMeasurement((current) =>
              current.contentKey === contentKey && Math.abs(current.height - nextHeight) < 0.5
                ? current
                : { contentKey, height: nextHeight },
            );
          }}
          style={[
            styles.menu,
            {
              left,
              top,
              width: menuWidth,
              maxHeight,
              opacity: menuHeight > 0 ? 1 : 0,
            },
          ]}
        >
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
