/**
 * The computer Settings › Voice and its Language page change: the one picked at the
 * top of Settings › Voice (or by a chat's "Voice settings"), else the selected computer.
 */

import { useMemo } from 'react';

import { isMachineEnabled, useMachinesStore, type MachineRecord } from '../../machines/store';
import { useDictateStore } from '../../voice/dictateSettings';

/** The computer Settings › Voice changes: the one picked, else the selected one, else the first. */
export function useVoiceComputer(): { machine: MachineRecord | null; machines: MachineRecord[] } {
  const all = useMachinesStore((state) => state.machines);
  const selectedId = useMachinesStore((state) => state.selectedMachineId);
  const pickedId = useDictateStore((state) => state.machineId);
  return useMemo(() => {
    const machines = all.filter(isMachineEnabled);
    const machine =
      machines.find((entry) => entry.id === pickedId) ??
      machines.find((entry) => entry.id === selectedId) ??
      machines[0] ??
      null;
    return { machine, machines };
  }, [all, pickedId, selectedId]);
}

/** A computer's short name for the section titles: "MacBook Pro". */
export function computerName(machine: MachineRecord): string {
  return machine.computerName ?? (machine.name.length > 0 ? machine.name : machine.host);
}
