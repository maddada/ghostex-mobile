/**
 * PLACEHOLDER sessions screen (docs/specs/sessions-drawer.md).
 * Real drawer UI is built by a follow-up agent; this placeholder wires the
 * machine-less state card, status line, and focus-scoped inventory polling.
 */

import { useCallback } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StateCardCopy } from '../copy';
import { useInventoryStore } from '../inventory/store';
import { machineDisplayLabel, selectedMachine, useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../theme/palette';

type Props = NativeStackScreenProps<RootStackParamList, 'Sessions'>;

export default function SessionsScreen({ navigation }: Props) {
  const machine = useMachinesStore((state) => selectedMachine(state));
  const inventory = useInventoryStore((state) =>
    machine === null ? undefined : state.inventoriesByMachineId[machine.id],
  );
  const startPolling = useInventoryStore((state) => state.startPolling);
  const stopPolling = useInventoryStore((state) => state.stopPolling);

  // Poll every 5s only while this screen is focused AND a machine is selected.
  useFocusEffect(
    useCallback(() => {
      if (machine !== null) startPolling();
      return () => stopPolling();
    }, [machine !== null, startPolling, stopPolling]),
  );

  const statusLine =
    machine === null
      ? StateCardCopy.noMachines.status
      : inventory === undefined || !inventory.hasLoaded
        ? StateCardCopy.connecting.status(machineDisplayLabel(machine))
        : inventory.lastError !== null
          ? StateCardCopy.failure.refreshFailedStatus(inventory.lastError)
          : StateCardCopy.success.status(machineDisplayLabel(machine));

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Ghostex</Text>
        <Pressable
          accessibilityRole="button"
          style={styles.headerButton}
          onPress={() => navigation.navigate('Machines')}
        >
          <Text style={styles.headerButtonLabel}>Machines</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          style={styles.headerButton}
          onPress={() => navigation.navigate('Settings')}
        >
          <Text style={styles.headerButtonLabel}>Settings</Text>
        </Pressable>
      </View>
      <Text style={styles.statusLine}>{statusLine}</Text>
      {machine === null ? (
        <Pressable
          accessibilityRole="button"
          style={styles.stateCard}
          onPress={() => navigation.navigate('Machines')}
        >
          <Text style={styles.stateTitle}>{StateCardCopy.noMachines.title}</Text>
          <Text style={styles.stateBody}>{StateCardCopy.noMachines.body}</Text>
          <Text style={styles.stateHint}>{StateCardCopy.noMachines.actionHint}</Text>
        </Pressable>
      ) : (
        <View style={styles.stateCard}>
          <Text style={styles.stateTitle}>
            {inventory?.summary !== null && inventory?.summary !== undefined
              ? `${inventory.summary.sessions.length} ZMX session(s)`
              : StateCardCopy.connecting.title}
          </Text>
          <Text style={styles.stateBody}>
            {inventory?.lastError ?? StateCardCopy.connecting.body(machineDisplayLabel(machine))}
          </Text>
          <Text style={styles.stateHint}>{StateCardCopy.connecting.actionHint}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GhostexPalette.BACKGROUND,
    padding: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  title: {
    flex: 1,
    color: GhostexPalette.FOREGROUND,
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerButton: {
    backgroundColor: GhostexPalette.CARD_ACTIVE,
    borderRadius: GhostexRadii.card,
    paddingHorizontal: 12,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonLabel: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 13,
  },
  statusLine: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    marginTop: 4,
  },
  stateCard: {
    marginTop: 12,
    padding: 12,
    minHeight: 104,
    borderRadius: GhostexRadii.card,
    backgroundColor: GhostexPalette.CARD_ACTIVE,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
  },
  stateTitle: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 15,
    fontWeight: 'bold',
  },
  stateBody: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    marginTop: 6,
  },
  stateHint: {
    color: GhostexPalette.ACCENT,
    fontSize: 12,
    fontWeight: 'bold',
    marginTop: 10,
  },
});
