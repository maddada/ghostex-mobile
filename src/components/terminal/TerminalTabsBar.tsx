/**
 * Terminal tabs bar (terminal-screen.md §1). Shown only when >1 tab.
 * 44-high capsule track; equal-width tabs when each would be ≥120 wide,
 * otherwise a horizontal scroll with 120 min-width tabs. Selection is a plain
 * state swap (tab-bar animations are disabled per spec).
 */

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { TerminalTab, TerminalTabState } from '../../terminal/sessions';
import { GhostexPalette } from '../../theme/palette';
import { CloseIcon } from './icons';

const TRACK_HEIGHT = 44;
const TAB_HEIGHT = 36;
const TRACK_INNER_PAD = 4;
const TAB_SPACING = 4;
const MIN_TAB_WIDTH = 120;

/** connected → green; opening → orange; failed → red; closed → gray. */
function statusDotColor(state: TerminalTabState): string {
  switch (state) {
    case 'open':
      return '#34C759';
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
};

function TabButton({ tab, selected, fill, onSelect, onClose }: TabButtonProps) {
  return (
    <View style={[styles.tabSlot, fill ? styles.tabSlotFill : styles.tabSlotScroll]}>
      <Pressable
        accessibilityRole="tab"
        accessibilityState={{ selected }}
        style={[styles.tab, selected && styles.tabSelected]}
        onPress={() => onSelect(tab.sessionKey)}
      >
        <View style={[styles.statusDot, { backgroundColor: statusDotColor(tab.state) }]} />
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

  const available = trackWidth - TRACK_INNER_PAD * 2 - TAB_SPACING * (tabs.length - 1);
  const itemWidth = tabs.length > 0 ? available / tabs.length : 0;
  const equalWidth = trackWidth === 0 || itemWidth >= MIN_TAB_WIDTH;

  const renderTab = (tab: TerminalTab) => (
    <TabButton
      key={tab.sessionKey}
      tab={tab}
      selected={tab.sessionKey === selectedSessionKey}
      fill={equalWidth}
      onSelect={onSelect}
      onClose={onClose}
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
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.scrollRow}
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
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: GhostexPalette.TERMINAL_BACKGROUND,
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
    paddingRight: 36,
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
    fontSize: 15,
  },
  closeButton: {
    position: 'absolute',
    right: 8,
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
