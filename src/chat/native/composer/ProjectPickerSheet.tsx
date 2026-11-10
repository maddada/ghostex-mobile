/**
 * The phone's project list (`draft_project_picker.rs` and the New thread picker's project list on
 * desktop): one row per repository, with its computers as small chips while there is more than
 * one computer, the one it starts on (the last used for it) marked. Tapping the row takes the
 * project on that computer; tapping a chip takes that computer; a computer that isn't connected is
 * dimmed and can't be tapped. Recent projects come first; a project with no open session says so.
 * The composer's tray and the Sessions list's agent menu both open it. Each opening starts with an
 * empty search.
 *
 * CDXC:Sidebar 2026-11-04 DECISION:
 * User (Q1224, randomsand: with a project on 3 computers "the computer chips push the project name out of view"; "project name on top, the computers below it"): a row that lists computers, or says which repository it is (`detail`: `owner/repo` or "no remote", when two rows share a name), puts the name on its own line and those under it, so the name always has the row's width. Searching a computer's name next to the project's marks that computer (`filterProjectChoices`).
 * SEE-ALSO: CDXC:Sidebar 2026-11-03 in components/sessions/NewSessionPlace.tsx (why the computers
 * moved here).
 */

import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, TextInput, View } from 'react-native';

import type { UnifiedProjectChoice } from '../../../contract/unified/choices';
import { projectPickerRows } from '../../../contract/unified/projectList';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { Sheet } from './Sheet';

export function ProjectPickerSheet({
  visible,
  choices,
  title = 'Move to project',
  onClose,
  onDismissed,
  onPick,
}: {
  visible: boolean;
  choices: UnifiedProjectChoice[];
  title?: string;
  onClose: () => void;
  /** iOS: the sheet finished going away (`Sheet`). */
  onDismissed?: () => void;
  /** The picked project and the index of its computer in `choice.machines`. */
  onPick: (choice: UnifiedProjectChoice, machineIndex: number) => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const [query, setQuery] = useState('');
  // Each opening starts with an empty search (issue #558: the last search stayed typed in). Reset
  // while rendering the opening, so the old filter never shows for a frame.
  const [shownOpen, setShownOpen] = useState(visible);
  if (visible !== shownOpen) {
    setShownOpen(visible);
    if (visible) setQuery('');
  }
  const rows = useMemo(() => projectPickerRows(choices, query), [choices, query]);
  // Chips only mean something with more than one computer.
  const chips = useMemo(
    () => new Set(choices.flatMap((choice) => choice.machines.map((machine) => machine.machineId))).size > 1,
    [choices],
  );
  return (
    <Sheet visible={visible} onClose={onClose} onDismissed={onDismissed} title={title} maxHeight="70%">
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
        keyExtractor={(row) => row.key}
        ListEmptyComponent={<Text style={styles.empty}>No projects match</Text>}
        renderItem={({ item }) =>
          item.kind === 'heading' ? (
            <Text style={styles.heading}>{item.label}</Text>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={item.choice.label}
              onPress={() => onPick(item.choice, item.choice.selected)}
              style={({ pressed }) => [styles.row, pressed ? styles.pressed : null]}
            >
              <View style={styles.body}>
                {/* The tile sits on the name's line, not centred on a two-line row ("keep the icon of the project aligned with it's name"). */}
                <View style={styles.nameLine}>
                  <View style={styles.tile}>
                    <Text style={styles.tileText}>{item.choice.label.slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <Text numberOfLines={1} style={styles.label}>
                    {item.choice.label}
                  </Text>
                  {item.choice.hasSessions ? null : <Text style={styles.note}>No sessions</Text>}
                </View>
                {chips || item.choice.detail !== null ? (
                  <View style={styles.placeLine}>
                    {item.choice.detail !== null ? (
                      <Text numberOfLines={1} style={styles.detail}>
                        {item.choice.detail}
                      </Text>
                    ) : null}
                    {chips
                      ? item.choice.machines.map((machine, index) => {
                          const on = index === item.choice.selected;
                          return (
                            <Pressable
                              key={machine.machineId}
                              accessibilityRole="button"
                              accessibilityLabel={
                                machine.connected ? `${item.choice.label} on ${machine.label}` : `${machine.label}, not connected`
                              }
                              accessibilityState={{ selected: on, disabled: !machine.connected }}
                              disabled={!machine.connected}
                              hitSlop={4}
                              onPress={() => onPick(item.choice, index)}
                              style={[styles.chip, on ? styles.chipOn : null, machine.connected ? null : styles.chipAway]}
                            >
                              <Text numberOfLines={1} style={[styles.chipText, on ? styles.chipTextOn : null]}>
                                {machine.label}
                              </Text>
                            </Pressable>
                          );
                        })
                      : null}
                  </View>
                ) : null}
              </View>
            </Pressable>
          )
        }
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
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  body: { flex: 1, minWidth: 0, gap: 4 },
  nameLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  // Under the name: past the tile (20) and its gap (10).
  placeLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 4, paddingLeft: 30 },
  detail: { color: P.muted, fontSize: 12, marginRight: 4, flexShrink: 1 },
  pressed: { backgroundColor: P.border },
  label: { flex: 1, minWidth: 0, color: P.primary, fontSize: 14 },
  tile: {
    width: 20,
    height: 20,
    marginRight: 2,
    borderRadius: 5,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: P.border,
  },
  tileText: { color: P.muted, fontSize: 11, fontWeight: '600' },
  note: { color: P.muted, fontSize: 12 },
  chip: {
    maxWidth: 96,
    height: 24,
    paddingHorizontal: 7,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: P.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipOn: { backgroundColor: P.border },
  chipAway: { opacity: 0.45 },
  chipText: { color: P.muted, fontSize: 12 },
  chipTextOn: { color: P.primary, fontWeight: '600' },
  heading: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
    color: P.muted,
    fontSize: 11,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  empty: { paddingHorizontal: 12, paddingVertical: 14, color: P.muted, fontSize: 14 },
}));
