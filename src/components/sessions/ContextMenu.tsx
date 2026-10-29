/**
 * Session-list context menu: a floating card centred over the sessions list
 * (not anchored to the pressed row), titled with the thing it acts on. It
 * sizes to its content, scrolls once the item list outgrows the safe viewport,
 * and wraps long labels instead of truncating them. Items are icon + label +
 * optional trailing check, with press feedback, 1dp dividers, and danger
 * tinting carried over from the desktop sidebar menu. On the iPhone Duo a menu
 * opened from a header button in the status band or the side bar stands at
 * that button instead (`anchor`, F3 2026-10-26), as an iOS pull-down does.
 */

import { Fragment, useState, type ReactElement } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GhostexPalette, SidebarPalette } from '../../theme/palette';
import { anchoredMenuOrigin, menuRoomBeside, type MenuRoom } from '../common/verticalBar/layout';
import {
  useFoldDivisions,
  useHeaderPlacement,
  useVerticalBarEdge,
  useVerticalBarSpace,
} from '../common/verticalBar/VerticalBarArea';
import { InfoGlyph } from './icons';

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
  /**
   * Text behind an (i) at the row's end. The phone has no hover, so a tap on the (i) shows it
   * under the row (and a second tap hides it); a tap on the row still runs `onPress`. The desktop
   * shows the same text as the (i)'s tooltip (gx-core `MenuItem::info`).
   */
  info?: string;
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
  /** Read-only text about the menu's subject (a program's status message): wrapped, not pressable. */
  | { kind: 'note'; key: string; label: string }
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
  /**
   * The header button it opened from (window frame). On the iPhone Duo, where that button stands in the
   * status band or the side bar, the menu stands at it; elsewhere it stays centred.
   */
  anchor?: MenuAnchor;
};

/** Comfortable reading width; the card shrinks on narrow screens. */
const MENU_MAX_WIDTH = 360;
const EDGE_MARGIN = 20;
/** How far an anchored menu keeps off the safe area and the side bar. */
const ANCHORED_MARGIN = 8;
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

function sameFrame(a: MenuAnchor | undefined, b: MenuAnchor | undefined): boolean {
  return (
    a === b ||
    (a !== undefined && b !== undefined && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height)
  );
}

export default function ContextMenu({
  visible,
  title,
  subtitle,
  items,
  onClose,
  onDismissed,
  anchor: liveAnchor,
}: ContextMenuProps) {
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const safeArea = useSafeAreaInsets();
  const bar = useVerticalBarSpace();
  const barEdge = useVerticalBarEdge();
  const placement = useHeaderPlacement();
  const divisions = useFoldDivisions();
  const [openInfo, setOpenInfo] = useState<string | null>(null);
  // The card's height once laid out, for an anchored menu to stay inside the window.
  const [cardHeight, setCardHeight] = useState<number | null>(null);

  // The card stays where it was shown until the Modal is gone: once `visible` turns false the owner of the
  // menu stops passing an anchor (its open menu is gone), which would put the still fading card in the
  // centre for its last frames (owner finding 2026-10-28). So the last anchor of the open menu is held.
  const [heldAnchor, setHeldAnchor] = useState(liveAnchor);
  if (visible && !sameFrame(liveAnchor, heldAnchor)) setHeldAnchor(liveAnchor);
  const anchor = visible ? liveAnchor : heldAnchor;
  const anchoredFrom = anchor !== undefined && placement.kind !== 'top' ? placement.kind : null;
  const windowRoom: MenuRoom = {
    left: Math.max(safeArea.left, bar.left) + ANCHORED_MARGIN,
    top: safeArea.top + ANCHORED_MARGIN,
    right: screenWidth - Math.max(safeArea.right, bar.right) - ANCHORED_MARGIN,
    bottom: screenHeight - safeArea.bottom - ANCHORED_MARGIN,
  };
  // On the button's side of the fold while it is folded (FL-DUO-03, owner B1, 2026-10-27); flat, across it.
  const room = anchor === undefined ? windowRoom : menuRoomBeside(windowRoom, anchor, divisions);
  const horizontalRoom =
    anchoredFrom === null
      ? screenWidth - Math.max(EDGE_MARGIN, safeArea.left) - Math.max(EDGE_MARGIN, safeArea.right)
      : room.right - room.left;
  const menuWidth = Math.max(1, Math.min(MENU_MAX_WIDTH, horizontalRoom));
  const verticalRoom = screenHeight - Math.max(EDGE_MARGIN, safeArea.top) - Math.max(EDGE_MARGIN, safeArea.bottom);
  const maxHeight = Math.max(1, anchoredFrom === null ? verticalRoom * MAX_HEIGHT_RATIO : room.bottom - room.top);
  const anchoredStyle =
    anchor === undefined || anchoredFrom === null
      ? null
      : {
          position: 'absolute' as const,
          ...anchoredMenuOrigin(anchor, { width: menuWidth, height: cardHeight ?? 0 }, room, anchoredFrom, barEdge),
          // Shown once its height keeps it inside the window.
          opacity: cardHeight === null ? 0 : 1,
        };

  // The Modal stays mounted while `visible` is false (it renders nothing then,
  // exactly like the old early return) so `onDismiss` can still fire after a
  // close instead of being unmounted out from under the dismissal.
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} onDismiss={onDismissed}>
      {/*
        Centred in the room the width above was taken from, so the card stays clear of side insets; an
        anchored card is placed in window points, so the backdrop keeps no padding then.
      */}
      <Pressable
        style={[
          styles.backdrop,
          anchoredFrom === null
            ? { paddingLeft: Math.max(EDGE_MARGIN, safeArea.left), paddingRight: Math.max(EDGE_MARGIN, safeArea.right) }
            : null,
        ]}
        onPress={onClose}
      >
        {/* Swallows presses on the card itself so only the backdrop closes. */}
        <Pressable
          style={[styles.menu, { width: menuWidth, maxHeight }, anchoredStyle]}
          onLayout={anchoredFrom === null ? undefined : (event) => setCardHeight(event.nativeEvent.layout.height)}
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
          <ScrollView style={styles.menuScroll} contentContainerStyle={styles.menuContent} bounces={false}>
            {items.map((item) => {
              if (item.kind === 'separator') return <View key={item.key} style={styles.separator} />;
              if (item.kind === 'label') {
                return (
                  <Text key={item.key} style={styles.sectionLabel} numberOfLines={1}>
                    {item.label}
                  </Text>
                );
              }
              if (item.kind === 'note') {
                return (
                  <Text key={item.key} style={styles.note} numberOfLines={4} selectable>
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
              const infoOpen = item.info !== undefined && openInfo === item.key;
              return (
                <Fragment key={item.key}>
                  <Pressable
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
                    {item.info !== undefined ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`About ${item.label}`}
                        accessibilityState={{ expanded: infoOpen }}
                        hitSlop={10}
                        style={styles.itemInfo}
                        onPress={() => setOpenInfo(infoOpen ? null : item.key)}
                      >
                        <InfoGlyph size={15} color={infoOpen ? SidebarPalette.FOREGROUND : SidebarPalette.MUTED} />
                      </Pressable>
                    ) : null}
                    {item.selected === true && item.selectedPresentation !== 'emphasis' ? (
                      <View style={styles.itemCheck}>
                        <CheckGlyph color={SidebarPalette.FOREGROUND} />
                      </View>
                    ) : item.submenu === true ? (
                      <Text style={styles.itemChevron}>›</Text>
                    ) : null}
                  </Pressable>
                  {infoOpen ? <Text style={styles.itemInfoText}>{item.info}</Text> : null}
                </Fragment>
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
  itemInfo: {
    marginLeft: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemInfoText: {
    color: SidebarPalette.FOREGROUND,
    opacity: 0.8,
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: 12,
    paddingTop: 2,
    paddingBottom: 8,
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
  note: {
    color: SidebarPalette.FOREGROUND,
    opacity: 0.8,
    fontSize: 13,
    lineHeight: 18,
    paddingHorizontal: 10,
    paddingTop: 4,
    paddingBottom: 4,
  },
  separator: {
    height: 1,
    marginVertical: 6,
    marginHorizontal: 4,
    backgroundColor: SidebarPalette.MENU_DIVIDER,
  },
});
