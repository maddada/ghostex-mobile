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
  getTailcatToken,
  setSavedPassword,
  setSessionPassword,
  setTailcatToken,
  type MachineTransport,
} from './credentials';

export type { MachineTransport };

/** Tailcat tokens are opaque peer tokens; every one starts with this prefix. */
export const TAILCAT_TOKEN_PREFIX = 'tc';

/**
 * Stable, never-resolved identity for a tailcat machine. Native pins host keys
 * by host:port, so this has to be derived from the machine id and never change.
 */
export function tailcatSyntheticHost(machineId: string): string {
  return `tailcat-${machineId}`;
}

const MACHINES_STORAGE_KEY = 'machines.v1';
const SELECTED_MACHINE_STORAGE_KEY = 'machines.selectedId';
const HAS_SEEN_WELCOME_STORAGE_KEY = 'hasSeenWelcome';

export type MachineRecord = {
  id: string;
  name: string;
  /** Real hostname for `ssh`; the synthetic `tailcat-<id>` identity for `tailcat`. */
  host: string;
  username: string;
  /** The machine's own SSH port in both transports. */
  port: number;
  savePassword: boolean;
  /** Absent means `ssh` (every record written before tailcat existed). */
  transport?: MachineTransport;
  /**
   * Hidden from the Sessions screen: no tab, no drawer content, no connection
   * attempt, no polling. Absent means enabled (every record written before the
   * machine tab strip existed).
   */
  disabled?: boolean;
  /** ISO timestamp of the last successful connection, or null. */
  lastConnectedAt: string | null;
};

export type MachineInput = {
  name: string;
  /** Ignored for `tailcat`, which derives its synthetic host from the machine id. */
  host: string;
  username: string;
  /** Raw form value; validated as an integer 1-65535. */
  port: string | number;
  savePassword: boolean;
  /** Optional password captured by the editor form. */
  password?: string;
  /** Absent means `ssh`. */
  transport?: MachineTransport;
  /** Required for `tailcat`; persisted to the secure store, never to the record. */
  tailcatToken?: string;
};

export type MachineValidationErrors = {
  host?: string;
  username?: string;
  port?: string;
  duplicate?: string;
  password?: string;
  tailcatToken?: string;
  /** Form-level message: "Fix the highlighted machine details." */
  general: string;
};

export type MachineSaveResult =
  | { ok: true; machine: MachineRecord }
  | { ok: false; errors: MachineValidationErrors };

/**
 * displayLabel = name or `user@host[:port]` (port shown when not 22). A tailcat
 * machine's host is a synthetic identity, so it is never shown: the label falls
 * back to the username and is always tagged with the transport.
 */
export function machineDisplayLabel(machine: MachineRecord): string {
  if (machine.transport === 'tailcat') {
    const base = machine.name.length > 0 ? machine.name : machine.username;
    return `${base} · tailcat`;
  }
  if (machine.name.length > 0) return machine.name;
  const portSuffix = machine.port === 22 ? '' : `:${machine.port}`;
  return `${machine.username}@${machine.host}${portSuffix}`;
}

/** Records written before the machine tab strip existed have no flag at all. */
export function isMachineEnabled(machine: MachineRecord): boolean {
  return machine.disabled !== true;
}

/** Machines the Sessions screen shows tabs, content, and connections for. */
export function enabledMachines(state: Pick<MachinesState, 'machines'>): MachineRecord[] {
  return state.machines.filter(isMachineEnabled);
}

/**
 * The selection the Sessions screen can actually render: the candidate when it
 * is still an enabled machine, else the first enabled one, else nothing.
 */
function resolveSelectedMachineId(
  machines: readonly MachineRecord[],
  candidateId: string | null,
): string | null {
  const enabled = machines.filter(isMachineEnabled);
  if (candidateId !== null && enabled.some((machine) => machine.id === candidateId)) {
    return candidateId;
  }
  return enabled.length > 0 ? enabled[0].id : null;
}

function persistSelectedMachineId(machineId: string | null): void {
  if (machineId === null) void AsyncStorage.removeItem(SELECTED_MACHINE_STORAGE_KEY);
  else void AsyncStorage.setItem(SELECTED_MACHINE_STORAGE_KEY, machineId);
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
  transport: MachineTransport;
  tailcatToken: string;
} {
  return {
    name: input.name.trim(),
    host: input.host.trim(),
    username: input.username.trim(),
    port: parsePort(input.port),
    savePassword: input.savePassword,
    password: input.password ?? '',
    transport: input.transport ?? 'ssh',
    tailcatToken: (input.tailcatToken ?? '').trim(),
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
  const isTailcat = normalized.transport === 'tailcat';
  const errors: Omit<MachineValidationErrors, 'general'> = {};
  if (isTailcat) {
    // Editing keeps an already-saved token when the field stays blank.
    const storedToken = editingId === null ? null : await getTailcatToken(editingId);
    const effectiveToken =
      normalized.tailcatToken.length > 0 ? normalized.tailcatToken : (storedToken ?? '');
    if (effectiveToken.length === 0) errors.tailcatToken = MachineCopy.validation.tailcatTokenEmpty;
    else if (!effectiveToken.startsWith(TAILCAT_TOKEN_PREFIX)) {
      errors.tailcatToken = MachineCopy.validation.tailcatTokenPrefix;
    }
  } else if (normalized.host.length === 0) {
    errors.host = MachineCopy.validation.general;
  }
  if (normalized.username.length === 0) errors.username = MachineCopy.validation.general;
  if (normalized.port === null) errors.port = MachineCopy.validation.port;
  if (
    // Tailcat hosts are per-machine synthetic identities, so host+user+port can
    // never be a meaningful duplicate signal for them.
    !isTailcat &&
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

/**
 * Tokens live in the secure store, never in the persisted record. A blank token
 * while editing a tailcat machine keeps the stored one; leaving tailcat drops it.
 */
async function persistTailcatToken(
  machineId: string,
  transport: MachineTransport,
  token: string,
): Promise<void> {
  if (transport !== 'tailcat') {
    await setTailcatToken(machineId, '');
    return;
  }
  if (token.length > 0) await setTailcatToken(machineId, token);
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
  /** Show/hide a machine on the Sessions screen; reselects when needed. */
  setMachineDisabled: (id: string, disabled: boolean) => void;
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
    (record.transport === undefined ||
      record.transport === 'ssh' ||
      record.transport === 'tailcat') &&
    (record.disabled === undefined || typeof record.disabled === 'boolean') &&
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
    const selectedMachineId = resolveSelectedMachineId(machines, selectedId);
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
    const id = generateMachineId();
    const machine: MachineRecord = {
      id,
      name: normalized.name,
      host: normalized.transport === 'tailcat' ? tailcatSyntheticHost(id) : normalized.host,
      username: normalized.username,
      port: normalized.port as number,
      savePassword: normalized.savePassword,
      transport: normalized.transport,
      lastConnectedAt: null,
    };
    await persistPassword(machine.id, normalized.savePassword, normalized.password);
    await persistTailcatToken(machine.id, normalized.transport, normalized.tailcatToken);
    const nextMachines = [...get().machines, machine];
    const selectedMachineId = get().selectedMachineId ?? machine.id;
    set({ machines: nextMachines, selectedMachineId });
    persistMachines(nextMachines);
    persistSelectedMachineId(selectedMachineId);
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
      // The synthetic identity is derived from the id, so it survives edits and
      // is re-derived identically when an ssh machine is switched to tailcat.
      host:
        normalized.transport === 'tailcat' ? tailcatSyntheticHost(existing.id) : normalized.host,
      username: normalized.username,
      port: normalized.port as number,
      savePassword: normalized.savePassword,
      transport: normalized.transport,
    };
    await persistPassword(machine.id, normalized.savePassword, normalized.password);
    await persistTailcatToken(machine.id, normalized.transport, normalized.tailcatToken);
    const nextMachines = get().machines.map((entry) => (entry.id === id ? machine : entry));
    set({ machines: nextMachines });
    persistMachines(nextMachines);
    return { ok: true, machine };
  },

  removeMachine: async (id) => {
    await deleteAllCredentials(id);
    const nextMachines = get().machines.filter((machine) => machine.id !== id);
    const selectedMachineId = resolveSelectedMachineId(
      nextMachines,
      get().selectedMachineId === id ? null : get().selectedMachineId,
    );
    set({ machines: nextMachines, selectedMachineId });
    persistMachines(nextMachines);
    persistSelectedMachineId(selectedMachineId);
  },

  setMachineDisabled: (id, disabled) => {
    const nextMachines = get().machines.map((machine) =>
      machine.id === id ? { ...machine, disabled } : machine,
    );
    // Hiding the machine the drawer is showing hands the drawer to the next
    // enabled one, so the Sessions screen never renders a hidden machine.
    const selectedMachineId = resolveSelectedMachineId(nextMachines, get().selectedMachineId);
    set({ machines: nextMachines, selectedMachineId });
    persistMachines(nextMachines);
    persistSelectedMachineId(selectedMachineId);
  },

  selectMachine: (id) => {
    // A hidden machine is not a Sessions target, so it can never be selected.
    if (
      id !== null &&
      !get().machines.some((machine) => machine.id === id && isMachineEnabled(machine))
    ) {
      return;
    }
    set({ selectedMachineId: id });
    persistSelectedMachineId(id);
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
