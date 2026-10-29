/**
 * Terminal tabs bar (terminal-screen.md §1). Lives INSIDE the terminal header
 * row (between the back and overflow buttons) and fills its remaining width;
 * there is no separate title text. 36-high capsule track; equal-width tabs when
 * each would be ≥120 wide, otherwise a horizontal scroll whose tabs are sized
 * so the next one always peeks in (`tabStripLayout`, owner 2026-10-28: it must
 * be clear that the strip swipes) with a soft fade at each edge that hides
 * more tabs. In scroll mode the active tab rests at the strip's start (the last
 * one at its end), so the neighbour always peeks in (`stripScrollOffset`); that
 * happens on tap and after a close, so the track re-clamps immediately instead
 * of leaving a gap. One tab fills the strip, however narrow. Open tabs show no
 * status dot; only opening/failed/closed states get one.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import type { TerminalTab, TerminalTabState } from '../../terminal/sessions';
import { GhostexPalette } from '../../theme/palette';
import { HorizontalFade } from '../../chat/native/transcript/verticalFade';
import { CloseIcon } from './icons';
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
  onSelect: (sessionKey: string) => void;
  onClose: (sessionKey: string) => void;
  onSlotLayout?: (sessionKey: string, event: LayoutChangeEvent) => void;
};

function TabButton({ tab, selected, fill, width, onSelect, onClose, onSlotLayout }: TabButtonProps) {
  const dotColor = statusDotColor(tab.state);
  const showClose = fill || selected;
  return (
    <View
      style={[styles.tabSlot, fill ? styles.tabSlotFill : { width }]}
      onLayout={onSlotLayout === undefined ? undefined : (event) => onSlotLayout(tab.sessionKey, event)}
    >
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        style={[styles.tab, selected && styles.tabSelected, showClose ? null : styles.tabNoClose]}
        onPress={() => onSelect(tab.sessionKey)}
      >
        {dotColor !== null && <View style={[styles.statusDot, { backgroundColor: dotColor }]} />}
        <Text style={styles.tabTitle} numberOfLines={1}>
          {tab.title}
        </Text>
      </Pressable>
      {showClose ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Close ${tab.title}`}
          hitSlop={6}
          style={[styles.closeButton, selected && styles.closeButtonSelected]}
          onPress={() => onClose(tab.sessionKey)}
        >
          <CloseIcon size={11} color="rgba(255,255,255,0.92)" strokeWidth={3} />
        </Pressable>
      ) : null}
    </View>
  );
}

export type TerminalTabsBarProps = {
  tabs: TerminalTab[];
  selectedSessionKey: string | null;
  onSelect: (sessionKey: string) => void;
  onClose: (sessionKey: string) => void;
  /** The colour of the header the strip stands in; its edge fades melt into the track over it. */
  headerColor?: string;
};

export default function TerminalTabsBar({
  tabs,
  selectedSessionKey,
  onSelect,
  onClose,
  headerColor = GhostexPalette.TERMINAL_BACKGROUND,
}: TerminalTabsBarProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const contentWidth = useRef(0);

  const [scrollX, setScrollX] = useState(0);
  const [scrollContentWidth, setScrollContentWidth] = useState(0);

  const strip = tabStripLayout(trackWidth, tabs.length);
  const equalWidth = strip.equal;
  const tabWidth = strip.equal ? undefined : strip.tabWidth;
  const selectedIndex = tabs.findIndex((entry) => entry.sessionKey === selectedSessionKey);
  const fadeColor = stripFadeColor(headerColor);
  const fades = equalWidth ? { left: false, right: false } : stripFades(scrollX, scrollContentWidth, trackWidth);

  // Whether the strip still owes the active tab a scroll to the centre: when the active tab, the tab count
  // or the track changes, until the user takes the strip into their own hands. A re-render or a reflow with
  // the same active tab never undoes a manual scroll.
  const centerPending = useRef(true);
  useEffect(() => {
    centerPending.current = true;
  }, [selectedSessionKey, tabs.length, trackWidth, equalWidth]);

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
      onSelect={onSelect}
      onClose={onClose}
      onSlotLayout={equalWidth ? undefined : handleSlotLayout}
    />
  );

  return (
    <View style={styles.container}>
      <View style={styles.track} onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}>
        {equalWidth ? (
          <View style={styles.equalRow}>{tabs.map(renderTab)}</View>
        ) : (
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.scrollRow}
            scrollEventThrottle={16}
            onScrollBeginDrag={() => {
              centerPending.current = false;
            }}
            onScroll={(event: NativeSyntheticEvent<NativeScrollEvent>) => setScrollX(event.nativeEvent.contentOffset.x)}
            onContentSizeChange={(width) => {
              contentWidth.current = width;
              setScrollContentWidth(width);
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
  track: {
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    backgroundColor: `rgba(255,255,255,${TRACK_TINT_ALPHA})`,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
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
  tabSelected: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  tabTitle: {
    flexShrink: 1,
    color: GhostexPalette.FOREGROUND,
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
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  closeButtonSelected: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
});
