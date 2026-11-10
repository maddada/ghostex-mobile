/**
 * SSH machine store: persisted machine list (AsyncStorage) and selection.
 * Validation per docs/specs/sessions-drawer.md §4. Credentials live in
 * ./credentials (expo-secure-store + in-memory). Welcome is gated on
 * `machines.length === 0`, so there is no separate onboarding flag.
 *
 * `transport: 'tailcat'` stays the persisted value for Easy Connect machines
 * (no `machines.v1` migration); only the labels say "Easy Connect".
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { MachineCopy } from '../copy';
import { dedupeMachineRecords, machineForSameComputer, tailcatServerKey } from './computerIdentity';
import {
  clearSessionPassword,
  deleteAllCredentials,
  deleteSavedPassword,
  getSavedPassword,
  getTailcatToken,
  setEasyConnectAddresses,
  setSavedPassword,
  setSessionPassword,
  setTailcatToken,
  type MachineTransport,
} from './credentials';
import { migrateMachineData } from './machineDataMigration';
import { forgetProvenServerKeys, loadProvenServerKeys, PROVEN_SERVER_KEYS_STORAGE_KEY } from './provenComputer';
import { demoMachineRecord, DEMO_MACHINE_ID, isDemoMachine } from '../demo/identity';
import { resetDemoWorld } from '../demo/world';

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

/** User-facing name of the `tailcat` transport. */
export const EASY_CONNECT_LABEL = 'Easy Connect';

/** How a machine is reached, in the words the app uses for it. */
export function machineTransportLabel(machine: Pick<MachineRecord, 'transport'>): string {
  if (machine.transport === 'demo') return 'Demo';
  return machine.transport === 'tailcat' ? EASY_CONNECT_LABEL : 'Tailscale';
}

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
  /** Id `/api/pairDevice` assigned to this phone on the computer (Easy Connect). */
  deviceId?: string;
  /** ISO timestamp of the Easy Connect pairing. */
  pairedAt?: string;
  /** The computer's display name as the pairing code / registration reported it. */
  computerName?: string;
  /** gxserver API port reachable through the Easy Connect tunnel. */
  gxserverPort?: number;
  /**
   * Tailscale SSH: the tailnet's SSH policy authenticates, so the phone sends
   * no password and no key. Absent means off.
   */
  tailscaleSsh?: boolean;
};

/** Pairing metadata written by Easy Connect registration; never edited by hand. */
export type MachinePairingFields = Pick<MachineRecord, 'deviceId' | 'pairedAt' | 'computerName' | 'gxserverPort'>;

export type MachineInput = MachinePairingFields & {
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
  /** Tailscale SSH flag; absent leaves the stored value untouched. */
  tailscaleSsh?: boolean;
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

export type MachineSaveResult = { ok: true; machine: MachineRecord } | { ok: false; errors: MachineValidationErrors };

/**
 * displayLabel = name or `user@host[:port]` (port shown when not 22). A tailcat
 * machine's host is a synthetic identity, so it is never shown: the label falls
 * back to the username and is always tagged with the transport.
 */
export function machineDisplayLabel(machine: MachineRecord): string {
  if (machine.transport === 'demo') return machine.name.length > 0 ? machine.name : 'Demo computer';
  if (machine.transport === 'tailcat') {
    const base = machine.name.length > 0 ? machine.name : machine.username;
    return `${base} · ${EASY_CONNECT_LABEL}`;
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
function resolveSelectedMachineId(machines: readonly MachineRecord[], candidateId: string | null): string | null {
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
    const effectiveToken = normalized.tailcatToken.length > 0 ? normalized.tailcatToken : (storedToken ?? '');
    if (effectiveToken.length === 0) errors.tailcatToken = MachineCopy.validation.tailcatTokenEmpty;
    else if (!effectiveToken.startsWith(TAILCAT_TOKEN_PREFIX)) {
      errors.tailcatToken = MachineCopy.validation.tailcatTokenPrefix;
    } else {
      // A second record for one computer runs a second tunnel to it, which breaks both (see computerIdentity.ts).
      const tokens = await loadTailcatTokens(machines);
      const sameComputer = machineForSameComputer(machines, (id) => tokens.get(id) ?? null, effectiveToken, editingId);
      if (sameComputer !== null) {
        errors.duplicate = MachineCopy.validation.duplicateComputer(machineDisplayLabel(sameComputer));
      }
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
async function persistTailcatToken(machineId: string, transport: MachineTransport, token: string): Promise<void> {
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
  hydrate: () => Promise<void>;
  addMachine: (input: MachineInput) => Promise<MachineSaveResult>;
  updateMachine: (id: string, input: MachineInput) => Promise<MachineSaveResult>;
  removeMachine: (id: string) => Promise<void>;
  /** Saves the bundled sample computer, or selects it again when it is already saved. */
  addDemoComputer: () => MachineRecord;
  /** Show/hide a machine on the Sessions screen; reselects when needed. */
  setMachineDisabled: (id: string, disabled: boolean) => void;
  /** Moves a machine one place left or right in the Sessions tab strip (see `moveMachine`). */
  moveMachine: (id: string, direction: 'left' | 'right') => void;
  selectMachine: (id: string | null) => void;
  markConnected: (id: string) => void;
  /** This phone's paired-device id on an SSH machine, from pairing over SSH (`sshPairing.ts`); `undefined` clears it. */
  setMachineDeviceId: (id: string, deviceId: string | undefined) => void;
};

/** The pairing fields present on an input, so an edit never clears them by omission. */
function pairingFieldsOf(input: MachinePairingFields): MachinePairingFields {
  const fields: MachinePairingFields = {};
  if (input.deviceId !== undefined) fields.deviceId = input.deviceId;
  if (input.pairedAt !== undefined) fields.pairedAt = input.pairedAt;
  if (input.computerName !== undefined) fields.computerName = input.computerName;
  if (input.gxserverPort !== undefined) fields.gxserverPort = input.gxserverPort;
  return fields;
}

/** The Tailscale SSH flag when the input carries one, so an edit never clears it by omission. */
function tailscaleSshOf(input: MachineInput): Pick<MachineRecord, 'tailscaleSsh'> {
  return input.tailscaleSsh === undefined ? {} : { tailscaleSsh: input.tailscaleSsh };
}

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
      record.transport === 'tailcat' ||
      record.transport === 'demo') &&
    (record.disabled === undefined || typeof record.disabled === 'boolean') &&
    (record.lastConnectedAt === null || typeof record.lastConnectedAt === 'string') &&
    (record.deviceId === undefined || typeof record.deviceId === 'string') &&
    (record.pairedAt === undefined || typeof record.pairedAt === 'string') &&
    (record.computerName === undefined || typeof record.computerName === 'string') &&
    (record.gxserverPort === undefined || typeof record.gxserverPort === 'number') &&
    (record.tailscaleSsh === undefined || typeof record.tailscaleSsh === 'boolean')
  );
}

/** The saved Easy Connect address of every tailcat machine in `machines`, by id. */
async function loadTailcatTokens(machines: readonly MachineRecord[]): Promise<Map<string, string>> {
  const tailcat = machines.filter((machine) => machine.transport === 'tailcat');
  const tokens = await Promise.all(tailcat.map((machine) => getTailcatToken(machine.id)));
  const byId = new Map<string, string>();
  tailcat.forEach((machine, index) => {
    const token = tokens[index];
    if (token !== null && token !== undefined && token.length > 0) byId.set(machine.id, token);
  });
  return byId;
}

/**
 * CDXC:RemotePairing 2026-11-05 DECISION:
 * Brief: "A phone never runs two tunnels to the same computer, and old duplicate records heal by
 * themselves." Loading collapses Easy Connect records for one computer into the newest pairing,
 * moves what the phone saved under the dropped ids (selected machine, workspaces, drawer state,
 * terminal tabs, chat drafts) to the kept id, and deletes the dropped records' credentials. It runs
 * before anything connects, so the dropped records never start a tunnel.
 */
async function healDuplicateComputers(machines: MachineRecord[]): Promise<MachineRecord[]> {
  try {
    const tokens = await loadTailcatTokens(machines);
    // Records under different addresses are one computer when earlier connects proved it (provenComputer.ts).
    const proven = await loadProvenServerKeys((id) => tokens.get(id) ?? null);
    const { machines: deduped, merges } = dedupeMachineRecords(
      machines,
      (id) => tokens.get(id) ?? null,
      (id) => proven[id] ?? [],
    );
    if (merges.length === 0) return machines;
    const renames = new Map<string, string>();
    for (const merge of merges) for (const staleId of merge.staleIds) renames.set(staleId, merge.survivorId);
    // Data first: if the app stops halfway, the duplicates are still saved and the next launch redoes it.
    // What a dropped record proved goes with it instead of moving to the kept one (provenComputer.ts).
    await migrateMachineData(AsyncStorage, renames, new Set([MACHINES_STORAGE_KEY, PROVEN_SERVER_KEYS_STORAGE_KEY]));
    await AsyncStorage.setItem(MACHINES_STORAGE_KEY, JSON.stringify(deduped));
    await Promise.all([...renames.keys()].map((staleId) => deleteAllCredentials(staleId)));
    await forgetProvenServerKeys([...renames.keys()]);
    return deduped;
  } catch {
    // A failed heal leaves the records as they were; the next launch tries again.
    return machines;
  }
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

  hydrate: async () => {
    if (get().hydrated) return;
    const machines = await healDuplicateComputers(await loadPersistedMachines());
    // Read after the heal, which may have moved the selection to the record it kept.
    const selectedId = await AsyncStorage.getItem(SELECTED_MACHINE_STORAGE_KEY);
    const selectedMachineId = resolveSelectedMachineId(machines, selectedId);
    set({ hydrated: true, machines, selectedMachineId });
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
      ...pairingFieldsOf(input),
      ...tailscaleSshOf(input),
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
      host: normalized.transport === 'tailcat' ? tailcatSyntheticHost(existing.id) : normalized.host,
      username: normalized.username,
      port: normalized.port as number,
      savePassword: normalized.savePassword,
      transport: normalized.transport,
      ...pairingFieldsOf(input),
      ...tailscaleSshOf(input),
    };
    await persistPassword(machine.id, normalized.savePassword, normalized.password);
    /*
     * CDXC:RemotePairing 2026-11-11 WHY:
     * A record given an address with another key (paired again, its address edited) or another
     * transport may now be a different computer. What it proved before is void (provenComputer.ts),
     * and the address list it holds is the other computer's: it goes first, so no connect can
     * dial the computer before under the pairing after. Pairing saves the new list right after
     * this; an edit gets one at the next connect.
     */
    const addressBefore = await getTailcatToken(machine.id);
    const addressAfter =
      normalized.transport !== 'tailcat'
        ? null
        : normalized.tailcatToken.length > 0
          ? normalized.tailcatToken
          : addressBefore;
    const keyOf = (address: string | null): string | null => (address === null ? null : tailcatServerKey(address));
    const computerMayDiffer = keyOf(addressBefore) !== keyOf(addressAfter);
    if (computerMayDiffer) await setEasyConnectAddresses(machine.id, '');
    await persistTailcatToken(machine.id, normalized.transport, normalized.tailcatToken);
    if (computerMayDiffer) await forgetProvenServerKeys([machine.id]);
    const nextMachines = get().machines.map((entry) => (entry.id === id ? machine : entry));
    set({ machines: nextMachines });
    persistMachines(nextMachines);
    return { ok: true, machine };
  },

  addDemoComputer: () => {
    const current = get().machines;
    const existing = current.find((machine) => isDemoMachine(machine));
    if (existing !== undefined) {
      const machines = existing.disabled === true
        ? current.map((machine) => (machine.id === existing.id ? { ...machine, disabled: false } : machine))
        : current;
      set({ machines, selectedMachineId: existing.id });
      persistMachines(machines);
      persistSelectedMachineId(existing.id);
      return { ...existing, disabled: false };
    }
    const machine = demoMachineRecord();
    const machines = [...current, machine];
    set({ machines, selectedMachineId: machine.id });
    persistMachines(machines);
    persistSelectedMachineId(machine.id);
    return machine;
  },

  removeMachine: async (id) => {
    if (id === DEMO_MACHINE_ID || isDemoMachine(get().machines.find((machine) => machine.id === id))) {
      resetDemoWorld();
    }
    await deleteAllCredentials(id);
    await forgetProvenServerKeys([id]);
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
    const nextMachines = get().machines.map((machine) => (machine.id === id ? { ...machine, disabled } : machine));
    // Hiding the machine the drawer is showing hands the drawer to the next
    // enabled one, so the Sessions screen never renders a hidden machine.
    const selectedMachineId = resolveSelectedMachineId(nextMachines, get().selectedMachineId);
    set({ machines: nextMachines, selectedMachineId });
    persistMachines(nextMachines);
    persistSelectedMachineId(selectedMachineId);
  },

  /**
   * CDXC:RemoteMachines 2026-10-17 DECISION:
   * User: "allow rearranging the machines that are at the top with move left move right in the extra options (shown when i hold on them)". The saved `machines.v1` array order is the tab order (a machine paired later is appended, a removed one drops out), so a move swaps the machine with its neighbour among the visible machines and persists the array. Phone only; the desktop sidebar's machine order is untouched.
   */
  moveMachine: (id, direction) => {
    const current = get().machines;
    const visible = current.filter(isMachineEnabled);
    const from = visible.findIndex((machine) => machine.id === id);
    const neighbour = visible[direction === 'left' ? from - 1 : from + 1];
    if (from < 0 || neighbour === undefined) return;
    const nextMachines = [...current];
    const a = nextMachines.findIndex((machine) => machine.id === id);
    const b = nextMachines.findIndex((machine) => machine.id === neighbour.id);
    [nextMachines[a], nextMachines[b]] = [nextMachines[b]!, nextMachines[a]!];
    set({ machines: nextMachines });
    persistMachines(nextMachines);
  },

  selectMachine: (id) => {
    // A hidden machine is not a Sessions target, so it can never be selected.
    if (id !== null && !get().machines.some((machine) => machine.id === id && isMachineEnabled(machine))) {
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

  setMachineDeviceId: (id, deviceId) => {
    const nextMachines = get().machines.map((machine) => {
      if (machine.id !== id) return machine;
      const { deviceId: _old, ...rest } = machine;
      return deviceId === undefined ? rest : { ...rest, deviceId, pairedAt: new Date().toISOString() };
    });
    set({ machines: nextMachines });
    persistMachines(nextMachines);
  },
}));

/** Convenience selector for the currently selected machine record. */
export function selectedMachine(state: Pick<MachinesState, 'machines' | 'selectedMachineId'>): MachineRecord | null {
  if (state.selectedMachineId === null) return null;
  return state.machines.find((machine) => machine.id === state.selectedMachineId) ?? null;
}
