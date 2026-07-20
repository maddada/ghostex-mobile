/**
 * PLACEHOLDER machines screen (docs/specs/sessions-drawer.md §4).
 * Real machine cards/actions are built by a follow-up agent.
 */

import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';

import { MachineCopy } from '../copy';
import { machineDisplayLabel, useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../theme/palette';

type Props = NativeStackScreenProps<RootStackParamList, 'Machines'>;

export default function MachinesScreen({ navigation }: Props) {
  const machines = useMachinesStore((state) => state.machines);
  const selectedMachineId = useMachinesStore((state) => state.selectedMachineId);
  const selectMachine = useMachinesStore((state) => state.selectMachine);

  return (
    <SafeAreaView style={styles.container} edges={['bottom']}>
      {machines.length === 0 ? (
        <View style={styles.emptyCard}>
          <Text style={styles.cardTitle}>{MachineCopy.emptyCard.title}</Text>
          <Text style={styles.cardBody}>{MachineCopy.emptyCard.body}</Text>
        </View>
      ) : (
        <FlatList
          data={machines}
          keyExtractor={(machine) => machine.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <Pressable style={styles.machineCard} onPress={() => selectMachine(item.id)}>
              <Text style={styles.cardTitle}>
                {machineDisplayLabel(item)}
                {item.id === selectedMachineId ? MachineCopy.card.selectedSuffix : ''}
              </Text>
              <Text style={styles.cardBody}>
                {`${item.username}@${item.host}:${item.port}`}
              </Text>
              <Text style={styles.cardBody}>{MachineCopy.card.switchHint}</Text>
            </Pressable>
          )}
        />
      )}
      <Pressable
        accessibilityRole="button"
        style={styles.addButton}
        onPress={() => navigation.navigate('MachineForm')}
      >
        <Text style={styles.addLabel}>Add</Text>
      </Pressable>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: GhostexPalette.BACKGROUND,
    padding: 12,
  },
  list: {
    gap: 8,
  },
  emptyCard: {
    padding: 12,
    minHeight: 104,
    borderRadius: GhostexRadii.card,
    backgroundColor: GhostexPalette.CARD_ACTIVE,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
  },
  machineCard: {
    padding: 12,
    borderRadius: GhostexRadii.card,
    backgroundColor: GhostexPalette.CARD,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
  },
  cardTitle: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 15,
    fontWeight: 'bold',
  },
  cardBody: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    marginTop: 6,
  },
  addButton: {
    marginTop: 12,
    height: 44,
    borderRadius: GhostexRadii.card,
    backgroundColor: GhostexPalette.ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addLabel: {
    color: GhostexPalette.ACCENT_FOREGROUND,
    fontSize: 15,
    fontWeight: '600',
  },
});
