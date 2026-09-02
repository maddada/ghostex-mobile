/**
 * Machine tab strip, the phone's counterpart to the desktop sidebar's machine
 * tabs (packages/core-ui/sidebar-app/machine-tabs.tsx): one tab per machine the
 * user has kept visible, and the drawer below shows only the selected machine.
 *
 * It is drawn as one joined segmented strip — a single bordered container whose
 * segments share hairlines and only the outer corners are rounded — because
 * machine names are user-supplied and the phone is narrow, so segments stretch
 * and their labels truncate. A status dot carries the machine's connection
 * state so an unreachable machine reads as such without opening it, and a long
 * press opens that machine's menu.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GhostexPalette, GhostexRadii, GhostexStrokeWidth, SidebarPalette } from '../../theme/palette';

export type MachineTabConnectionState = 'busy' | 'connected' | 'disconnected' | 'failed';

export type MachineTabItem = {
  id: string;
  label: string;
  connectionState: MachineTabConnectionState;
};

const STATUS_DOT_COLOR: Record<MachineTabConnectionState, string> = {
  busy: GhostexPalette.STATUS_WORKING,
  connected: GhostexPalette.STATUS_CONNECTED,
  disconnected: SidebarPalette.SLEEP_DOT,
  failed: GhostexPalette.STATUS_ERROR,
};

const STATUS_LABEL: Record<MachineTabConnectionState, string> = {
  busy: 'connecting',
  connected: 'connected',
  disconnected: 'not connected',
  failed: 'connection failed',
};

export default function MachineTabs({
  items,
  selectedMachineId,
  onSelect,
  onLongPress,
}: {
  items: readonly MachineTabItem[];
  selectedMachineId: string | null;
  onSelect: (machineId: string) => void;
  onLongPress: (machineId: string) => void;
}) {
  return (
    <View accessibilityRole="tablist" style={styles.strip}>
      {items.map((item, index) => {
        const selected = item.id === selectedMachineId;
        return (
          <Pressable
            accessibilityRole="tab"
            accessibilityLabel={`${item.label}, ${STATUS_LABEL[item.connectionState]}`}
            accessibilityState={{ selected }}
            key={item.id}
            onLongPress={() => onLongPress(item.id)}
            onPress={() => onSelect(item.id)}
            style={[
              styles.tab,
              index > 0 ? styles.tabDivided : null,
              selected ? styles.tabSelected : null,
            ]}
          >
            <View
              style={[styles.statusDot, { backgroundColor: STATUS_DOT_COLOR[item.connectionState] }]}
            />
            <Text
              ellipsizeMode="tail"
              numberOfLines={1}
              style={[
                styles.label,
                selected ? styles.labelSelected : null,
                item.connectionState === 'failed' ? styles.labelFailed : null,
              ]}
            >
              {item.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: 'row',
    alignItems: 'stretch',
    /* Keeps its tabs' natural height next to the filling sessions list. */
    flexShrink: 0,
    marginTop: 8,
    borderWidth: GhostexStrokeWidth,
    borderColor: SidebarPalette.HEADER_BUTTON_BORDER,
    borderRadius: GhostexRadii.card,
    backgroundColor: SidebarPalette.HEADER_BUTTON_BG,
    overflow: 'hidden',
  },
  tab: {
    flex: 1,
    minWidth: 0,
    minHeight: 34,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 8,
  },
  /** Segments share one hairline instead of each drawing its own border. */
  tabDivided: {
    borderLeftWidth: GhostexStrokeWidth,
    borderLeftColor: SidebarPalette.HEADER_BUTTON_BORDER,
  },
  tabSelected: {
    backgroundColor: GhostexPalette.CARD_ACTIVE,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    flexGrow: 0,
    flexShrink: 0,
  },
  label: {
    flexShrink: 1,
    minWidth: 0,
    color: SidebarPalette.MUTED,
    fontSize: 12,
    fontWeight: '600',
  },
  labelSelected: {
    color: GhostexPalette.FOREGROUND,
  },
  labelFailed: {
    color: GhostexPalette.STATUS_ERROR,
  },
});
