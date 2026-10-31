/**
 * The tray's project search on the phone (`draft_project_picker.rs` on desktop): one row per
 * repository with a chip per machine. Tapping a row moves the draft to the machine its chip shows;
 * tapping a chip moves it to that machine.
 */

import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';

import { filterProjectChoices, type UnifiedChoiceMachine, type UnifiedProjectChoice } from '../../../contract/unified/choices';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { Sheet } from './Sheet';

export function ProjectPickerSheet({
  visible,
  choices,
  onClose,
  onPick,
}: {
  visible: boolean;
  choices: UnifiedProjectChoice[];
  onClose: () => void;
  onPick: (choice: UnifiedProjectChoice, machine: UnifiedChoiceMachine) => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const [query, setQuery] = useState('');
  const rows = useMemo(() => filterProjectChoices(choices, query), [choices, query]);
  const pick = (choice: UnifiedProjectChoice, machine: UnifiedChoiceMachine | undefined): void => {
    if (machine === undefined || !machine.connected) return;
    onPick(choice, machine);
  };
  return (
    <Sheet visible={visible} onClose={onClose} title="Move to project" maxHeight="70%">
      <TextInput
        accessibilityLabel="Search projects"
        placeholder="Search projects"
        placeholderTextColor={P.muted}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
        autoCapitalize="none"
        style={styles.search}
      />
      <FlatList
        data={rows}
        keyboardShouldPersistTaps="handled"
        keyExtractor={(row) => row.repoKey}
        ListEmptyComponent={<Text style={styles.empty}>No projects match</Text>}
        renderItem={({ item }) => (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={item.label}
            onPress={() => pick(item, item.machines[item.selected])}
            style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
          >
            <Text numberOfLines={1} style={styles.label}>
              {item.label}
            </Text>
            {item.machines.map((machine, index) => (
              <Pressable
                key={machine.machineId}
                accessibilityRole="button"
                accessibilityLabel={machine.label}
                accessibilityState={{ disabled: !machine.connected, selected: index === item.selected }}
                onPress={() => pick(item, machine)}
                style={[
                  styles.chip,
                  index === item.selected ? styles.chipOn : null,
                  machine.connected ? null : styles.chipAway,
                ]}
              >
                <Text numberOfLines={1} style={[styles.chipText, index === item.selected ? styles.chipTextOn : null]}>
                  {machine.label}
                </Text>
              </Pressable>
            ))}
          </Pressable>
        )}
      />
    </Sheet>
  );
}

const useStyles = themedStyles((P) => ({
  search: {
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 10,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: P.border,
    color: P.primary,
    fontSize: 14,
  },
  row: {
    minHeight: 44,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pressed: { backgroundColor: P.border },
  label: { flex: 1, minWidth: 0, color: P.primary, fontSize: 14 },
  chip: {
    maxWidth: 96,
    height: 26,
    paddingHorizontal: 8,
    justifyContent: 'center',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: P.border,
  },
  chipOn: { borderColor: P.muted },
  chipAway: { opacity: 0.45 },
  chipText: { color: P.muted, fontSize: 12 },
  chipTextOn: { color: P.primary },
  empty: { paddingHorizontal: 12, paddingVertical: 14, color: P.muted, fontSize: 14 },
}));
