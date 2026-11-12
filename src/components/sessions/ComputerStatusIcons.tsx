/**
 * The Sessions screen's row of computer icons while Separate by machine is off (there are no computer tabs then): one
 * icon per computer, green connected, yellow slow, red can't connect. A tap opens the Connections sheet.
 *
 * CDXC:RemoteMachines 2026-11-12 DECISION:
 * User (Q2739 note): "when there's no errors, and the user disables separate by machine then it should show the logos
 * of the different machines green in the place where we show green 'Tailscale' text now. also if possible if connection
 * is slow for one of them show that icon yellow". With computer tabs, each tab's own icon takes these colours instead.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { ConnectionsCopy } from '../../copy';
import { useAppearance } from '../../theme/useAppearance';
import { LinkIcon, linkStatusColor } from './ConnectionsSheet';
import { SpinningLoader } from './MachineTabs';
import type { ConnectionEntry } from './useConnectionEntries';

export default function ComputerStatusIcons({
  entries,
  onPress,
}: {
  entries: readonly ConnectionEntry[];
  onPress: () => void;
}) {
  const appearance = useAppearance();
  if (entries.length === 0) return null;
  return (
    <View style={styles.row}>
      {entries.map((entry) => (
        <Pressable
          key={entry.machine.id}
          accessibilityRole="button"
          accessibilityLabel={ConnectionsCopy.iconLabel(entry.name, ConnectionsCopy.status[entry.status])}
          accessibilityHint={ConnectionsCopy.iconHint}
          hitSlop={4}
          onPress={onPress}
          style={({ pressed }) => [styles.icon, pressed ? styles.pressed : null]}
        >
          {entry.status === 'connecting' ? (
            <SpinningLoader color={appearance.mutedGlyph} size={16} />
          ) : (
            <LinkIcon entry={entry} size={17} color={linkStatusColor(entry.status, appearance)} />
          )}
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: 'auto',
  },
  icon: {
    width: 28,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: {
    opacity: 0.6,
  },
});
