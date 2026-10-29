/**
 * The app's frame for the iPhone Duo's system bars (layout.ts): keeps the screens beside the side
 * status bar, tells the screens where their header goes (`useHeaderPlacement`), and draws the focused
 * screen's header buttons in the side bar region (`useRailButtons`), above the keyboard and off the
 * fold's division, moving those that do not fit into the screen's "More options" menu
 * (`useRailOverflow`). A React Native `Modal` is a window of its own, so its content applies
 * `useVerticalBarSpace()` itself.
 *
 * The bar regions come from the native side (`observeBarLayout`), which reports each change itself:
 * a fold, an unfold, a rotation, or status items moving (a Live Activity lowers the side ones). The
 * screens appear once the system has reported the window's bars, so no screen is first laid out
 * with a header placement the system did not report (owner, 2026-10-26: nothing may jump).
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewInstance,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { GhostexNative, type BarLayout } from '../../../../modules/ghostex-native/src';
import type { FoldDivision, WindowRect } from '../../../../modules/ghostex-native/src/GhostexNative.types';
import { logAppEvent } from '../../../app/appLog';
import { GhostexPalette } from '../../../theme/palette';
import { useAppearance } from '../../../theme/useAppearance';
import type { ContextMenuItem } from '../../sessions/ContextMenu';
import { useKeyboardFrame } from '../keyboard/keyboardFrame';
import { keyboardHeightForWindow } from '../keyboard/keyboardTop';
import { measureInWindow } from '../measureInWindow';
import { useBarGeometryStore } from './barGeometry';
import {
  NO_BAR_INSETS,
  RAIL_FIT,
  TOP_PLACEMENT,
  bandSplit,
  chromeLayout,
  headerPlacement,
  keyboardHeightFor,
  liveMenuAnchor,
  railButtonFrame,
  railContentTop,
  railHitSlop,
  railLayoutFor,
  railSegments,
  railSplit,
  railStepOffsets,
  reservedKeyboardTop,
  scrollToBarEdges,
  twoColumnWindow,
  verticalBarInsets,
  windowSizeKey,
  type BandButtons,
  type HeaderPlacement,
  type HorizontalInsets,
  type LiveBarLayout,
  type ScrollEdges,
  type StoredBarLayouts,
} from './layout';
import { RailContext, type RailButtons, type RailEntry, type RailSlot } from './railSlot';

export { useRailButtons, type RailButtons, type RailEntry } from './railSlot';

/** A header button in the side bar: round, as the system's own vertical bar items (approved mockup). */
export const RAIL_BUTTON_SIZE = RAIL_FIT.size;
/** The rail buttons' glyph size, as in the header. */
const RAIL_ICON_SIZE = 22;
/** The extent asked for the top bar region: a standard bar's height. */
const TOP_BAR_EXTENT = 44;

export type VerticalBarSpace = {
  readonly left: number;
  readonly right: number;
  /** For a full-window container whose own background should still reach under the bar. */
  readonly padding: ViewStyle;
  /** For content inside a container that keeps its own horizontal padding. */
  readonly margin: ViewStyle;
};

function spaceFor(left: number, right: number): VerticalBarSpace {
  return {
    left,
    right,
    padding: { paddingLeft: left, paddingRight: right },
    margin: { marginLeft: left, marginRight: right },
  };
}

/**
 * F4 (2026-10-26): a screen's top row inside the content column whose background runs on under the side
 * bar to the window edge, as an iOS bar's does, while its controls keep `padding` from the content edge.
 */
export function barBackgroundToEdges(space: VerticalBarSpace, padding: number): ViewStyle {
  return {
    marginLeft: -space.left,
    marginRight: -space.right,
    paddingLeft: padding + space.left,
    paddingRight: padding + space.right,
  };
}

export type PaddingEdge = 'paddingTop' | 'paddingBottom' | 'paddingLeft' | 'paddingRight';

/** A style's own padding on one edge: that edge's, else its axis' (vertical or horizontal), else `padding`. */
export function stylePadding(style: StyleProp<ViewStyle>, edge: PaddingEdge): number {
  const flat = StyleSheet.flatten(style) ?? {};
  const axis = edge === 'paddingTop' || edge === 'paddingBottom' ? flat.paddingVertical : flat.paddingHorizontal;
  const value = flat[edge] ?? axis ?? flat.padding ?? 0;
  return typeof value === 'number' ? value : 0;
}

const NO_BAR_SPACE = spaceFor(NO_BAR_INSETS.left, NO_BAR_INSETS.right);
const NO_STORED_LAYOUTS: StoredBarLayouts = Object.freeze({});

const SpaceContext = createContext<VerticalBarSpace>(NO_BAR_SPACE);
const PlacementContext = createContext<HeaderPlacement>(TOP_PLACEMENT);
/** How many of the focused screen's rail buttons stay in the rail (all while there is room). */
const RailShownContext = createContext<number>(Number.POSITIVE_INFINITY);
/** The window frame of the focused screen's rail button with a key, while the side bar shows it. */
const RailFrameContext = createContext<(key: string) => WindowRect | null>(() => null);

/**
 * Window facts the screens' chrome follows: where a top row starts in the side bar's poses (F1), whether
 * Settings shows two columns (F2), the side the system stands its bar on (F3's menus) and the fold's
 * divisions (B1's menus).
 */
type WindowChrome = {
  readonly railContentTop: number;
  readonly twoColumns: boolean;
  readonly edge: BarLayout['edge'];
  readonly divisions: readonly FoldDivision[] | undefined;
};
const ChromeContext = createContext<WindowChrome>({
  railContentTop: 0,
  twoColumns: false,
  edge: undefined,
  divisions: undefined,
});

/** The vertical bar's insets for content that renders outside `VerticalBarArea` (modals). */
export function useVerticalBarSpace(): VerticalBarSpace {
  return useContext(SpaceContext);
}

/**
 * FL-LAY-05 for a scroll view: its own style and its content's padding, so it spans the window under the
 * side bar while its content keeps `contentStyle`'s own horizontal padding plus the side bar's insets.
 * `insets` when only some of them reach it (Settings in two columns). Pass a StyleSheet entry and
 * memoized insets, so the result keeps its identity between renders. Nothing changes without a side bar.
 */
export function useScrollToBarEdges(
  contentStyle?: StyleProp<ViewStyle>,
  insets?: HorizontalInsets | null,
): ScrollEdges {
  const bar = useVerticalBarSpace();
  const space = insets ?? bar;
  return useMemo(
    () =>
      scrollToBarEdges(space, {
        left: stylePadding(contentStyle, 'paddingLeft'),
        right: stylePadding(contentStyle, 'paddingRight'),
      }),
    [space, contentStyle],
  );
}

/** Where this window puts a screen's header: on top as before, in the status band, or in the side bar. */
export function useHeaderPlacement(): HeaderPlacement {
  return useContext(PlacementContext);
}

/**
 * The top padding of a screen's top row: in the side bar's poses below the system's top layout margin
 * (F1, 2026-10-26: no row touches the window's top edge), elsewhere the safe area as before.
 */
export function useContentTop(): number {
  const placement = useHeaderPlacement();
  const { top } = useSafeAreaInsets();
  const { railContentTop: railTop } = useContext(ChromeContext);
  return placement.kind === 'rail' ? railTop : top;
}

/** Whether Settings shows its list and the open page side by side (owner decision F2, 2026-10-26). */
export function useTwoColumns(): boolean {
  return useContext(ChromeContext).twoColumns;
}

/** The side the system stands its vertical bar on, while it does. */
export function useVerticalBarEdge(): BarLayout['edge'] {
  return useContext(ChromeContext).edge;
}

/**
 * The fold's division regions in window points (FL-DUO-03, owner B1, 2026-10-27), where the system has
 * them, active (half folded) or not (flat).
 */
export function useFoldDivisions(): readonly FoldDivision[] | undefined {
  return useContext(ChromeContext).divisions;
}

/**
 * The rail buttons that have no room above the keyboard and off the fold's division, for the screen's
 * "More options" menu (owner decisions 2026-10-26 and B1); empty while all of them fit or the header is
 * not in the rail.
 */
export function useRailOverflow(buttons: RailButtons, active: boolean): readonly RailEntry[] {
  const shown = useContext(RailShownContext);
  return useMemo(
    () => (active ? railSplit(buttons.entries, shown, buttons.pinned).menu : []),
    [active, buttons, shown],
  );
}

/** Which of a header's buttons stand in its band row, and the entries that moved into its "More options" menu. */
export type BandOverflow = { readonly shows: (key: string) => boolean; readonly menu: readonly RailEntry[] };

const SHOWS_ALL = (): boolean => true;
const NO_BAND_OVERFLOW: BandOverflow = Object.freeze({ shows: SHOWS_ALL, menu: [] });

/**
 * The band row's overflow (owner, 2026-10-27, §12 "1b"): the header buttons (`buttons`, the screen's rail
 * entries, its "More options" last) that do not fit in `room` points across the row move into the
 * screen's "More options" menu, last first, as the rail's do; Back (`pinned`) and the "…" stay. Without
 * `active` (a header on top, or in the side bar) all of them show and none moves.
 */
export function useBandOverflow(buttons: RailButtons, room: number, fit: BandButtons, active: boolean): BandOverflow {
  const { size, gap } = fit;
  return useMemo(() => {
    if (!active) return NO_BAND_OVERFLOW;
    const { row, menu } = bandSplit(room, buttons.entries, buttons.pinned, buttons.moreMenu, { size, gap });
    const keys = new Set(row.map((entry) => entry.key));
    return { shows: (key: string) => keys.has(key), menu };
  }, [active, buttons, room, size, gap]);
}

/** An open menu: the key of the header button it opened from and that button's frame when pressed. */
export type OpenMenu = { readonly key: string; readonly pressed?: WindowRect };

/**
 * Where an open menu stands (S1-5, F3: at its button), following that button while the menu stays
 * open: across a rotation, a fold or unfold, the side bar changing sides, or a Live Activity moving it.
 * In the side bar the button is the rail entry with `menu.key`; in the status band it is `bandButton`,
 * the screen's own "…" (Sessions, Terminal, Web Preview and the stack headers all have one in the band
 * while it shows; a screen without one has its open menu centred there). Undefined for a closed menu
 * and on every other iPhone (centred menus).
 */
export function useLiveMenuAnchor(
  menu: OpenMenu | null,
  bandButton?: RefObject<ViewInstance | null>,
): WindowRect | undefined {
  const placement = useHeaderPlacement();
  const railFrameOf = useContext(RailFrameContext);
  // The band button's frame with the placement it was measured in; once the placement changes it is stale.
  const [band, setBand] = useState<{ placement: HeaderPlacement; frame: WindowRect } | null>(null);
  const open = menu !== null;
  // Which visible jump does this prevent? An open menu drawn at its band button's old place for a frame
  // after the bar layout changed: measured before paint, the menu moves with the button.
  useLayoutEffect(() => {
    if (!open || placement.kind !== 'band' || bandButton === undefined) return;
    measureInWindow(bandButton, (frame) => setBand({ placement, frame }));
  }, [open, placement, bandButton]);
  if (menu === null) return undefined;
  return liveMenuAnchor(
    placement.kind,
    placement.kind === 'rail' ? railFrameOf(menu.key) : null,
    band !== null && band.placement === placement ? band.frame : undefined,
    menu.pressed,
    bandButton !== undefined,
  );
}

/** A screen's "More options" menu opened from its header button (`useHeaderMenu`). */
export type HeaderMenu = {
  readonly visible: boolean;
  readonly setVisible: (visible: boolean) => void;
  /** Opens it from the button, with the button's window frame where it has one (band or side bar). */
  readonly open: (pressed?: WindowRect) => void;
  /** The button in the screen's own header (status band, or on top). */
  readonly buttonRef: RefObject<ViewInstance | null>;
  /** Where the open menu stands: at its button as it is now (`useLiveMenuAnchor`), else centred. */
  readonly anchor: WindowRect | undefined;
};

/**
 * The "More options" menu of a screen whose header has one, as a rail entry with the key `more` and
 * a button of its own in the band (Terminal): opened from that button, it stands at the button as it
 * is now, also after the button moved between the band and the side bar (S1-5, F3; review
 * s1-floor-r2 #12), not where it was pressed.
 */
export function useHeaderMenu(): HeaderMenu {
  const [visible, setVisible] = useState(false);
  const [pressed, setPressed] = useState<WindowRect | undefined>(undefined);
  const open = useCallback((frame?: WindowRect) => {
    setPressed(frame);
    setVisible(true);
  }, []);
  const buttonRef = useRef<ViewInstance | null>(null);
  const anchor = useLiveMenuAnchor(visible ? { key: 'more', pressed } : null, buttonRef);
  return { visible, setVisible, open, buttonRef, anchor };
}

/** The menus' glyph size (TerminalMenu, the Sessions menus). */
const MENU_ICON_SIZE = 14;

/** `entries` as ordinary menu items, same label and action: each closes the menu (`close`), then acts. */
export function railMenuItems(entries: readonly RailEntry[], close: () => void): ContextMenuItem[] {
  return entries.map((entry) => ({
    kind: 'item',
    key: `rail-${entry.key}`,
    label: entry.label,
    icon: entry.icon(MENU_ICON_SIZE),
    disabled: entry.disabled,
    selected: entry.selected,
    onPress: () => {
      close();
      entry.onPress();
    },
  }));
}

/**
 * The system's bar layout as far as it is known: waiting for the first report, reported (with the window
 * size React Native had then), or none to have (not iOS, or the observation failed).
 */
type Observation =
  { readonly kind: 'waiting' } | { readonly kind: 'none' } | { readonly kind: 'live'; readonly live: LiveBarLayout };

export default function VerticalBarArea({ children }: { children: ReactNode }) {
  const { top, left, right } = useSafeAreaInsets();
  // The strip beside the content continues the focused screen (its rail background), else the app's
  // page, as the approved mockup does.
  const page = useAppearance().background;
  // The system's latest bar layout with the window size React Native reported when it arrived.
  const [observation, setObservation] = useState<Observation>(
    Platform.OS === 'ios' ? { kind: 'waiting' } : { kind: 'none' },
  );
  const [rail, setRail] = useState<RailSlot | null>(null);
  const keyboardFrame = useKeyboardFrame();
  const windowSize = useWindowDimensions();
  const sizeKey = windowSizeKey(windowSize);
  // The window size React Native reports, for the bar layout reports to note when they arrive. A report
  // landing before this updates is taken at its own size either way (`chromeLayout`).
  const sizeKeyRef = useRef(sizeKey);
  useEffect(() => {
    sizeKeyRef.current = sizeKey;
  }, [sizeKey]);
  const geometryHydrated = useBarGeometryStore((state) => state.hydrated);
  // Read only once hydrated (FL-STA-04): before that the chrome uses what the system reports alone.
  const storedLayouts = useBarGeometryStore((state) => (state.hydrated ? state.layouts : NO_STORED_LAYOUTS));
  const recordLayout = useBarGeometryStore((state) => state.recordLayout);
  // The keyboard height the rail reserves in this window: the tallest keyboard reported for a window of
  // this size (owner A1), so it changes at most when a keyboard first appears there or a taller one does,
  // never because one shows or hides. A frame left from before a turn or fold is not this window's and
  // teaches nothing (`keyboardHeightForWindow`).
  const keyboardHeight = useBarGeometryStore((state) => keyboardHeightFor(windowSize, state.keyboardHeights));
  const recordKeyboardHeight = useBarGeometryStore((state) => state.recordKeyboardHeight);
  useEffect(() => {
    const height = keyboardHeightForWindow(keyboardFrame, windowSize);
    if (height !== null) recordKeyboardHeight(sizeKey, height);
  }, [keyboardFrame, windowSize, sizeKey, recordKeyboardHeight]);
  const live = observation.kind === 'live' ? observation.live : null;
  const layout = useMemo(() => chromeLayout(windowSize, live, storedLayouts), [windowSize, live, storedLayouts]);

  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined;
    const report = (next: BarLayout): void => {
      setObservation({ kind: 'live', live: { layout: next, seenAt: sizeKeyRef.current } });
      recordLayout(next);
    };
    // A change reported before the first answer arrives is newer than that answer.
    let reported = false;
    const subscription = GhostexNative.addListener('onBarLayoutChange', (next) => {
      reported = true;
      report(next);
    });
    const observing = GhostexNative.observeBarLayout(RAIL_BUTTON_SIZE, TOP_BAR_EXTENT);
    const logFailure = (step: string) => (error: unknown) =>
      logAppEvent(`System bar layout ${step} failed: ${error instanceof Error ? error.message : String(error)}`);
    observing
      .then(({ layout: next }) => {
        if (!reported) report(next);
      })
      .catch((error: unknown) => {
        // Without the system's regions the headers stay on top, as on any other iPhone; the app log
        // says why.
        logFailure('observation')(error);
        if (!reported) setObservation({ kind: 'none' });
      });
    return () => {
      reported = true;
      subscription.remove();
      // Also when unmounted before the observation started: it is stopped once it has its id, and a
      // newer observation (a remount) keeps running.
      observing.then(({ id }) => GhostexNative.stopObservingBarLayout(id)).catch(logFailure('stop'));
    };
  }, [recordLayout]);

  const { left: barLeft, right: barRight } = verticalBarInsets(layout, { left, right });
  const space = useMemo(
    () => (barLeft === 0 && barRight === 0 ? NO_BAR_SPACE : spaceFor(barLeft, barRight)),
    [barLeft, barRight],
  );
  const placement = useMemo(() => headerPlacement(layout), [layout]);
  const railTop = railContentTop(layout, top);
  const twoColumns = twoColumnWindow(layout);
  const divisions = layout?.divisions;
  const chrome = useMemo<WindowChrome>(
    () => ({ railContentTop: railTop, twoColumns, edge: layout?.edge, divisions }),
    [railTop, twoColumns, layout?.edge, divisions],
  );
  // Above the keyboard when the screen can show one, whether it is up or not, and off the fold's
  // divisions (owner B1): the buttons that fit, as large as those drawn fit, flowing past a division;
  // the rest are the screen's menu's. Only the status items moving (iOS) and the screen changing move
  // the rail.
  const keyboardBound = rail?.buttons.reserveKeyboard === true ? reservedKeyboardTop(windowSize, keyboardHeight) : null;
  const railView = useMemo(
    () =>
      placement.kind === 'rail' && rail !== null
        ? railLayoutFor(
            railSegments(placement.frame, keyboardBound, divisions),
            rail.buttons.entries,
            rail.buttons.pinned,
            rail.buttons.moreMenu,
          )
        : null,
    [placement, rail, keyboardBound, divisions],
  );
  const shown = railView?.shown ?? Number.POSITIVE_INFINITY;
  const size = railView?.fit.size ?? RAIL_FIT.size;
  const gap = railView?.fit.gap ?? RAIL_FIT.gap;
  const railEntries = railView?.rail ?? [];
  // Past a division a button stands further down than the flow, by the room it steps over (owner B1).
  const railOffsets = useMemo(
    () =>
      railView === null || placement.kind !== 'rail'
        ? []
        : railStepOffsets(railView.tops, placement.frame.y, size + gap),
    [railView, placement, size, gap],
  );
  const railShown = placement.kind === 'rail' && rail !== null && geometryHydrated;
  const railFrameOf = useCallback(
    (key: string): WindowRect | null => {
      if (!railShown || railView === null || placement.kind !== 'rail') return null;
      const index = railView.rail.findIndex((entry) => entry.key === key);
      return index < 0 ? null : railButtonFrame(placement.frame, railView.fit, railView.tops[index]);
    },
    [placement, railShown, railView],
  );

  // Until the system has reported the window's bars there is no placement to lay the screens out with.
  if (observation.kind === 'waiting') return <View style={[styles.fill, { backgroundColor: page }]} />;

  return (
    <SpaceContext.Provider value={space}>
      <ChromeContext.Provider value={chrome}>
        <PlacementContext.Provider value={placement}>
          <RailShownContext.Provider value={shown}>
            <RailFrameContext.Provider value={railFrameOf}>
              <RailContext.Provider value={setRail}>
                <View style={[styles.fill, { backgroundColor: rail?.background ?? page }]}>
                  <View style={[styles.fill, space.padding]}>{children}</View>
                  {railShown && placement.kind === 'rail' ? (
                    <View
                      style={[
                        styles.rail,
                        {
                          left: placement.frame.x,
                          top: placement.frame.y,
                          width: placement.frame.width,
                          height: placement.frame.height,
                          gap,
                        },
                      ]}
                    >
                      {railEntries.map((entry, index) => (
                        <RoundBarButton
                          key={entry.key}
                          entry={entry}
                          size={size}
                          glyphSize={RAIL_ICON_SIZE}
                          offset={railOffsets[index]}
                        />
                      ))}
                    </View>
                  ) : null}
                </View>
              </RailContext.Provider>
            </RailFrameContext.Provider>
          </RailShownContext.Provider>
        </PlacementContext.Provider>
      </ChromeContext.Provider>
    </SpaceContext.Provider>
  );
}

/**
 * The round glass button of the side bar (approved mockup: translucent, hairline border), also the
 * shape of a screen's band button where the owner chose one (D2, 2026-10-26: MachineForm's Save).
 * Pressed, it fills as the app's other neutral buttons do.
 */
export function RoundBarButton({
  entry,
  size,
  glyphSize,
  offset = 0,
}: {
  entry: RailEntry;
  size: number;
  glyphSize: number;
  /** Extra room above it in the side bar, past a division. */
  offset?: number;
}) {
  const buttonStyle = useMemo(() => roundButton(size), [size]);
  const ref = useRef<ViewInstance | null>(null);
  return (
    <Pressable
      ref={ref}
      accessibilityRole={entry.selected === undefined ? 'button' : 'switch'}
      accessibilityLabel={entry.label}
      accessibilityState={{ disabled: entry.disabled === true, checked: entry.selected }}
      disabled={entry.disabled === true}
      hitSlop={railHitSlop(size)}
      style={({ pressed }) => [
        buttonStyle,
        offset > 0 ? { marginTop: offset } : null,
        entry.selected === true ? styles.railButtonOn : null,
        pressed ? styles.railButtonPressed : null,
        entry.disabled === true ? styles.railButtonDisabled : null,
      ]}
      // With its window frame, so a menu it opens stands at it (F3).
      onPress={() => measureInWindow(ref, entry.onPress)}
    >
      {entry.icon(glyphSize)}
    </Pressable>
  );
}

function roundButton(size: number): ViewStyle {
  return {
    width: size,
    height: size,
    borderRadius: size / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(40,40,44,0.78)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  };
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  rail: {
    position: 'absolute',
    alignItems: 'center',
  },
  /** A switch that is on: pressed in, as the toolbars draw it. */
  railButtonOn: {
    backgroundColor: GhostexPalette.CARD_ACTIVE,
  },
  railButtonPressed: {
    backgroundColor: GhostexPalette.NEUTRAL_FILL_PRESSED,
  },
  railButtonDisabled: {
    opacity: 0.3,
  },
});
