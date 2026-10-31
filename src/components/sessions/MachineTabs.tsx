/**
 * Machine tab strip, the phone's counterpart to the desktop sidebar's machine
 * tabs (packages/core-ui/sidebar-app/machine-tabs.tsx, mirrored here per
 * docs/2026-09-03/mobile-setup/mobile-06-sessions.html): one tab per machine
 * the user has kept visible plus a trailing "+" tab, and the drawer below
 * shows only the selected machine.
 *
 * It is drawn edge to edge directly under the title as one joined strip whose
 * segments share hairlines, because machine names are user-supplied and the
 * phone is narrow, so segments stretch and their labels truncate. With more
 * machines than fit at a readable width the tabs scroll sideways and the "+"
 * stays put (machineTabLayout.ts).
 *
 * The cloud glyph is the connection control, exactly like the desktop tab:
 * it spins while the machine is busy (the whole tab dims to 0.72), turns red
 * when the connection failed (the icon only, never the label: "tint just the
 * icon not the whole tab", CDXC:RemoteMachines 2026-10-25), and is dim while not
 * connected. Pressing the glyph on a failed or not-connected machine retries
 * through `onConnect` WITHOUT selecting the tab; pressing the label selects.
 * Unselected tabs show their machine's status as the desktop's overlapping
 * dots (StatusDotStack) so a machine still reports that something needs the
 * user. A long press opens the tab's menu.
 */

import { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ScrollViewInstance,
} from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { StripCopy } from '../../copy';
import { GhostexStrokeWidth, SetupPalette } from '../../theme/palette';
import { CloudGlyph, LoaderGlyph, PlusGlyph } from './icons';
import { machineTabLayout, machineTabRevealOffset, machineTabsOutOfView } from './machineTabLayout';
import StatusDotStack from './StatusDotStack';

export type MachineTabConnectionState = 'busy' | 'connected' | 'disconnected' | 'failed';

export type MachineTabItem = {
  id: string;
  label: string;
  connectionState: MachineTabConnectionState;
  /**
   * What the tab says about the connection: the busy step, the sanitized
   * failure reason, or a Connect prompt while disconnected. Read out with the
   * label and shown as the long-press menu's subtitle.
   */
  connectionLabel?: string;
  /** Retries the connection from the glyph; absent while connected or busy. */
  onConnect?: () => void;
  /** grouping.ts tabStatusCounts: the desktop machine tab's counts. */
  workingCount: number;
  attentionCount: number;
  backgroundWorkCount: number;
  questionCount: number;
  /** Sessions waiting for approval: the red dot. */
  approvalCount: number;
};

/** The trailing "+" tab; the strip's `items` always end with it. */
export type MachineTabAddItem = { kind: 'add' };

export const MACHINE_TAB_ADD: MachineTabAddItem = { kind: 'add' };

export type MachineTabStripItem = MachineTabItem | MachineTabAddItem;

function isAddItem(item: MachineTabStripItem): item is MachineTabAddItem {
  return 'kind' in item && item.kind === 'add';
}

const GLYPH_SIZE = 16;
const ADD_TAB_WIDTH = 40;
const FADE_WIDTH = 20;
const GLYPH_COLOR: Record<MachineTabConnectionState, string> = {
  busy: SetupPalette.ACCENT,
  connected: SetupPalette.MUTED,
  disconnected: SetupPalette.DIM,
  failed: SetupPalette.ERROR,
};

/** The loader spins with the native driver for as long as the tab is busy. */
export function SpinningLoader({ color, size = GLYPH_SIZE }: { color: string; size?: number }) {
  const turn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(turn, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [turn]);
  const rotate = turn.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  return (
    <Animated.View style={{ transform: [{ rotate }] }}>
      <LoaderGlyph size={size} color={color} />
    </Animated.View>
  );
}

function ConnectionGlyph({ item }: { item: MachineTabItem }) {
  if (item.connectionState === 'busy') {
    return (
      <View accessibilityLabel={StripCopy.connection.busy} style={styles.glyph}>
        <SpinningLoader color={GLYPH_COLOR.busy} />
      </View>
    );
  }
  const color = GLYPH_COLOR[item.connectionState];
  if (item.onConnect === undefined) {
    return (
      <View style={styles.glyph}>
        <CloudGlyph size={GLYPH_SIZE} color={color} />
      </View>
    );
  }
  // A Pressable of its own, so retrying never also flips tabs.
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        item.connectionState === 'failed' ? StripCopy.glyphAction.retry : StripCopy.glyphAction.connect
      }
      hitSlop={6}
      onPress={item.onConnect}
      style={({ pressed }) => [styles.glyph, pressed ? styles.glyphPressed : null]}
    >
      <CloudGlyph size={GLYPH_SIZE} color={color} />
    </Pressable>
  );
}

/**
 * CDXC:SessionStatus 2026-09-25 DECISION:
 * User: "Please make the indicators for sessions status in the RN session list match gpui one exactly". The desktop machine tab shows no status on the selected machine and the other machines' status as dots, not numbers, like its Spaces (apps/desktop/src/app/native_sidebar/machines.rs), so the phone draws the same overlapping dots on unselected tabs only. This supersedes the phone's numbered pills on every tab.
 * CDXC:SessionStatus 2026-10-24 DECISION:
 * User: "when we show those colored circles on remote machines let's make those circles appear below the remote machine tab instead of showing in a way that pushes the icon and name of the remote/local machine", and "Yes, same as the desktop" for the phone. The dots are drawn absolutely at the bottom of the tab, centred, so the glyph and label stay centred where they sit without dots and the tab keeps its height. Supersedes the dots sitting inline after the name.
 */
function StatusDots({ item }: { item: MachineTabItem }) {
  if (
    item.workingCount <= 0 &&
    item.attentionCount <= 0 &&
    item.backgroundWorkCount <= 0 &&
    item.questionCount <= 0 &&
    item.approvalCount <= 0
  ) {
    return null;
  }
  return (
    <View
      pointerEvents="none"
      style={styles.dots}
      accessibilityLabel={[
        item.workingCount > 0 ? `${item.workingCount} working` : '',
        item.attentionCount > 0 ? `${item.attentionCount} need attention` : '',
        item.questionCount > 0 ? `${item.questionCount} waiting on an answer` : '',
        item.approvalCount > 0 ? `${item.approvalCount} waiting for approval` : '',
        item.workingCount === 0 && item.backgroundWorkCount > 0
          ? `${item.backgroundWorkCount} running in the background`
          : '',
      ]
        .filter(Boolean)
        .join(', ')}
    >
      <StatusDotStack
        workingCount={item.workingCount}
        attentionCount={item.attentionCount}
        backgroundWorkCount={item.backgroundWorkCount}
        questionCount={item.questionCount}
        approvalCount={item.approvalCount}
        ringColor={SetupPalette.PANEL}
      />
    </View>
  );
}

function MachineTab({
  item,
  divided,
  width,
  selected,
  onSelect,
  onLongPress,
}: {
  item: MachineTabItem;
  divided: boolean;
  /** Fixed while the row scrolls; absent while the tabs share it. */
  width?: number;
  selected: boolean;
  onSelect: (machineId: string) => void;
  onLongPress: (machineId: string) => void;
}) {
  const stateLabel = item.connectionLabel ?? StripCopy.connection[item.connectionState];
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={`${item.label}, ${stateLabel}`}
      accessibilityHint="Touch and hold for the machine menu"
      accessibilityState={{ selected, busy: item.connectionState === 'busy' }}
      onLongPress={() => onLongPress(item.id)}
      onPress={() => onSelect(item.id)}
      style={({ pressed }) => [
        styles.tab,
        width !== undefined ? { width } : styles.tabShared,
        divided ? styles.tabDivided : null,
        selected ? styles.tabSelected : null,
        pressed ? styles.tabPressed : null,
        item.connectionState === 'busy' ? styles.tabBusy : null,
      ]}
    >
      <ConnectionGlyph item={item} />
      <Text ellipsizeMode="tail" numberOfLines={1} style={[styles.label, selected ? styles.labelSelected : null]}>
        {item.label}
      </Text>
      {selected ? null : <StatusDots item={item} />}
    </Pressable>
  );
}

/** A soft edge on the scrolling row, so tabs run out of sight rather than stop at a line. */
function EdgeFade({ side }: { side: 'left' | 'right' }) {
  const id = `machine-tabs-fade-${side}`;
  return (
    <View pointerEvents="none" style={[styles.fade, side === 'left' ? styles.fadeLeft : styles.fadeRight]}>
      <Svg width={FADE_WIDTH} height="100%">
        <Defs>
          <LinearGradient id={id} x1={side === 'left' ? '1' : '0'} y1="0" x2={side === 'left' ? '0' : '1'} y2="0">
            <Stop offset="0" stopColor={SetupPalette.PANEL} stopOpacity={0} />
            <Stop offset="1" stopColor={SetupPalette.PANEL} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width={FADE_WIDTH} height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

/** What the tabs past one edge have to say, on that edge. */
function EdgeDots({ side, hidden }: { side: 'left' | 'right'; hidden: readonly MachineTabItem[] }) {
  const sum = (count: (item: MachineTabItem) => number): number => hidden.reduce((total, item) => total + count(item), 0);
  const counts = {
    workingCount: sum((item) => item.workingCount),
    attentionCount: sum((item) => item.attentionCount),
    backgroundWorkCount: sum((item) => item.backgroundWorkCount),
    questionCount: sum((item) => item.questionCount),
    approvalCount: sum((item) => item.approvalCount),
  };
  if (Object.values(counts).every((count) => count <= 0)) return null;
  return (
    <View pointerEvents="none" style={[styles.edgeDots, side === 'left' ? styles.edgeDotsLeft : styles.edgeDotsRight]}>
      <StatusDotStack {...counts} ringColor={SetupPalette.PANEL} />
    </View>
  );
}

export default function MachineTabs({
  items,
  selectedMachineId,
  onSelect,
  onLongPress,
  onAdd,
}: {
  items: readonly MachineTabStripItem[];
  selectedMachineId: string | null;
  onSelect: (machineId: string) => void;
  onLongPress: (machineId: string) => void;
  /** The trailing "+" tab: add a computer through the onboarding chooser. */
  onAdd: () => void;
}) {
  const { width: windowWidth } = useWindowDimensions();
  const [stripWidth, setStripWidth] = useState(windowWidth);
  const machines = items.filter((item): item is MachineTabItem => !isAddItem(item));
  const hasAdd = machines.length < items.length;
  const rowWidth = stripWidth - (hasAdd ? ADD_TAB_WIDTH : 0);
  const layout = machineTabLayout(machines.length, rowWidth);
  const tabWidth = layout.kind === 'scroll' ? layout.tabWidth : null;

  const scroller = useRef<ScrollViewInstance | null>(null);
  const [offset, setOffset] = useState(0);
  const offsetNow = useRef(0);
  const selectedIndex = machines.findIndex((machine) => machine.id === selectedMachineId);
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (tabWidth === null || selectedIndex < 0) return;
    const key = `${selectedMachineId}:${rowWidth}`;
    if (revealed.current === key) return;
    const first = revealed.current === null;
    revealed.current = key;
    const x = machineTabRevealOffset(selectedIndex, machines.length, tabWidth, rowWidth, offsetNow.current);
    offsetNow.current = x;
    setOffset(x);
    scroller.current?.scrollTo({ x, animated: !first });
  }, [machines.length, rowWidth, selectedIndex, selectedMachineId, tabWidth]);

  const add = hasAdd ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={StripCopy.addTab}
      key="add"
      onPress={onAdd}
      style={({ pressed }) => [
        styles.addTab,
        machines.length > 0 ? styles.tabDivided : null,
        pressed ? styles.tabPressed : null,
      ]}
    >
      <PlusGlyph size={16} color={SetupPalette.MUTED} />
    </Pressable>
  ) : null;
  const [firstVisible, firstAfter] =
    tabWidth === null ? [0, machines.length] : machineTabsOutOfView(machines.length, tabWidth, rowWidth, offset);
  const unselected = (machine: MachineTabItem): boolean => machine.id !== selectedMachineId;
  return (
    <View
      accessibilityRole="tablist"
      style={styles.strip}
      onLayout={(event) => setStripWidth(event.nativeEvent.layout.width)}
    >
      {tabWidth === null ? (
        machines.map((item, index) => (
          <MachineTab
            key={item.id}
            item={item}
            divided={index > 0}
            selected={item.id === selectedMachineId}
            onSelect={onSelect}
            onLongPress={onLongPress}
          />
        ))
      ) : (
        <View style={styles.scrollArea}>
          <ScrollView
            ref={scroller}
            horizontal
            showsHorizontalScrollIndicator={false}
            scrollEventThrottle={32}
            onScroll={(event) => {
              offsetNow.current = event.nativeEvent.contentOffset.x;
              setOffset(offsetNow.current);
            }}
          >
            {machines.map((item, index) => (
              <MachineTab
                key={item.id}
                item={item}
                divided={index > 0}
                width={tabWidth}
                selected={item.id === selectedMachineId}
                onSelect={onSelect}
                onLongPress={onLongPress}
              />
            ))}
          </ScrollView>
          {offset > 0.5 ? <EdgeFade side="left" /> : null}
          {offset < machines.length * tabWidth - rowWidth - 0.5 ? <EdgeFade side="right" /> : null}
          <EdgeDots side="left" hidden={machines.slice(0, firstVisible).filter(unselected)} />
          <EdgeDots side="right" hidden={machines.slice(firstAfter).filter(unselected)} />
        </View>
      )}
      {add}
    </View>
  );
}

/** The Sessions page pads by 12; the strip cancels that to run edge to edge. */
const PAGE_PADDING = 12;

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'stretch',
    /* Keeps its tabs' natural height next to the filling sessions list. */
    flexShrink: 0,
    marginTop: 6,
    marginHorizontal: -PAGE_PADDING,
    borderTopWidth: GhostexStrokeWidth,
    borderBottomWidth: GhostexStrokeWidth,
    borderColor: SetupPalette.BORDER,
    backgroundColor: SetupPalette.PANEL,
  },
  tabShared: {
    flex: 1,
    minWidth: 0,
  },
  tab: {
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  /** Below the label, centred, out of the tab's row so nothing shifts when it appears. */
  dots: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
  },
  scrollArea: {
    flex: 1,
    minWidth: 0,
  },
  fade: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: FADE_WIDTH,
  },
  fadeLeft: { left: 0 },
  fadeRight: { right: 0 },
  edgeDots: {
    position: 'absolute',
    bottom: 0,
  },
  edgeDotsLeft: { left: 4 },
  edgeDotsRight: { right: 4 },
  addTab: {
    width: ADD_TAB_WIDTH,
    flexGrow: 0,
    flexShrink: 0,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  /** Segments share one hairline instead of each drawing its own border. */
  tabDivided: {
    borderLeftWidth: GhostexStrokeWidth,
    borderLeftColor: SetupPalette.BORDER,
  },
  tabSelected: {
    backgroundColor: SetupPalette.CARD_HOVER,
  },
  tabPressed: {
    backgroundColor: SetupPalette.MUTED_BG,
  },
  tabBusy: {
    opacity: 0.72,
  },
  glyph: {
    width: GLYPH_SIZE + 4,
    height: GLYPH_SIZE + 4,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
    flexGrow: 0,
    flexShrink: 0,
  },
  glyphPressed: {
    backgroundColor: SetupPalette.MUTED_BG,
  },
  label: {
    flexShrink: 1,
    minWidth: 0,
    color: SetupPalette.MUTED,
    fontSize: 13,
    fontWeight: '600',
  },
  labelSelected: {
    color: SetupPalette.FOREGROUND,
  },
});
