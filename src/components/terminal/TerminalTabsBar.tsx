/**
 * Terminal tabs bar (terminal-screen.md §1). Lives INSIDE the terminal header
 * row (between the back and overflow buttons) and fills its remaining width;
 * there is no separate title text. 36-high capsule track; equal-width tabs when
 * each would be ≥120 wide, otherwise a horizontal scroll with 120 min-width
 * tabs. In scroll mode the selected tab is kept centered (on tap and after a
 * close, so the track re-clamps immediately instead of leaving a gap). Open
 * tabs show no status dot; only opening/failed/closed states get one.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { LayoutChangeEvent } from 'react-native';

import type { TerminalTab, TerminalTabState } from '../../terminal/sessions';
import { GhostexPalette } from '../../theme/palette';
import { CloseIcon } from './icons';

const TRACK_HEIGHT = 36;
const TAB_HEIGHT = 28;
const TRACK_INNER_PAD = 4;
const TAB_SPACING = 4;
const MIN_TAB_WIDTH = 120;

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
  fill: boolean;
  onSelect: (sessionKey: string) => void;
  onClose: (sessionKey: string) => void;
  onSlotLayout?: (sessionKey: string, event: LayoutChangeEvent) => void;
};

function TabButton({ tab, selected, fill, onSelect, onClose, onSlotLayout }: TabButtonProps) {
  const dotColor = statusDotColor(tab.state);
  return (
    <View
      style={[styles.tabSlot, fill ? styles.tabSlotFill : styles.tabSlotScroll]}
      onLayout={onSlotLayout === undefined ? undefined : (event) => onSlotLayout(tab.sessionKey, event)}
    >
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        style={[styles.tab, selected && styles.tabSelected]}
        onPress={() => onSelect(tab.sessionKey)}
      >
        {dotColor !== null && <View style={[styles.statusDot, { backgroundColor: dotColor }]} />}
        <Text style={styles.tabTitle} numberOfLines={1}>
          {tab.title}
        </Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Close ${tab.title}`}
        hitSlop={6}
        style={[styles.closeButton, selected && styles.closeButtonSelected]}
        onPress={() => onClose(tab.sessionKey)}
      >
        <CloseIcon size={11} color="rgba(255,255,255,0.92)" strokeWidth={3} />
      </Pressable>
    </View>
  );
}

export type TerminalTabsBarProps = {
  tabs: TerminalTab[];
  selectedSessionKey: string | null;
  onSelect: (sessionKey: string) => void;
  onClose: (sessionKey: string) => void;
};

export default function TerminalTabsBar({
  tabs,
  selectedSessionKey,
  onSelect,
  onClose,
}: TerminalTabsBarProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const tabLayouts = useRef(new Map<string, { x: number; width: number }>());
  const contentWidth = useRef(0);

  const available = trackWidth - TRACK_INNER_PAD * 2 - TAB_SPACING * (tabs.length - 1);
  const itemWidth = tabs.length > 0 ? available / tabs.length : 0;
  const equalWidth = trackWidth === 0 || itemWidth >= MIN_TAB_WIDTH;

  /** Scroll so the selected tab sits centered, clamped to the content bounds. */
  const centerSelected = useCallback(
    (animated: boolean): void => {
      if (selectedSessionKey === null || trackWidth === 0) return;
      const layout = tabLayouts.current.get(selectedSessionKey);
      if (layout === undefined) return;
      const maxOffset = Math.max(0, contentWidth.current - trackWidth);
      const target = Math.min(
        maxOffset,
        Math.max(0, layout.x + layout.width / 2 - trackWidth / 2),
      );
      scrollRef.current?.scrollTo({ x: target, animated });
    },
    [selectedSessionKey, trackWidth],
  );

  useEffect(() => {
    if (equalWidth) return;
    centerSelected(true);
  }, [equalWidth, centerSelected, tabs.length]);

  const handleSlotLayout = useCallback(
    (sessionKey: string, event: LayoutChangeEvent): void => {
      const { x, width } = event.nativeEvent.layout;
      tabLayouts.current.set(sessionKey, { x, width });
      // Re-center once the selected tab's fresh position is known (covers the
      // reflow after a close, where the effect above may run on stale layouts).
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
      onSelect={onSelect}
      onClose={onClose}
      onSlotLayout={equalWidth ? undefined : handleSlotLayout}
    />
  );

  return (
    <View style={styles.container}>
      <View
        style={styles.track}
        onLayout={(event) => setTrackWidth(event.nativeEvent.layout.width)}
      >
        {equalWidth ? (
          <View style={styles.equalRow}>{tabs.map(renderTab)}</View>
        ) : (
          <ScrollView
            ref={scrollRef}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.scrollRow}
            onContentSizeChange={(width) => {
              contentWidth.current = width;
              centerSelected(false);
            }}
          >
            {tabs.map(renderTab)}
          </ScrollView>
        )}
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
    backgroundColor: 'rgba(255,255,255,0.08)',
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
  tabSlotScroll: {
    minWidth: MIN_TAB_WIDTH,
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
