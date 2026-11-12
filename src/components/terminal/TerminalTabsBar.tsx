/**
 * Terminal tabs bar (terminal-screen.md §1). Lives INSIDE the terminal header
 * row (between the back and overflow buttons) and fills its remaining width;
 * there is no separate title text. 36-high capsule track; equal-width tabs when
 * each would be ≥120 wide, otherwise a horizontal scroll whose tabs are sized
 * so the next one always peeks in (`tabStripLayout`, which records the decision:
 * it must be clear that the strip swipes) with a soft fade at each edge that hides
 * more tabs. In scroll mode the active tab rests at the strip's start (the last
 * one at its end), so the neighbour always peeks in (`stripScrollOffset`); that
 * happens on tap and after a close, so the track re-clamps immediately instead
 * of leaving a gap. One tab fills the strip, however narrow. Open tabs show no
 * status dot; only opening/failed/closed states get one.
 *
 * Given the screen's tab drag (`drag`, `dragBar`) a tab held for a moment lifts and drags: to another place in this bar, to the
 * other side's bar, or onto the chat (`tabDrag/`). The other tabs slide to make room; the strip does not scroll while
 * a tab is held.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type ScrollViewInstance,
  type ViewInstance,
} from 'react-native';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

import type { TerminalTab, TerminalTabState } from '../../terminal/sessions';
import { colorWithOpacity, GhostexPalette } from '../../theme/palette';
import { terminalChrome, type TerminalChrome } from '../../theme/terminalColours';
import { HorizontalFade } from '../../chat/native/transcript/verticalFade';
import { CloseIcon } from './icons';
import type { BarId } from './tabDrag/model';
import type { TabDrag } from './tabDrag/TabDrag';
import {
  MIN_TAB_WIDTH,
  TAB_SPACING,
  TRACK_INNER_PAD,
  TRACK_TINT_ALPHA,
  stripFadeColor,
  stripFades,
  stripScrollOffset,
  tabStripLayout,
} from './tabStrip';

export { MIN_TAB_WIDTH };

const TRACK_HEIGHT = 36;
const TAB_HEIGHT = 28;
/** The width of the fade at an edge that hides more tabs. */
const FADE_WIDTH = 24;
/** How long a tab is held before it lifts to drag: a little shorter than Android's long press. */
const LIFT_HOLD_MS = 300;
/** How fast the other tabs slide to make room. */
const SLIDE_MS = 160;

/** opening → orange; failed → red; closed → gray; open and detached (chat only) → no dot. */
function statusDotColor(state: TerminalTabState): string | null {
  switch (state) {
    case 'open':
    case 'detached':
      return null;
    case 'opening':
      return GhostexPalette.STATUS_WORKING;
    case 'failed':
      return GhostexPalette.DANGER;
    case 'closed':
      return '#8E8E93';
  }
}

type TabButtonProps = {
  tab: TerminalTab;
  selected: boolean;
  /**
   * Fills the track (equal-width tabs), else this many points wide. A scrolling strip shows the close
   * button on the active tab only, so a tab peeking in at its edge shows its title, not a lone "x".
   */
  fill: boolean;
  width?: number;
  /** The ink over the header the strip stands in. */
  chrome: TerminalChrome;
  onSelect: (sessionKey: string) => void;
  onClose: (sessionKey: string) => void;
  onSlotLayout?: (sessionKey: string, event: LayoutChangeEvent) => void;
  /** The screen's tab drag and the bar this tab drags from; absent: no drag. */
  drag?: TabDrag | null;
  dragBar?: BarId;
  /** Keeps the slot's view for the drag's measurements (null when it unmounts). */
  slotRef?: (sessionKey: string, view: ViewInstance | null) => void;
};

function TabButton({
  tab,
  selected,
  fill,
  width,
  chrome,
  onSelect,
  onClose,
  onSlotLayout,
  drag = null,
  dragBar,
  slotRef,
}: TabButtonProps) {
  const dotColor = statusDotColor(tab.state);
  const showClose = fill || selected;
  const draggable = drag !== null && dragBar !== undefined;
  const held = drag?.held?.key === tab.sessionKey;
  const shifts = dragBar === undefined ? null : (drag?.shiftsFor(dragBar) ?? null);
  const shift = shifts?.get(tab.sessionKey) ?? 0;
  // While a tab is held the others slide; on the drop they stand still in their new places at once (sliding back from
  // where they made room would cross the new order).
  const sliding = shifts !== null;
  const slide = useAnimatedStyle(() => ({
    transform: [{ translateX: sliding ? withTiming(shift, { duration: SLIDE_MS }) : 0 }],
  }));
  // Held for a moment, then dragged: a quick swipe still scrolls the strip and a tap still selects. JS callbacks: the
  // lifted tab follows the finger through shared values (`useTabDrag` in tabDrag/TabDrag.tsx), the rest are a few state changes.
  const pan = usePanGesture({
    enabled: draggable,
    activateAfterLongPress: LIFT_HOLD_MS,
    runOnJS: true,
    onActivate: (event) => {
      if (drag === null || dragBar === undefined) return;
      drag.begin({ key: tab.sessionKey, from: dragBar, title: tab.title }, event.absoluteX, event.absoluteY);
    },
    onUpdate: (event) => {
      drag?.move(event.absoluteX, event.absoluteY);
    },
    onDeactivate: (event) => {
      drag?.end(tab.sessionKey, event.absoluteX, event.absoluteY, event.canceled);
    },
    onFinalize: (event) => {
      // A touch the system took before the drop: the tab goes back (nothing once the drop above ended the drag).
      drag?.end(tab.sessionKey, event.absoluteX, event.absoluteY, true);
    },
  });
  const slot = (
    <Animated.View
      ref={slotRef === undefined ? undefined : (view: ViewInstance | null) => slotRef(tab.sessionKey, view)}
      collapsable={false}
      style={[styles.tabSlot, fill ? styles.tabSlotFill : { width }, slide, held ? styles.tabHeld : null]}
      onLayout={onSlotLayout === undefined ? undefined : (event) => onSlotLayout(tab.sessionKey, event)}
    >
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        style={[
          styles.tab,
          selected && { backgroundColor: colorWithOpacity(chrome.ink, 18) },
          showClose ? null : styles.tabNoClose,
        ]}
        onPress={() => onSelect(tab.sessionKey)}
      >
        {dotColor !== null && <View style={[styles.statusDot, { backgroundColor: dotColor }]} />}
        <Text style={[styles.tabTitle, { color: chrome.foreground }]} numberOfLines={1}>
          {tab.title}
        </Text>
      </Pressable>
      {showClose ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Close ${tab.title}`}
          hitSlop={6}
          style={[
            styles.closeButton,
            {
              backgroundColor: colorWithOpacity(chrome.ink, selected ? 16 : 12),
              borderColor: colorWithOpacity(chrome.ink, 12),
            },
          ]}
          onPress={() => onClose(tab.sessionKey)}
        >
          <CloseIcon size={11} color={colorWithOpacity(chrome.ink, 92)} strokeWidth={3} />
        </Pressable>
      ) : null}
    </Animated.View>
  );
  return draggable ? <GestureDetector gesture={pan}>{slot}</GestureDetector> : slot;
}

export type TerminalTabsBarProps = {
  tabs: TerminalTab[];
  selectedSessionKey: string | null;
  onSelect: (sessionKey: string) => void;
  onClose: (sessionKey: string) => void;
  /**
   * The colour of the header the strip stands in (`#rrggbb`): the track, tabs and close buttons take its ink (white
   * over a dark header, dark over a light one) and the edge fades melt into the track over it.
   */
  headerColor?: string;
  /** The screen's tab drag (`useTabDrag`) and which bar this is (the only one, or a side's): its tabs drag. */
  drag?: TabDrag | null;
  dragBar?: BarId;
};

export default function TerminalTabsBar({
  tabs,
  selectedSessionKey,
  onSelect,
  onClose,
  headerColor = GhostexPalette.TERMINAL_BACKGROUND,
  drag = null,
  dragBar,
}: TerminalTabsBarProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const contentWidth = useRef(0);

  // The drag measures the track and the tabs when a tab lifts.
  const trackRef = useRef<ViewInstance>(null);
  const slotViews = useRef(new Map<string, ViewInstance>()).current;
  const keysRef = useRef<readonly string[]>([]);
  keysRef.current = tabs.map((tab) => tab.sessionKey);
  const slotRef = useCallback(
    (sessionKey: string, view: ViewInstance | null): void => {
      if (view === null) slotViews.delete(sessionKey);
      else slotViews.set(sessionKey, view);
    },
    [slotViews],
  );
  const dragging = drag?.held !== null && drag?.held !== undefined;

  // The strip's scroll offset as it moves, and the one the fades were last drawn for: a scroll only re-renders
  // the strip when an edge fade appears or goes, not on every frame.
  const scrollOffset = useRef(0);
  const [fadeOffset, setFadeOffset] = useState(0);
  const [scrollContentWidth, setScrollContentWidth] = useState(0);

  const strip = tabStripLayout(trackWidth, tabs.length);
  const equalWidth = strip.equal;
  const tabWidth = strip.equal ? undefined : strip.tabWidth;
  const selectedIndex = tabs.findIndex((entry) => entry.sessionKey === selectedSessionKey);
  const chrome = terminalChrome(headerColor);
  const fadeColor = stripFadeColor(headerColor, chrome.ink);
  const fades = equalWidth ? { left: false, right: false } : stripFades(fadeOffset, scrollContentWidth, trackWidth);
  const onStripScroll = (event: NativeSyntheticEvent<NativeScrollEvent>): void => {
    const offset = event.nativeEvent.contentOffset.x;
    scrollOffset.current = offset;
    const next = stripFades(offset, scrollContentWidth, trackWidth);
    if (next.left !== fades.left || next.right !== fades.right) setFadeOffset(offset);
  };

  // Whether the strip still owes the active tab a scroll to the centre: when the active tab, the tab count
  // or the track changes, until the user takes the strip into their own hands. A re-render or a reflow with
  // the same active tab never undoes a manual scroll.
  const centerPending = useRef(true);
  useEffect(() => {
    centerPending.current = true;
  }, [selectedSessionKey, tabs.length, trackWidth, equalWidth]);

  // A held tab near a scrolling strip's end scrolls it (`TabDrag.tsx`): it goes on from where it is, within its ends,
  // and stays where the drag leaves it (as a manual scroll does).
  const stripRef = useRef({ scrolls: false, room: 0 });
  stripRef.current = { scrolls: !equalWidth, room: Math.max(0, scrollContentWidth - trackWidth) };
  const registerBar = drag?.registerBar;
  useEffect(() => {
    if (registerBar === undefined || dragBar === undefined) return undefined;
    return registerBar(dragBar, {
      track: trackRef,
      slots: slotViews,
      keys: () => keysRef.current,
      scrollBy: (dx) => {
        const { scrolls, room } = stripRef.current;
        if (!scrolls) return 0;
        const from = scrollOffset.current;
        const to = Math.min(room, Math.max(0, from + dx));
        if (to === from) return 0;
        centerPending.current = false;
        scrollOffset.current = to;
        scrollRef.current?.scrollTo({ x: to, animated: false });
        return to - from;
      },
    });
  }, [registerBar, dragBar, slotViews]);

  /** Scroll so the active tab rests at the strip's start (the last at its end): its neighbour peeks in. */
  const centerSelected = useCallback(
    (animated: boolean): void => {
      if (selectedSessionKey === null || trackWidth === 0 || tabWidth === undefined || !centerPending.current) return;
      if (selectedIndex < 0) return;
      scrollRef.current?.scrollTo({ x: stripScrollOffset(selectedIndex, tabs.length, tabWidth, trackWidth), animated });
    },
    [selectedSessionKey, selectedIndex, tabs.length, trackWidth, tabWidth],
  );

  useEffect(() => {
    if (equalWidth) return;
    centerSelected(true);
  }, [equalWidth, centerSelected, tabs.length]);

  const handleSlotLayout = useCallback(
    (sessionKey: string, _event: LayoutChangeEvent): void => {
      // Align again once the active tab has been laid out afresh (covers the reflow after a close,
      // where the effect above may run before the content has its new size).
      if (sessionKey === selectedSessionKey) centerSelected(false);
    },
    [selectedSessionKey, centerSelected],
  );

  const renderTab = (tab: TerminalTab) => (
    <TabButton
      key={tab.sessionKey}
      tab={tab}
      selected={tab.sessionKey === selectedSessionKey}
      fill={equalWidth}
      width={tabWidth}
      chrome={chrome}
      onSelect={onSelect}
      onClose={onClose}
      onSlotLayout={equalWidth ? undefined : handleSlotLayout}
      drag={drag}
      dragBar={dragBar}
      slotRef={dragBar === undefined ? undefined : slotRef}
    />
  );

  return (
    <View style={styles.container}>
      <View
        ref={trackRef}
        collapsable={false}
        style={[
          styles.track,
          {
            backgroundColor: colorWithOpacity(chrome.ink, TRACK_TINT_ALPHA * 100),
            borderColor: colorWithOpacity(chrome.ink, 12),
          },
        ]}
        onLayout={(event) => {
          setTrackWidth(event.nativeEvent.layout.width);
          setFadeOffset(scrollOffset.current);
        }}
      >
        {equalWidth ? (
          <View style={styles.equalRow}>{tabs.map(renderTab)}</View>
        ) : (
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEnabled={!dragging}
            contentContainerStyle={styles.scrollRow}
            scrollEventThrottle={16}
            onScrollBeginDrag={() => {
              centerPending.current = false;
            }}
            onScroll={onStripScroll}
            onContentSizeChange={(width) => {
              contentWidth.current = width;
              setScrollContentWidth(width);
              setFadeOffset(scrollOffset.current);
              centerSelected(false);
            }}
          >
            {tabs.map(renderTab)}
          </ScrollView>
        )}
        {fades.left ? (
          <HorizontalFade
            id="tabs-fade-left"
            color={fadeColor}
            from={1}
            to={0}
            style={[styles.fade, styles.fadeLeft]}
          />
        ) : null}
        {fades.right ? (
          <HorizontalFade
            id="tabs-fade-right"
            color={fadeColor}
            from={0}
            to={1}
            style={[styles.fade, styles.fadeRight]}
          />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    marginHorizontal: 4,
  },
  /** The capsule around the tabs: its fill and border are the header's ink (`TRACK_TINT_ALPHA`, 12%). */
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    borderWidth: 1,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  equalRow: {
    flexDirection: 'row',
    paddingHorizontal: TRACK_INNER_PAD,
    gap: TAB_SPACING,
  },
  scrollRow: {
    flexDirection: 'row',
    paddingHorizontal: TRACK_INNER_PAD,
    gap: TAB_SPACING,
    alignItems: 'center',
  },
  tabSlot: {
    height: TAB_HEIGHT,
    justifyContent: 'center',
  },
  tabSlotFill: {
    flex: 1,
  },
  /** The held tab's place while it is lifted: the lifted copy follows the finger instead. */
  tabHeld: {
    opacity: 0,
  },
  /** A soft edge where more tabs are hidden, the chat's pill rows' fade (`HorizontalFade`, 24 pt wide). */
  fade: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: FADE_WIDTH,
  },
  fadeLeft: {
    left: 0,
  },
  fadeRight: {
    right: 0,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: TAB_HEIGHT,
    borderRadius: TAB_HEIGHT / 2,
    paddingLeft: 14,
    paddingRight: 32,
  },
  /** No close button on this tab (a scrolling strip's inactive tab): the title takes its room. */
  tabNoClose: {
    paddingRight: 14,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  tabTitle: {
    flexShrink: 1,
    fontSize: 14,
  },
  closeButton: {
    position: 'absolute',
    right: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
});
