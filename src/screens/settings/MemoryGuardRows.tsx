/**
 * Settings › Connection › Memory: the memory guard's two switches on one computer, the same as the
 * desktop's Settings › Power & Sleep › Memory (`memoryGuardEnabled`, `memoryGuardNotify`). They live
 * in that computer's settings, which its gxserver reads on every tick: read through
 * `/api/readMemoryGuard` and saved with `updateSettingsPatch`, like any settings write.
 *
 * CDXC:MemoryGuard 2026-11-14 DECISION:
 * User (Q3123): add the memory guard switches to the phone's Settings. The phone has no Power & Sleep
 * page, so they are a Memory section of Settings › Connection, where its computers are, for the
 * picked computer (the selected one first). Notify me when it steps in shows only while the guard is
 * on (the rule in AGENTS.md). A computer whose Ghostex is older answers `notFound`: the section says
 * to update it.
 * SEE-ALSO: server/src/memory_guard/mod.rs (the decision and `read_endpoint_value`),
 * apps/desktop/src/app/window/settings_modal/tabs/general/memory_guard.rs, ClaudeCompactionRows.tsx (the same shape).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import ActionSheet from '../../components/common/ActionSheet';
import { chatMachineLink } from '../../chat/rust/machine-link';
import { isDemoMachine } from '../../demo/identity';
import { isMachineEnabled, machineDisplayLabel, useMachinesStore, type MachineRecord } from '../../machines/store';
import { useAppearance } from '../../theme/useAppearance';
import { Caption, LinkRow, SectionHeader, ToggleRow, useSettingsStyles } from './SettingsControls';
import { SettingsSearchAnchor } from './search/SettingsSearchAnchor';

const CALL_TIMEOUT_MS = 15_000;

type Values = {
  memoryGuardEnabled: boolean;
  memoryGuardNotify: boolean;
};

type Loaded = { kind: 'loading' } | { kind: 'values'; values: Values } | { kind: 'failed'; message: string };

async function readValues(machine: MachineRecord): Promise<Loaded> {
  const answer = await chatMachineLink(machine).rpc('readMemoryGuard', {}, CALL_TIMEOUT_MS);
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
      memoryGuardEnabled: result.enabled !== false,
      memoryGuardNotify: result.notify !== false,
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
function useMemoryComputer(pickedId: string | null): { machine: MachineRecord | null; machines: MachineRecord[] } {
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

export function MemoryGuardRows() {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const { machine, machines } = useMemoryComputer(pickedId);
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [saveError, setSaveError] = useState<string | null>(null);
  const machineId = machine?.id ?? null;

  const load = useCallback(() => {
    if (machine === null) return () => undefined;
    let live = true;
    setLoaded({ kind: 'loading' });
    setSaveError(null);
    void readValues(machine).then((next) => {
      if (live) setLoaded(next);
    });
    return () => {
      live = false;
    };
    // Reload when the computer changes, not on every store update of the same one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machineId]);

  useEffect(() => load(), [load]);

  if (machine === null) return null;

  const change = (patch: Partial<Values>) => {
    if (loaded.kind !== 'values') return;
    const before = loaded.values;
    setLoaded({ kind: 'values', values: { ...before, ...patch } });
    setSaveError(null);
    void saveValue(machine, patch).then((error) => {
      if (error === null) return;
      setLoaded({ kind: 'values', values: before });
      setSaveError(`Couldn't save it on ${machineDisplayLabel(machine)}: ${error}`);
    });
  };

  return (
    <>
      <SectionHeader title="Memory" />
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
          <ToggleRow
            label="Stop sessions that run the computer out of memory"
            value={loaded.values.memoryGuardEnabled}
            onValueChange={(next) => change({ memoryGuardEnabled: next })}
          />
          <Caption>
            When {machineDisplayLabel(machine)} is about to run out of memory, Ghostex stops the build, test run or dev
            server an agent started that uses the most, restarts an agent that grew too big, and as a last step stops the
            session so you can resume it. Apps outside Ghostex are never touched.
          </Caption>
          {loaded.values.memoryGuardEnabled ? (
            <>
              <ToggleRow
                label="Notify me when it steps in"
                value={loaded.values.memoryGuardNotify}
                onValueChange={(next) => change({ memoryGuardNotify: next })}
              />
              <Caption>
                A notification on the computer and this phone whenever Ghostex stops or restarts something to free memory.
              </Caption>
            </>
          ) : null}
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
    <SettingsSearchAnchor label="Memory computer">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Memory settings for ${machineDisplayLabel(machine)}`}
        accessibilityHint="Picks another computer"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.row, local.computer, pressed && styles.rowPressed]}
      >
        <View style={styles.linkText}>
          <Text style={styles.linkTitle}>{machineDisplayLabel(machine)}</Text>
          <Text style={styles.linkDescription}>The memory settings below are saved on this computer</Text>
        </View>
        <Text style={[styles.chevron, { color: appearance.muted }]}>⌄</Text>
      </Pressable>
      <ActionSheet
        visible={open}
        title="Change memory settings on"
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
