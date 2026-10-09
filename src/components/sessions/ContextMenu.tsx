/**
 * Session-list context menu: a floating card centred over the sessions list
 * (not anchored to the pressed row), titled with the thing it acts on. It
 * sizes to its content, scrolls once the item list outgrows the safe viewport,
 * and wraps long labels instead of truncating them. Items are icon + label +
 * optional trailing check, with press feedback, 1dp dividers, and danger
 * tinting carried over from the desktop sidebar menu.
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GhostexPalette, SidebarPalette } from '../../theme/palette';

/** Window-coordinate frame of the pressed button (measureInWindow). */
export type MenuAnchor = { x: number; y: number; width: number; height: number };

type ContextMenuAction = {
  kind: 'item';
  key: string;
  label: string;
  /** Trailing IconCheck on the currently-selected row. */
  selected?: boolean;
  /** Selected agent rows use brighter, bolder text instead of a check. */
  selectedPresentation?: 'check' | 'emphasis';
  /** Optional right-aligned informational glyph. */
  trailingIcon?: ReactElement;
  trailingIconLabel?: string;
  /** Dimmed text after the label (what a Link to row is linked to). */
  suffix?: string;
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
    }
  | {
      /** A row the desktop draws without an icon (a collection in Add to Group). */
      icon?: never;
      swatch?: never;
    };

export type ContextMenuItem =
  | { kind: 'separator'; key: string }
  | { kind: 'label'; key: string; label: string }
  /** The desktop sidebar menu's small dimmed heading ("Session", "Below"), sentence case. */
  | { kind: 'heading'; key: string; label: string }
  | (ContextMenuAction & ContextMenuLeadingVisual);

export type ContextMenuProps = {
  visible: boolean;
  /** What the menu is acting on — shown in the card header. */
  title: string;
  /** Optional second header line, e.g. the current submenu. */
  subtitle?: string;
  items: ContextMenuItem[];
  onClose: () => void;
  /**
   * Fires once the modal's dismissal has fully completed. iOS only — this is
   * RN `Modal`'s `onDismiss`, which has no Android counterpart. Callers need
   * it because a native presentation started while the modal is still
   * dismissing (the document picker, above all) either throws or never
   * settles, so such work has to wait for the dismissal to finish.
   */
  onDismissed?: () => void;
};

/** Comfortable reading width; the card shrinks on narrow screens. */
const MENU_MAX_WIDTH = 360;
const EDGE_MARGIN = 20;
/** Leave the list visibly floating over the sessions list, never full-bleed. */
const MAX_HEIGHT_RATIO = 0.78;

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

export default function ContextMenu({
  visible,
  title,
  subtitle,
  items,
  onClose,
  onDismissed,
}: ContextMenuProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();

  const horizontalRoom =
    screenWidth - Math.max(EDGE_MARGIN, safeArea.left) - Math.max(EDGE_MARGIN, safeArea.right);
  const menuWidth = Math.max(1, Math.min(MENU_MAX_WIDTH, horizontalRoom));
  const verticalRoom =
    screenHeight - Math.max(EDGE_MARGIN, safeArea.top) - Math.max(EDGE_MARGIN, safeArea.bottom);
  const maxHeight = Math.max(1, verticalRoom * MAX_HEIGHT_RATIO);

  // The Modal stays mounted while `visible` is false (it renders nothing then,
  // exactly like the old early return) so `onDismiss` can still fire after a
  // close instead of being unmounted out from under the dismissal.
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onDismiss={onDismissed}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Swallows presses on the card itself so only the backdrop closes. */}
        <Pressable
          style={[styles.menu, { width: menuWidth, maxHeight }]}
          onPress={() => {
            /* card body is not a dismiss target */
          }}
        >
          <View style={styles.header}>
            <Text style={styles.headerTitle} numberOfLines={2}>
              {title}
            </Text>
            {subtitle !== undefined && subtitle.length > 0 ? (
              <Text style={styles.headerSubtitle} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
          <ScrollView
            style={styles.menuScroll}
            contentContainerStyle={styles.menuContent}
            bounces={false}
          >
            {items.map((item) => {
              if (item.kind === 'separator') return <View key={item.key} style={styles.separator} />;
              if (item.kind === 'label') {
                return (
                  <Text key={item.key} style={styles.sectionLabel} numberOfLines={1}>
                    {item.label}
                  </Text>
                );
              }
              if (item.kind === 'heading') {
                return (
                  <Text key={item.key} style={styles.heading} numberOfLines={1}>
                    {item.label}
                  </Text>
                );
              }
              return (
                <Pressable
                  key={item.key}
                  accessibilityHint={item.trailingIconLabel}
                  accessibilityRole="menuitem"
                  accessibilityState={{
                    disabled: item.disabled === true,
                    selected: item.selected === true,
                  }}
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
                      item.selected === true && item.selectedPresentation === 'emphasis'
                        ? styles.itemLabelSelected
                        : null,
                      item.destructive === true ? styles.itemLabelDanger : null,
                    ]}
                  >
                    {item.label}
                  </Text>
                  {item.suffix !== undefined ? (
                    <Text style={styles.itemSuffix} numberOfLines={1}>
                      {item.suffix}
                    </Text>
                  ) : null}
                  {item.trailingIcon !== undefined ? (
                    <View style={styles.itemTrailingIcon}>{item.trailingIcon}</View>
                  ) : null}
                  {item.selected === true && item.selectedPresentation !== 'emphasis' ? (
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
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  menu: {
    backgroundColor: SidebarPalette.MENU_BG,
    borderWidth: 1,
    borderColor: SidebarPalette.MENU_BORDER,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.32,
    shadowRadius: 28,
    elevation: 12,
  },
  header: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: SidebarPalette.MENU_DIVIDER,
    gap: 2,
  },
  headerTitle: {
    color: SidebarPalette.FOREGROUND,
    fontSize: 14,
    fontWeight: '600',
  },
  headerSubtitle: {
    color: SidebarPalette.MUTED,
    fontSize: 11,
  },
  menuContent: {
    paddingHorizontal: 8,
    paddingVertical: 10,
    gap: 2,
  },
  menuScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
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
    lineHeight: 18,
  },
  itemSuffix: {
    color: SidebarPalette.MUTED,
    fontSize: 12,
    lineHeight: 18,
    maxWidth: 120,
  },
  itemLabelSelected: {
    color: GhostexPalette.FOREGROUND,
    fontWeight: '600',
  },
  itemLabelDanger: {
    color: SidebarPalette.MENU_DANGER,
  },
  itemCheck: {
    width: 14,
    height: 14,
  },
  itemTrailingIcon: {
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.58,
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
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 2,
  },
  /** Desktop heading row: 11px at 60% opacity, no hover (native_sidebar/menus.rs). */
  heading: {
    color: SidebarPalette.FOREGROUND,
    opacity: 0.6,
    fontSize: 11,
    lineHeight: 14,
    paddingHorizontal: 10,
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
