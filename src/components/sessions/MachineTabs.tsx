/**
 * Machine tab strip, the phone's counterpart to the desktop sidebar's machine
 * tabs (packages/core-ui/sidebar-app/machine-tabs.tsx, mirrored here per
 * docs/2026-09-03/mobile-setup/mobile-06-sessions.html): one tab per machine
 * the user has kept visible plus a trailing "+" tab, and the drawer below
 * shows only the selected machine.
 *
 * It is drawn edge to edge directly under the title as one joined strip whose
 * segments share hairlines, because machine names are user-supplied and the
 * phone is narrow, so segments stretch and their labels truncate.
 *
 * The cloud glyph is the connection control, exactly like the desktop tab:
 * it spins while the machine is busy (the whole tab dims to 0.72), turns red
 * together with the label when the connection failed, and is dim while not
 * connected. Pressing the glyph on a failed or not-connected machine retries
 * through `onConnect` WITHOUT selecting the tab; pressing the label selects.
 * Unselected tabs show their machine's status as the desktop's overlapping
 * dots (StatusDotStack) so a machine still reports that something needs the
 * user. A long press opens the tab's menu.
 */

import { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { StripCopy } from '../../copy';
import { GhostexStrokeWidth, SetupPalette } from '../../theme/palette';
import { CloudGlyph, LoaderGlyph, PlusGlyph } from './icons';
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
  /** grouping.ts countSessions: the desktop machine tab's counts. */
  workingCount: number;
  attentionCount: number;
  backgroundWorkCount: number;
};

/** The trailing "+" tab; the strip's `items` always end with it. */
export type MachineTabAddItem = { kind: 'add' };

export const MACHINE_TAB_ADD: MachineTabAddItem = { kind: 'add' };

export type MachineTabStripItem = MachineTabItem | MachineTabAddItem;

function isAddItem(item: MachineTabStripItem): item is MachineTabAddItem {
  return 'kind' in item && item.kind === 'add';
}

const GLYPH_SIZE = 16;
const GLYPH_COLOR: Record<MachineTabConnectionState, string> = {
  busy: SetupPalette.ACCENT,
  connected: SetupPalette.MUTED,
  disconnected: SetupPalette.DIM,
  failed: SetupPalette.ERROR,
};

/** The loader spins with the native driver for as long as the tab is busy. */
function SpinningLoader({ color }: { color: string }) {
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
      <LoaderGlyph size={GLYPH_SIZE} color={color} />
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
        item.connectionState === 'failed'
          ? StripCopy.glyphAction.retry
          : StripCopy.glyphAction.connect
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
 */
function StatusDots({ item }: { item: MachineTabItem }) {
  if (item.workingCount <= 0 && item.attentionCount <= 0 && item.backgroundWorkCount <= 0) return null;
  return (
    <View
      accessibilityLabel={[
        item.workingCount > 0 ? `${item.workingCount} working` : '',
        item.attentionCount > 0 ? `${item.attentionCount} need attention` : '',
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
        ringColor={SetupPalette.PANEL}
      />
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
  return (
    <View accessibilityRole="tablist" style={styles.strip}>
      {items.map((item, index) => {
        if (isAddItem(item)) {
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={StripCopy.addTab}
              key="add"
              onPress={onAdd}
              style={({ pressed }) => [
                styles.addTab,
                index > 0 ? styles.tabDivided : null,
                pressed ? styles.tabPressed : null,
              ]}
            >
              <PlusGlyph size={16} color={SetupPalette.MUTED} />
            </Pressable>
          );
        }
        const selected = item.id === selectedMachineId;
        const failed = item.connectionState === 'failed';
        const stateLabel = item.connectionLabel ?? StripCopy.connection[item.connectionState];
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityLabel={`${item.label}, ${stateLabel}`}
            accessibilityState={{ selected, busy: item.connectionState === 'busy' }}
            key={item.id}
            onLongPress={() => onLongPress(item.id)}
            onPress={() => onSelect(item.id)}
            style={({ pressed }) => [
              styles.tab,
              index > 0 ? styles.tabDivided : null,
              selected ? styles.tabSelected : null,
              pressed ? styles.tabPressed : null,
              item.connectionState === 'busy' ? styles.tabBusy : null,
            ]}
          >
            <ConnectionGlyph item={item} />
            <Text
              ellipsizeMode="tail"
              numberOfLines={1}
              style={[
                styles.label,
                selected ? styles.labelSelected : null,
                failed ? styles.labelFailed : null,
              ]}
            >
              {item.label}
            </Text>
            {selected ? null : <StatusDots item={item} />}
          </Pressable>
        );
      })}
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
  tab: {
    flex: 1,
    minWidth: 0,
    height: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  addTab: {
    width: 40,
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
  labelFailed: {
    color: SetupPalette.ERROR,
  },
});
