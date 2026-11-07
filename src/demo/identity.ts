/**
 * The offline demo computer: one saved machine whose inventory, chat, terminal
 * and preview never leave the phone. A stable id so removal, settings and the
 * command router all name the same record.
 */

import type { MachineRecord } from '../machines/store';

/** Persisted id of the sample machine. Never reused for a paired computer. */
export const DEMO_MACHINE_ID = 'demo-computer';

export const DEMO_MACHINE_NAME = 'Demo computer';

export function isDemoMachineId(machineId: string | null | undefined): boolean {
  return machineId === DEMO_MACHINE_ID;
}

export function isDemoMachine(machine: { id: string; transport?: string } | null | undefined): boolean {
  return machine !== undefined && machine !== null && (machine.transport === 'demo' || machine.id === DEMO_MACHINE_ID);
}

/** The record written into the machine list. No password, key, or pairing token. */
export function demoMachineRecord(nowIso: string | null = null): MachineRecord {
  return {
    id: DEMO_MACHINE_ID,
    name: DEMO_MACHINE_NAME,
    host: 'demo.local',
    username: 'demo',
    port: 22,
    savePassword: false,
    transport: 'demo',
    lastConnectedAt: nowIso,
    computerName: DEMO_MACHINE_NAME,
  };
}
