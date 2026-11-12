/**
 * The one line on top of Sessions after pairing (the user's pick, Q2189): "Connected to <computer> · 7 sessions,
 * 2 working" once the new computer's first list arrives. While it connects, and when it can't be reached, the
 * machine notice line above the search row says so instead; this line shows only success, then leaves by itself or on its ×.
 */

import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CircleCheckGlyph, XGlyph } from '../../components/sessions/icons';
import { countSessions } from '../../contract/grouping';
import { PairingCopy } from '../../copy';
import type { MachineInventory } from '../../inventory/store';
import { useJustPairedStore } from '../../machines/justPaired';
import type { SidebarAppearance } from '../../theme/sidebarAppearance';

const SHOWN_MS = 12_000;

export default function JustPairedLine({
  machineId,
  name,
  inventory,
  appearance,
}: {
  machineId: string;
  name: string;
  inventory: MachineInventory | undefined;
  appearance: SidebarAppearance & { connected: string };
}) {
  const justPaired = useJustPairedStore((state) => state.machineId === machineId);
  const summary = inventory?.lastError === null ? inventory.summary : null;
  const shown = justPaired && summary !== null;
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => useJustPairedStore.getState().clear(), SHOWN_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  if (!shown || summary === null) return null;
  const working = countSessions(summary.sessions, summary.capabilities).workingCount;
  return (
    <View
      accessibilityRole="text"
      style={[styles.line, { backgroundColor: appearance.card, borderColor: appearance.border }]}
    >
      <CircleCheckGlyph size={16} color={appearance.connected} />
      <View style={styles.text}>
        <Text style={[styles.title, { color: appearance.foreground }]} numberOfLines={1}>
          {PairingCopy.connected(name)}
        </Text>
        <Text style={[styles.detail, { color: appearance.muted }]}>
          {PairingCopy.connectedSessions(summary.sessions.length, working)}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={PairingCopy.dismiss}
        hitSlop={10}
        onPress={() => useJustPairedStore.getState().clear()}
      >
        <XGlyph size={14} color={appearance.muted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    marginTop: 8,
    marginHorizontal: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  text: {
    flex: 1,
    gap: 1,
  },
  title: {
    fontSize: 14,
    fontWeight: '600',
  },
  detail: {
    fontSize: 13,
  },
});
