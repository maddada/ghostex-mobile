/**
 * Settings › Chat › Claude Code: Claude Code's idle compaction and prompt cache length on one
 * computer, the same three settings as the desktop's Settings › Agents › Claude Code › Context
 * (`claudeIdleCompaction`, `claudeIdleCompactAbove`, `claudeOneHourPromptCache`). They live in that
 * computer's settings, which its gxserver hands to each Claude launch: read through
 * `/api/readClaudeCompaction` and saved with `updateSettingsPatch`, like any settings write.
 *
 * CDXC:AgentProviders 2026-11-14 DECISION:
 * User (Q3111): add the three Claude idle compaction rows to the phone's Settings. The phone has no
 * per-agent page, so they are a Claude Code section of Settings › Chat for the picked computer
 * (the selected one first), and Only above shows only while the switch is on (the rule in
 * AGENTS.md). A computer whose Ghostex is older answers `notFound`: the section says to update it.
 * SEE-ALSO: server/src/agents/claude_idle_compaction.rs (where the user's decision is),
 * apps/desktop/src/app/window/settings_modal/tabs/agents/claude_context.rs.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import ActionSheet from '../../components/common/ActionSheet';
import { chatMachineLink } from '../../chat/rust/machine-link';
import { isDemoMachine } from '../../demo/identity';
import { isMachineEnabled, machineDisplayLabel, useMachinesStore, type MachineRecord } from '../../machines/store';
import { useAppearance } from '../../theme/useAppearance';
import { Caption, LinkRow, SectionHeader, SegmentedRow, ToggleRow, useSettingsStyles } from './SettingsControls';
import { SettingsSearchAnchor } from './search/SettingsSearchAnchor';

const CALL_TIMEOUT_MS = 15_000;

/** The desktop's "Only above" choices (`CLAUDE_IDLE_COMPACT_MIN_TOKENS_OPTIONS`). */
const ONLY_ABOVE_OPTIONS = [
  { value: '100000', label: '100K' },
  { value: '200000', label: '200K' },
  { value: '300000', label: '300K' },
  { value: '400000', label: '400K' },
  { value: '500000', label: '500K' },
] as const;

type OnlyAbove = (typeof ONLY_ABOVE_OPTIONS)[number]['value'];

type Values = {
  claudeIdleCompaction: boolean;
  claudeIdleCompactAbove: OnlyAbove;
  claudeOneHourPromptCache: boolean;
};

type Loaded = { kind: 'loading' } | { kind: 'values'; values: Values } | { kind: 'failed'; message: string };

function onlyAbove(value: unknown): OnlyAbove {
  return ONLY_ABOVE_OPTIONS.find((option) => option.value === String(value))?.value ?? '200000';
}

async function readValues(machine: MachineRecord): Promise<Loaded> {
  const answer = await chatMachineLink(machine).rpc('readClaudeCompaction', {}, CALL_TIMEOUT_MS);
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
      claudeIdleCompaction: result.idleCompaction !== false,
      claudeIdleCompactAbove: onlyAbove(result.idleCompactAbove),
      claudeOneHourPromptCache: result.oneHourPromptCache === true,
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
function useClaudeComputer(pickedId: string | null): { machine: MachineRecord | null; machines: MachineRecord[] } {
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

export function ClaudeCompactionRows() {
  const [pickedId, setPickedId] = useState<string | null>(null);
  const { machine, machines } = useClaudeComputer(pickedId);
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
      <SectionHeader title="Claude Code" />
      {machines.length > 1 ? (
        <ComputerRow machine={machine} machines={machines} onPick={setPickedId} />
      ) : null}
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
            label="Compact idle chats before the prompt cache expires"
            value={loaded.values.claudeIdleCompaction}
            onValueChange={(next) => change({ claudeIdleCompaction: next })}
          />
          {loaded.values.claudeIdleCompaction ? (
            <>
              <Caption>Only above: compact only chats whose context is at least this size.</Caption>
              <SegmentedRow
                label="Only above"
                options={ONLY_ABOVE_OPTIONS}
                value={loaded.values.claudeIdleCompactAbove}
                onChange={(next) => change({ claudeIdleCompactAbove: next })}
              />
            </>
          ) : null}
          <ToggleRow
            label="Use a 1-hour prompt cache"
            value={loaded.values.claudeOneHourPromptCache}
            onValueChange={(next) => change({ claudeOneHourPromptCache: next })}
          />
          {saveError !== null ? <Caption>{saveError}</Caption> : null}
          <Caption>
            Claude Code compacts a long chat that has been idle for about 54 minutes, just before its 1-hour prompt cache
            expires, so your next message doesn't re-read the whole chat uncached. It runs only on a 1-hour cache, which a
            Claude subscription gets; an API key, Bedrock, Vertex or Foundry gets 5 minutes unless Use a 1-hour prompt
            cache is on, and 1-hour cache writes cost more. Saved on {machineDisplayLabel(machine)}; applies to Claude
            sessions started or resumed after you change it.
          </Caption>
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
    <SettingsSearchAnchor label="Claude Code computer">
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Claude Code settings for ${machineDisplayLabel(machine)}`}
        accessibilityHint="Picks another computer"
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.row, local.computer, pressed && styles.rowPressed]}
      >
        <View style={styles.linkText}>
          <Text style={styles.linkTitle}>{machineDisplayLabel(machine)}</Text>
          <Text style={styles.linkDescription}>The Claude Code settings below are saved on this computer</Text>
        </View>
        <Text style={[styles.chevron, { color: appearance.muted }]}>⌄</Text>
      </Pressable>
      <ActionSheet
        visible={open}
        title="Change Claude Code settings on"
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
