/**
 * SSH machine store: persisted machine list (AsyncStorage), selection, and the
 * `hasSeenWelcome` onboarding flag. Validation per docs/specs/sessions-drawer.md §4.
 * Credentials live in ./credentials (expo-secure-store + in-memory).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { MachineCopy } from '../copy';
import {
  clearSessionPassword,
  deleteAllCredentials,
  deleteSavedPassword,
  getSavedPassword,
  setSavedPassword,
  setSessionPassword,
} from './credentials';

const MACHINES_STORAGE_KEY = 'machines.v1';
const SELECTED_MACHINE_STORAGE_KEY = 'machines.selectedId';
const HAS_SEEN_WELCOME_STORAGE_KEY = 'hasSeenWelcome';

export type MachineRecord = {
  id: string;
  name: string;
  host: string;
  username: string;
  port: number;
  savePassword: boolean;
  /** ISO timestamp of the last successful connection, or null. */
  lastConnectedAt: string | null;
};

export type MachineInput = {
  name: string;
  host: string;
  username: string;
  /** Raw form value; validated as an integer 1-65535. */
  port: string | number;
  savePassword: boolean;
  /** Optional password captured by the editor form. */
  password?: string;
};

export type MachineValidationErrors = {
  host?: string;
  username?: string;
  port?: string;
  duplicate?: string;
  password?: string;
  /** Form-level message: "Fix the highlighted machine details." */
  general: string;
};

export type MachineSaveResult =
  | { ok: true; machine: MachineRecord }
  | { ok: false; errors: MachineValidationErrors };

/** displayLabel = name or `user@host[:port]` (port shown when not 22). */
export function machineDisplayLabel(machine: MachineRecord): string {
  if (machine.name.length > 0) return machine.name;
  const portSuffix = machine.port === 22 ? '' : `:${machine.port}`;
  return `${machine.username}@${machine.host}${portSuffix}`;
}

function parsePort(value: string | number): number | null {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value.trim(), 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) return null;
  return parsed;
}

function normalizedInput(input: MachineInput): {
  name: string;
  host: string;
  username: string;
  port: number | null;
  savePassword: boolean;
  password: string;
} {
  return {
    name: input.name.trim(),
    host: input.host.trim(),
    username: input.username.trim(),
    port: parsePort(input.port),
    savePassword: input.savePassword,
    password: input.password ?? '',
  };
}

function isDuplicateTarget(
  machines: MachineRecord[],
  host: string,
  username: string,
  port: number,
  ignoreId: string | null,
): boolean {
  return machines.some(
    (machine) =>
      machine.id !== ignoreId &&
      machine.host.toLowerCase() === host.toLowerCase() &&
      machine.username === username &&
      machine.port === port,
  );
}

function generateMachineId(): string {
  const hex = (length: number): string =>
    Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;
}

async function validateInput(
  machines: MachineRecord[],
  input: MachineInput,
  editingId: string | null,
): Promise<MachineValidationErrors | null> {
  const normalized = normalizedInput(input);
  const errors: Omit<MachineValidationErrors, 'general'> = {};
  if (normalized.host.length === 0) errors.host = MachineCopy.validation.general;
  if (normalized.username.length === 0) errors.username = MachineCopy.validation.general;
  if (normalized.port === null) errors.port = MachineCopy.validation.port;
  if (
    normalized.host.length > 0 &&
    normalized.username.length > 0 &&
    normalized.port !== null &&
    isDuplicateTarget(machines, normalized.host, normalized.username, normalized.port, editingId)
  ) {
    errors.duplicate = MachineCopy.validation.duplicate;
  }
  if (normalized.savePassword && normalized.password.length === 0) {
    // Editing keeps an already-saved password when the field stays blank.
    const savedPassword = editingId === null ? null : await getSavedPassword(editingId);
    if (savedPassword === null || savedPassword.length === 0) {
      errors.password = MachineCopy.validation.savePasswordWithoutPassword;
    }
  }
  if (Object.keys(errors).length === 0) return null;
  return { ...errors, general: MachineCopy.validation.general };
}

async function persistPassword(machineId: string, savePassword: boolean, password: string): Promise<void> {
  if (savePassword) {
    if (password.length > 0) {
      await setSavedPassword(machineId, password);
      clearSessionPassword(machineId);
    }
    return;
  }
  await deleteSavedPassword(machineId);
  if (password.length > 0) setSessionPassword(machineId, password);
}

type MachinesState = {
  hydrated: boolean;
  machines: MachineRecord[];
  selectedMachineId: string | null;
  hasSeenWelcome: boolean;
  hydrate: () => Promise<void>;
  addMachine: (input: MachineInput) => Promise<MachineSaveResult>;
  updateMachine: (id: string, input: MachineInput) => Promise<MachineSaveResult>;
  removeMachine: (id: string) => Promise<void>;
  selectMachine: (id: string | null) => void;
  markConnected: (id: string) => void;
  setHasSeenWelcome: (value: boolean) => void;
};

function isMachineRecord(value: unknown): value is MachineRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.host === 'string' &&
    typeof record.username === 'string' &&
    typeof record.port === 'number' &&
    typeof record.savePassword === 'boolean' &&
    (record.lastConnectedAt === null || typeof record.lastConnectedAt === 'string')
  );
}

async function loadPersistedMachines(): Promise<MachineRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(MACHINES_STORAGE_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isMachineRecord);
  } catch {
    return [];
  }
}

function persistMachines(machines: MachineRecord[]): void {
  void AsyncStorage.setItem(MACHINES_STORAGE_KEY, JSON.stringify(machines));
}

export const useMachinesStore = create<MachinesState>()((set, get) => ({
  hydrated: false,
  machines: [],
  selectedMachineId: null,
  hasSeenWelcome: false,

  hydrate: async () => {
    if (get().hydrated) return;
    const [machines, selectedId, hasSeenWelcomeRaw] = await Promise.all([
      loadPersistedMachines(),
      AsyncStorage.getItem(SELECTED_MACHINE_STORAGE_KEY),
      AsyncStorage.getItem(HAS_SEEN_WELCOME_STORAGE_KEY),
    ]);
    const selectedMachineId =
      selectedId !== null && machines.some((machine) => machine.id === selectedId)
        ? selectedId
        : machines.length > 0
          ? machines[0].id
          : null;
    set({
      hydrated: true,
      machines,
      selectedMachineId,
      hasSeenWelcome: hasSeenWelcomeRaw === 'true',
    });
  },

  addMachine: async (input) => {
    const { machines } = get();
    const errors = await validateInput(machines, input, null);
    if (errors !== null) return { ok: false, errors };
    const normalized = normalizedInput(input);
    const machine: MachineRecord = {
      id: generateMachineId(),
      name: normalized.name,
      host: normalized.host,
      username: normalized.username,
      port: normalized.port as number,
      savePassword: normalized.savePassword,
      lastConnectedAt: null,
    };
    await persistPassword(machine.id, normalized.savePassword, normalized.password);
    const nextMachines = [...get().machines, machine];
    const selectedMachineId = get().selectedMachineId ?? machine.id;
    set({ machines: nextMachines, selectedMachineId });
    persistMachines(nextMachines);
    void AsyncStorage.setItem(SELECTED_MACHINE_STORAGE_KEY, selectedMachineId);
    return { ok: true, machine };
  },

  updateMachine: async (id, input) => {
    const { machines } = get();
    const existing = machines.find((machine) => machine.id === id);
    if (existing === undefined) {
      return {
        ok: false,
        errors: { general: MachineCopy.validation.general },
      };
    }
    const errors = await validateInput(machines, input, id);
    if (errors !== null) return { ok: false, errors };
    const normalized = normalizedInput(input);
    const machine: MachineRecord = {
      ...existing,
      name: normalized.name,
      host: normalized.host,
      username: normalized.username,
      port: normalized.port as number,
      savePassword: normalized.savePassword,
    };
    await persistPassword(machine.id, normalized.savePassword, normalized.password);
    const nextMachines = get().machines.map((entry) => (entry.id === id ? machine : entry));
    set({ machines: nextMachines });
    persistMachines(nextMachines);
    return { ok: true, machine };
  },

  removeMachine: async (id) => {
    await deleteAllCredentials(id);
    const nextMachines = get().machines.filter((machine) => machine.id !== id);
    const selectedMachineId =
      get().selectedMachineId === id
        ? nextMachines.length > 0
          ? nextMachines[0].id
          : null
        : get().selectedMachineId;
    set({ machines: nextMachines, selectedMachineId });
    persistMachines(nextMachines);
    if (selectedMachineId === null) void AsyncStorage.removeItem(SELECTED_MACHINE_STORAGE_KEY);
    else void AsyncStorage.setItem(SELECTED_MACHINE_STORAGE_KEY, selectedMachineId);
  },

  selectMachine: (id) => {
    if (id !== null && !get().machines.some((machine) => machine.id === id)) return;
    set({ selectedMachineId: id });
    if (id === null) void AsyncStorage.removeItem(SELECTED_MACHINE_STORAGE_KEY);
    else void AsyncStorage.setItem(SELECTED_MACHINE_STORAGE_KEY, id);
  },

  markConnected: (id) => {
    const nextMachines = get().machines.map((machine) =>
      machine.id === id ? { ...machine, lastConnectedAt: new Date().toISOString() } : machine,
    );
    set({ machines: nextMachines });
    persistMachines(nextMachines);
  },

  setHasSeenWelcome: (value) => {
    set({ hasSeenWelcome: value });
    void AsyncStorage.setItem(HAS_SEEN_WELCOME_STORAGE_KEY, value ? 'true' : 'false');
  },
}));

/** Convenience selector for the currently selected machine record. */
export function selectedMachine(state: Pick<MachinesState, 'machines' | 'selectedMachineId'>): MachineRecord | null {
  if (state.selectedMachineId === null) return null;
  return state.machines.find((machine) => machine.id === state.selectedMachineId) ?? null;
}
