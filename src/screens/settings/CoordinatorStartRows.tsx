/**
 * Settings › Chat › Coordinators: what a new coordinator starts on, on one computer, the same two
 * settings as the desktop's Settings › Chat (`coordinatorModel`, `coordinatorEffort`). They live in
 * that computer's settings, which its gxserver reads when it creates a coordinator: read through
 * `/api/readCoordinatorStart` and saved with `updateSettingsPatch`, like any settings write.
 *
 * CDXC:Coordinators 2026-11-17 SEE-ALSO: the user's decision (Opus 5.5 at Medium by default, the same
 * rows on the phone, no pickers in New Coordinator) is at `coordinator_start_model` in
 * packages/gx-protocol/src/coordinator.rs. A computer whose Ghostex is older answers `notFound`: the
 * section says to update it. Shape: ClaudeCompactionRows.tsx.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import ActionSheet from '../../components/common/ActionSheet';
import { chatMachineLink } from '../../chat/rust/machine-link';
import { isDemoMachine } from '../../demo/identity';
import { isMachineEnabled, machineDisplayLabel, useMachinesStore, type MachineRecord } from '../../machines/store';
import { useAppearance } from '../../theme/useAppearance';
import { Caption, ChoiceRow, LinkRow, SectionHeader, useSettingsStyles } from './SettingsControls';
import { SettingsSearchAnchor } from './search/SettingsSearchAnchor';

const CALL_TIMEOUT_MS = 15_000;

/** The desktop's Coordinator model choices (`COORDINATOR_MODEL_OPTIONS`), in its order. */
const MODEL_OPTIONS = [
  { value: 'opus', label: 'Opus 5.5' },
  { value: 'agent', label: 'Agent default' },
] as const;

/** The desktop's Coordinator effort choices (`COORDINATOR_EFFORT_OPTIONS`), in its order. */
const EFFORT_OPTIONS = [
  { value: 'agent', label: 'Agent default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
] as const;

type Model = (typeof MODEL_OPTIONS)[number]['value'];
type Effort = (typeof EFFORT_OPTIONS)[number]['value'];

type Values = { coordinatorModel: Model; coordinatorEffort: Effort };

type Loaded = { kind: 'loading' } | { kind: 'values'; values: Values } | { kind: 'failed'; message: string };

async function readValues(machine: MachineRecord): Promise<Loaded> {
  const answer = await chatMachineLink(machine).rpc('readCoordinatorStart', {}, CALL_TIMEOUT_MS);
  if (answer.error !== null) {
    return {
      kind: 'failed',
      message:
        answer.error.code === 'notFound'
          ? `Update Ghostex on ${machineDisplayLabel(machine)} to change these from the phone.`
          : answer.error.message,
    };
  }
  const result = (answer.result ?? {}) as Record<string, unknown>;
  return {
    kind: 'values',
    values: {
      coordinatorModel: MODEL_OPTIONS.find((option) => option.value === result.model)?.value ?? 'opus',
      coordinatorEffort: EFFORT_OPTIONS.find((option) => option.value === result.effort)?.value ?? 'medium',
    },
  };
}

async function saveValue(machine: MachineRecord, patch: Partial<Values>): Promise<string | null> {
  const answer = await chatMachineLink(machine).rpc(
    'dispatchRendererCommand',
    { action: 'updateSettingsPatch', payload: { patch } },
    CALL_TIMEOUT_MS,
  );
  return answer.error === null ? null : answer.error.message;
}

/** The computers that can be picked, and the one shown: the picked one, else the selected one. */
function useCoordinatorComputer(pickedId: string | null): { machine: MachineRecord | null; machines: MachineRecord[] } {
  const all = useMachinesStore((state) => state.machines);
  const selectedId = useMachinesStore((state) => state.selectedMachineId);
  return useMemo(() => {
    const machines = all.filter((entry) => isMachineEnabled(entry) && !isDemoMachine(entry));
    const machine =
      machines.find((entry) => entry.id === pickedId) ??
      machines.find((entry) => entry.id === selectedId) ??
      machines[0] ??
      null;
    return { machine, machines };
  }, [all, pickedId, selectedId]);
}

export function CoordinatorStartRows() {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const { machine, machines } = useCoordinatorComputer(pickedId);
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [saveError, setSaveError] = useState<string | null>(null);
  const machineId = machine?.id ?? null;
  // The newest record of the shown computer, so Try again dials its current host.
  const machineRef = useRef(machine);
  machineRef.current = machine;
  // One generation for every read, advanced by each read and by a change of computer: an answer
  // (a read, or a save's failure) from an older one never touches what is shown.
  const generation = useRef(0);
  // What the computer is known to hold, so a failed save puts back only its own field.
  const confirmed = useRef<Values | null>(null);
  // The newest save of each field, and the saves that have finished.
  const saveCount = useRef(0);
  const latestSave = useRef<Record<keyof Values, number>>({ coordinatorModel: 0, coordinatorEffort: 0 });
  const settledSaves = useRef(new Set<number>());

  const load = useCallback(() => {
    const current = machineRef.current;
    const mine = ++generation.current;
    confirmed.current = null;
    if (current === null) return;
    setLoaded({ kind: 'loading' });
    setSaveError(null);
    void readValues(current).then((next) => {
      if (generation.current !== mine) return;
      if (next.kind === 'values') confirmed.current = next.values;
      setLoaded(next);
    });
  }, []);

  // Reload when the computer changes, not on every store update of the same one.
  useEffect(() => {
    load();
    return () => {
      generation.current += 1;
    };
  }, [machineId, load]);

  if (machine === null) return null;

  const change = (patch: Partial<Values>) => {
    if (loaded.kind !== 'values') return;
    const mine = generation.current;
    const keys = (Object.keys(patch) as (keyof Values)[]).filter((key) => patch[key] !== undefined);
    const save = ++saveCount.current;
    for (const key of keys) latestSave.current[key] = save;
    setLoaded({ kind: 'values', values: { ...loaded.values, ...patch } });
    setSaveError(null);
    void saveValue(machine, patch).then((error) => {
      if (generation.current !== mine || confirmed.current === null) return;
      settledSaves.current.add(save);
      if (error === null) confirmed.current = { ...confirmed.current, ...patch };
      // Once a field's newest save has finished, the field shows what the computer holds, so a
      // late success after a newer failure (or a failure after a newer success) ends in sync.
      // A field whose newest save is still running keeps showing that pick.
      const known: Values = confirmed.current;
      const settle: Partial<Values> = {};
      for (const key of keys) {
        if (settledSaves.current.has(latestSave.current[key])) Object.assign(settle, { [key]: known[key] });
      }
      if (Object.keys(settle).length > 0) {
        setLoaded((shown) => (shown.kind === 'values' ? { kind: 'values', values: { ...shown.values, ...settle } } : shown));
      }
      if (error !== null) setSaveError(`Couldn't save it on ${machineDisplayLabel(machine)}: ${error}`);
    });
  };

  return (
    <>
      <SectionHeader title="Coordinator model" />
      {machines.length > 1 ? <ComputerRow machine={machine} machines={machines} onPick={setPickedId} /> : null}
      {loaded.kind === 'loading' ? <Caption>Reading {machineDisplayLabel(machine)}'s settings…</Caption> : null}
      {loaded.kind === 'failed' ? (
        <>
          <Caption>{loaded.message}</Caption>
          <LinkRow title="Try again" onPress={() => load()} />
        </>
      ) : null}
      {loaded.kind === 'values' ? (
        <>
          {MODEL_OPTIONS.map((option) => (
            <ChoiceRow
              key={option.value}
              label={option.label}
              selected={loaded.values.coordinatorModel === option.value}
              onPress={() => change({ coordinatorModel: option.value })}
            />
          ))}
          <Caption>
            The model a new coordinator starts on. Opus 5.5 works best on Claude; Agent default uses the agent's usual
            model. Change a running coordinator's model in its chat.
          </Caption>
          <SectionHeader title="Coordinator effort" />
          {EFFORT_OPTIONS.map((option) => (
            <ChoiceRow
              key={option.value}
              label={option.label}
              selected={loaded.values.coordinatorEffort === option.value}
              onPress={() => change({ coordinatorEffort: option.value })}
            />
          ))}
          <Caption>
            The effort a new coordinator starts on. Medium is plenty for most coordinators; Agent default uses the
            agent's usual effort. Change a running coordinator's effort in its chat.
          </Caption>
          {saveError !== null ? <Caption>{saveError}</Caption> : null}
        </>
      ) : null}
    </>
  );
}

/** Which computer the rows change; a tap picks another. */
function ComputerRow({
  machine,
  machines,
  onPick,
}: {
  machine: MachineRecord;
  machines: MachineRecord[];
  onPick: (id: string) => void;
}) {
  const styles = useSettingsStyles();
  const appearance = useAppearance();
  const [open, setOpen] = useState(false);
  return (
    <SettingsSearchAnchor label="Coordinator computer">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Coordinator settings for ${machineDisplayLabel(machine)}`}
        accessibilityHint="Picks another computer"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.row, local.computer, pressed && styles.rowPressed]}
      >
        <View style={styles.linkText}>
          <Text style={styles.linkTitle}>{machineDisplayLabel(machine)}</Text>
          <Text style={styles.linkDescription}>New coordinators on this computer start on what you pick below</Text>
        </View>
        <Text style={[styles.chevron, { color: appearance.muted }]}>⌄</Text>
      </Pressable>
      <ActionSheet
        visible={open}
        title="Change coordinator settings on"
        items={machines.map((entry) => ({
          key: entry.id,
          label: `${entry.id === machine.id ? '✓ ' : ''}${machineDisplayLabel(entry)}`,
          onPress: () => {
            setOpen(false);
            onPick(entry.id);
          },
        }))}
        onClose={() => setOpen(false)}
      />
    </SettingsSearchAnchor>
  );
}

const local = StyleSheet.create({
  computer: { minHeight: 56 },
});
