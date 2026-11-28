/**
 * Session-list context menu: a floating card centred over the sessions list
 * (not anchored to the pressed row), titled with the thing it acts on. It
 * sizes to its content, scrolls once the item list outgrows the safe viewport,
 * and wraps long labels instead of truncating them. Items are icon + label +
 * optional trailing check, with press feedback, 1dp dividers, and danger
 * tinting carried over from the desktop sidebar menu. On the iPhone Duo a menu
 * opened from a header button in the status band or the side bar stands at
 * that button instead (`anchor`), as an iOS pull-down does. A
 * menu opened from a row, or from a control inside a screen's content, stands at
 * that row on every iPhone (`rowAnchor`), the row lifted above the dimmed
 * screen (`lifted`), as an iOS context menu does. For VoiceOver every command, a command's (i), the lifted
 * row and the dimmed screen ("Close menu") are separate elements: no ancestor of them is an accessibility
 * element, which iOS would read as one element holding all of them.
 */

import { AlertOutlet, closeOrCancelAlert } from '../common/dialog/AlertHost';
import { useMemo, Fragment, useState, type ReactElement, type ReactNode } from 'react';
import { useAppearance, type Appearance } from '../../theme/useAppearance';

import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type AccessibilityRole,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ContextMenuCopy } from '../../copy';

import { useFoldCardPlacement } from '../common/foldAvoidance';
import { anchoredMenuOrigin, menuRoomBeside, rowMenuOrigin, type MenuRoom } from '../common/verticalBar/layout';
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
  /** What a press does, for VoiceOver, where the label alone does not say it (a checked row that still acts). */
  hint?: string;
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
  /**
   * A second button at the row's end (the filter menu's "+" on a project row): its own press, which
   * never runs the row's `onPress`.
   */
  secondary?: { icon: ReactElement; label: string; onPress: () => void };
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

export type ContextMenuQuickButton = {
  key: string;
  label: string;
  icon?: ReactElement;
  disabled?: boolean;
  onPress: () => void;
};

export type ContextMenuItem =
  | { kind: 'separator'; key: string }
  | { kind: 'label'; key: string; label: string }
  /** Read-only text about the menu's subject (a program's status message): wrapped, not pressable. */
  | { kind: 'note'; key: string; label: string }
  /** The desktop sidebar menu's small dimmed heading ("Session", "Below"), sentence case. */
  | { kind: 'heading'; key: string; label: string }
  /**
   * A row of icon buttons across the menu (the session menu's Rename, Pin and Voice Call): an icon over a label of up
   * to two lines each, icons only at very large text (`QUICK_ICONS_ONLY_FONT_SCALE`).
   */
  | { kind: 'quick'; key: string; buttons: ContextMenuQuickButton[] }
  /** A row drawn by its menu (the agent menu's project row and machine chips). */
  | { kind: 'custom'; key: string; render: () => ReactElement }
  | (ContextMenuAction & ContextMenuLeadingVisual);

export type ContextMenuProps = {
  visible: boolean;
  /** What the menu is acting on — shown in the card header. */
  title: string;
  /** Optional second header line, e.g. the current submenu. */
  subtitle?: string;
  /** Drawn on the second header line when there is no subtitle (the project menu's computer icons). */
  headerAccessory?: ReactNode;
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
  /**
   * The tallest the card may grow, in points, below the usual cap; its rows scroll inside it. The
   * Unified list's filter menu caps itself like the desktop's filter dropdown (420).
   */
  maxHeight?: number;
  /**
   * The row (window frame) it was opened from by a long press, or the control inside the content it opened
   * from: the menu stands at it on every iPhone and in every pose (`rowMenuOrigin`). Wins over `anchor`.
   */
  rowAnchor?: MenuAnchor;
  /** With `rowAnchor`: the row drawn again above the dimmed screen at its place; a tap on it runs `onPress`. */
  lifted?: { content: ReactNode; accessibilityLabel: string; onPress: () => void };
  /**
   * Drawn in the window of the sheet that shows it (a step of that sheet) instead of a window of its own, so no
   * window opens while the sheet's closes (the New Coordinator form's agent step). `onDismissed` never fires then.
   */
  inline?: boolean;
};

/**
 * From this font scale on, a quick row's buttons show their icons only: four labels side by side no longer fit the
 * card, and a cut label ("Re…") reads worse than none. VoiceOver and TalkBack still read each button's label.
 */
const QUICK_ICONS_ONLY_FONT_SCALE = 1.3;

/** Comfortable reading width; the card shrinks on narrow screens. */
const MENU_MAX_WIDTH = 360;
/** A menu at its row is as wide as the design's menus. */
const ROW_MENU_MAX_WIDTH = 320;
/** A lifted row that runs from edge to edge of the window becomes a card this far in from each edge. */
const LIFT_INSET = 8;
const EDGE_MARGIN = 20;
/** How far an anchored menu keeps off the safe area and the side bar. */
const ANCHORED_MARGIN = 8;
/** Leave the list visibly floating over the sessions list, never full-bleed. */
const MAX_HEIGHT_RATIO = 0.78;

/**
 * A command's role. React Native gives `menuitem` no trait on iOS, so VoiceOver would name no role; iOS's own
 * context menus expose their commands as buttons. Android keeps "menu item".
 */
const COMMAND_ROLE: AccessibilityRole = Platform.OS === 'ios' ? 'button' : 'menuitem';

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
  headerAccessory,
  items,
  onClose,
  onDismissed,
  anchor: liveAnchor,
  maxHeight: cap,
  rowAnchor: liveRowAnchor,
  lifted,
  inline = false,
}: ContextMenuProps) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const { width: screenWidth, height: screenHeight, fontScale } = useWindowDimensions();
  const quickIconsOnly = fontScale >= QUICK_ICONS_ONLY_FONT_SCALE;
  const safeArea = useSafeAreaInsets();
  const bar = useVerticalBarSpace();
  const barEdge = useVerticalBarEdge();
  const placement = useHeaderPlacement();
  const divisions = useFoldDivisions();
  const [openInfo, setOpenInfo] = useState<string | null>(null);
  // The card's height once laid out, for an anchored menu to stay inside the window.
  const [cardHeight, setCardHeight] = useState<number | null>(null);
  // A centred menu (no anchor) half folded like a laptop: below the fold when it fits, else above.
  const foldPlacement = useFoldCardPlacement({ avoidsKeyboard: false });
  // At a row: the card's whole height for these items (the tallest it was laid out at), so a card the
  // placement lets scroll is not measured shorter and moved back next to the row.
  const [rowCard, setRowCard] = useState<{ count: number; height: number } | null>(null);

  // The card stays where it was shown until the Modal is gone: once `visible` turns false the component that
  // owns the menu stops passing an anchor (its open menu is gone), which would put the still fading card in the
  // centre for its last frames (seen on a device). So the last anchor of the open menu is held.
  const [heldAnchor, setHeldAnchor] = useState(liveAnchor);
  if (visible && !sameFrame(liveAnchor, heldAnchor)) setHeldAnchor(liveAnchor);
  const [heldRow, setHeldRow] = useState(liveRowAnchor);
  if (visible && !sameFrame(liveRowAnchor, heldRow)) setHeldRow(liveRowAnchor);
  const rowAnchor = visible ? liveRowAnchor : heldRow;
  const anchor = rowAnchor !== undefined ? undefined : visible ? liveAnchor : heldAnchor;
  const anchoredFrom = anchor !== undefined && placement.kind !== 'top' ? placement.kind : null;
  const windowRoom: MenuRoom = {
    left: Math.max(safeArea.left, bar.left) + ANCHORED_MARGIN,
    top: safeArea.top + ANCHORED_MARGIN,
    right: screenWidth - Math.max(safeArea.right, bar.right) - ANCHORED_MARGIN,
    bottom: screenHeight - safeArea.bottom - ANCHORED_MARGIN,
  };
  // The lifted row is the row's own box, a card inset from the window's edges where the row runs across it
  // (the design's lift); the menu's leading edge lines up with it.
  const lift =
    rowAnchor === undefined
      ? undefined
      : rowAnchor.x <= 1 && rowAnchor.x + rowAnchor.width >= screenWidth - 1
        ? { ...rowAnchor, x: rowAnchor.x + LIFT_INSET, width: rowAnchor.width - 2 * LIFT_INSET }
        : rowAnchor;
  const at = lift ?? anchor;
  // On the button's or row's side of the fold while it is folded; flat, across it.
  const room = at === undefined ? windowRoom : menuRoomBeside(windowRoom, at, divisions);
  const placed = lift !== undefined || anchoredFrom !== null;
  // A centred card keeps the same margin on both sides, the larger inset's, so it stays centred in the
  // window and clear of a notch on either side (landscape has an inset on one side only).
  const sideMargin = Math.max(EDGE_MARGIN, safeArea.left, safeArea.right);
  const horizontalRoom = placed ? room.right - room.left : screenWidth - 2 * sideMargin;
  const menuWidth = Math.max(1, Math.min(lift === undefined ? MENU_MAX_WIDTH : ROW_MENU_MAX_WIDTH, horizontalRoom));
  const verticalRoom = screenHeight - Math.max(EDGE_MARGIN, safeArea.top) - Math.max(EDGE_MARGIN, safeArea.bottom);
  const maxHeight = Math.min(
    cap ?? Number.POSITIVE_INFINITY,
    Math.max(
      1,
      placed
        ? room.bottom - room.top
        : Math.min(verticalRoom * MAX_HEIGHT_RATIO, foldPlacement.maxHeight ?? Number.POSITIVE_INFINITY),
    ),
  );
  const rowCardHeight = rowCard !== null && rowCard.count === items.length ? rowCard.height : null;
  let placedStyle: { position: 'absolute'; left: number; top: number; maxHeight?: number; opacity: number } | null =
    null;
  if (lift !== undefined) {
    const origin = rowMenuOrigin(lift, { width: menuWidth, height: rowCardHeight ?? 0 }, room);
    placedStyle = {
      position: 'absolute',
      left: origin.left,
      top: origin.top,
      maxHeight: origin.maxHeight ?? maxHeight,
      // Shown once its height places it at the row.
      opacity: rowCardHeight === null ? 0 : 1,
    };
  } else if (anchor !== undefined && anchoredFrom !== null) {
    placedStyle = {
      position: 'absolute',
      ...anchoredMenuOrigin(anchor, { width: menuWidth, height: cardHeight ?? 0 }, room, anchoredFrom, barEdge),
      // Shown once its height keeps it inside the window.
      opacity: cardHeight === null ? 0 : 1,
    };
  }
  const onCardLayout =
    lift !== undefined
      ? (height: number) =>
          setRowCard((last) =>
            last !== null && last.count === items.length && last.height >= height
              ? last
              : { count: items.length, height },
          )
      : anchoredFrom !== null
        ? setCardHeight
        : null;

  // The Modal stays mounted while `visible` is false (it renders nothing then,
  // exactly like the old early return) so `onDismiss` can still fire after a
  // close instead of being unmounted out from under the dismissal.
  /* A plain View keeps the menu's commands separate for VoiceOver. */
  const content = (
    <View style={[styles.backdrop, !placed ? foldPlacement.style : null]} onAccessibilityEscape={onClose}>
      {/* The dimmed screen behind the card closes the menu; presses on the card never reach it. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        accessibilityRole="button"
        accessibilityLabel={ContextMenuCopy.close}
        onPress={onClose}
      />
      {lift !== undefined && rowAnchor !== undefined && lifted !== undefined ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={lifted.accessibilityLabel}
          onPress={lifted.onPress}
          style={[styles.lifted, { left: lift.x, top: lift.y, width: lift.width, height: lift.height }]}
        >
          {/* The row's content stays where it was; only its card is inset. */}
          <View style={[styles.liftedContent, { marginLeft: rowAnchor.x - lift.x, width: rowAnchor.width }]}>
            {lifted.content}
          </View>
        </Pressable>
      ) : null}
      <View
        style={[styles.menu, { width: menuWidth, maxHeight }, placedStyle]}
        onLayout={onCardLayout === null ? foldPlacement.onCardLayout : (event) => onCardLayout(event.nativeEvent.layout.height)}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle} numberOfLines={2}>
            {title}
          </Text>
          {subtitle !== undefined && subtitle.length > 0 ? (
            <Text style={styles.headerSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : headerAccessory !== undefined && headerAccessory !== null ? (
            <View style={{ flexDirection: 'row' }}>{headerAccessory}</View>
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
            if (item.kind === 'custom') return <Fragment key={item.key}>{item.render()}</Fragment>;
            if (item.kind === 'quick') {
              return (
                <View key={item.key} style={styles.quickRow}>
                  {item.buttons.map((button) => (
                    <Pressable
                      key={button.key}
                      accessibilityRole={COMMAND_ROLE}
                      accessibilityLabel={button.label}
                      accessibilityState={{ disabled: button.disabled === true }}
                      disabled={button.disabled === true}
                      style={({ pressed }) => [
                        styles.quickButton,
                        quickIconsOnly ? styles.quickButtonIconOnly : null,
                        pressed ? styles.itemActive : null,
                        button.disabled === true ? styles.itemDisabled : null,
                      ]}
                      onPress={button.onPress}
                    >
                      {button.icon !== undefined ? <View style={styles.quickIcon}>{button.icon}</View> : null}
                      {quickIconsOnly ? null : (
                        <Text style={styles.quickLabel} numberOfLines={2}>
                          {button.label}
                        </Text>
                      )}
                    </Pressable>
                  ))}
                </View>
              );
            }
            const infoOpen = item.info !== undefined && openInfo === item.key;
            const command = (
              <Pressable
                accessibilityHint={item.hint ?? item.trailingIconLabel}
                accessibilityRole={COMMAND_ROLE}
                accessibilityState={{
                  disabled: item.disabled === true,
                  selected: item.selected === true,
                }}
                disabled={item.disabled === true}
                style={({ pressed }) => [
                  styles.item,
                  item.info !== undefined ? styles.itemBesideInfo : null,
                  pressed || item.selected === true ? styles.itemActive : null,
                  item.disabled === true ? styles.itemDisabled : null,
                ]}
                onPress={item.onPress}
              >
                {item.swatch !== undefined ? (
                  <View
                    style={[
                      styles.itemSwatch,
                      item.swatch === 'transparent' ? styles.itemSwatchTransparent : { backgroundColor: item.swatch },
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
                {item.secondary !== undefined ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={item.secondary.label}
                    hitSlop={10}
                    style={({ pressed }) => [styles.itemSecondary, pressed ? styles.itemActive : null]}
                    onPress={item.secondary.onPress}
                  >
                    {item.secondary.icon}
                  </Pressable>
                ) : null}
                {item.selected === true && item.selectedPresentation !== 'emphasis' ? (
                  <View style={styles.itemCheck}>
                    <CheckGlyph color={appearance.foreground} />
                  </View>
                ) : item.submenu === true ? (
                  <Text style={styles.itemChevron}>›</Text>
                ) : null}
              </Pressable>
            );
            return (
              <Fragment key={item.key}>
                {item.info === undefined ? (
                  command
                ) : (
                  // The (i) stands beside the command, not inside it: inside, iOS reads both as one element with
                  // the command's action only, and the explanation cannot be reached.
                  <View style={styles.itemRow}>
                    {command}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`About ${item.label}`}
                      accessibilityState={{ expanded: infoOpen }}
                      style={styles.itemInfo}
                      onPress={() => setOpenInfo(infoOpen ? null : item.key)}
                    >
                      <InfoGlyph size={15} color={infoOpen ? appearance.foreground : appearance.muted} />
                    </Pressable>
                  </View>
                )}
                {infoOpen ? <Text style={styles.itemInfoText}>{item.info}</Text> : null}
              </Fragment>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
  if (inline) return visible ? content : null;
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={closeOrCancelAlert(onClose)}
      onDismiss={onDismissed}
    >
      {content}
      <AlertOutlet active={visible} />
    </Modal>
  );
}

const createStyles = (appearance: Appearance) => StyleSheet.create({
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  menu: {
    backgroundColor: appearance.card,
    borderWidth: 1,
    borderColor: appearance.border,
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.32,
    shadowRadius: 28,
    elevation: 12,
  },
  /** The lifted row: the row on a card above the dimmed screen. */
  lifted: {
    position: 'absolute',
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: appearance.card,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.5,
    shadowRadius: 15,
    elevation: 10,
  },
  liftedContent: { height: '100%', pointerEvents: 'none' },
  header: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: appearance.border,
    gap: 2,
  },
  headerTitle: {
    color: appearance.foreground,
    fontSize: 14,
    fontWeight: '600',
  },
  headerSubtitle: {
    color: appearance.muted,
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
  /** A command with an (i): the command and the (i) side by side, each its own element. */
  itemRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  itemBesideInfo: {
    flex: 1,
    paddingRight: 0,
  },
  quickRow: {
    flexDirection: 'row',
    gap: 6,
    paddingBottom: 6,
  },
  quickButton: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingTop: 9,
    paddingBottom: 7,
    paddingHorizontal: 2,
    borderRadius: 8,
    backgroundColor: appearance.cardActive,
  },
  quickButtonIconOnly: {
    paddingVertical: 11,
  },
  quickIcon: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Up to two lines, so a longer name ("Search Conversation", "Files & Links") wraps instead of being cut.
  quickLabel: {
    color: appearance.foreground,
    fontSize: 11,
    lineHeight: 14,
    textAlign: 'center',
  },
  itemActive: {
    backgroundColor: appearance.cardActive,
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
    color: appearance.foreground,
    fontSize: 13,
    lineHeight: 18,
  },
  itemSuffix: {
    color: appearance.muted,
    fontSize: 12,
    lineHeight: 18,
    maxWidth: 120,
  },
  itemLabelSelected: {
    color: appearance.foreground,
    fontWeight: '600',
  },
  itemLabelDanger: {
    color: appearance.danger,
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
  /** The (i): 44 pt wide over the row's full height (HIG target), its glyph where it stood inside the row. */
  itemInfo: {
    width: 44,
    paddingRight: 10,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  itemSecondary: {
    marginLeft: 8,
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemInfoText: {
    color: appearance.foreground,
    opacity: 0.8,
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: 12,
    paddingTop: 2,
    paddingBottom: 8,
  },
  itemChevron: {
    color: appearance.muted,
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
    color: appearance.muted,
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
    color: appearance.foreground,
    opacity: 0.6,
    fontSize: 11,
    lineHeight: 14,
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 2,
  },
  note: {
    color: appearance.foreground,
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
    backgroundColor: appearance.border,
  },
});
