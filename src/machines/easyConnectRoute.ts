/**
 * A Tailscale or SSH computer's second route: Easy Connect, paired over the phone's own SSH login
 * (`sshPairing.ts`), so one saved computer reaches its computer either way (`routeChoice.ts` says
 * which first). What it signs in with lives in the secure store under the computer's own id: its
 * own SSH key (`ecsshkey`, apart from the person's key) and the computer's Easy Connect addresses
 * (`easyconnectaddresses`, as for an Easy Connect computer).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { GhostexNative, type SshConfig } from '../../modules/ghostex-native/src';
import { logAppEvent } from '../app/appLog';
import {
  getEasyConnectSshKey,
  setEasyConnectAddresses,
  setEasyConnectPublicKey,
  setEasyConnectSshKey,
  type MachineConnectionTarget,
} from './credentials';
import { TAILSCALE_HEAD_START_SEC, type MachineRoute } from './routeChoice';
import { tailcatSyntheticHost, useMachinesStore } from './store';

export type { MachineRoute } from './routeChoice';

type RoutesState = {
  /** The route each connected computer with both routes is on now. */
  active: Record<string, MachineRoute>;
};

export const useMachineRoutes = create<RoutesState>(() => ({ active: {} }));

export function setActiveRoute(machineId: string, route: MachineRoute | null): void {
  if ((useMachineRoutes.getState().active[machineId] ?? null) === route) return;
  useMachineRoutes.setState((state) => {
    const { [machineId]: _was, ...rest } = state.active;
    return { active: route === null ? rest : { ...rest, [machineId]: route } };
  });
}

/*
CDXC:RemotePairing 2026-11-13 DECISION:
User (Sebastian): the phone never says Easy Connect is on or set up for a computer unless Easy Connect
is actually on there; a key the phone holds is not "on". What counts is the computer's own switch:
`enabled` in its `/api/easyConnectAddresses` answer (an older computer has no such field, and there
only a list of addresses proves "on", since its helper runs only while the switch is on; an empty
list there says nothing, the helper may be restarting). The answer is kept per computer across
launches, tied to the Easy Connect pairing it was given under (`easyConnectPairedAt`), and unknown
never reads as on: until the computer has said it is on, a Tailscale or SSH computer is never dialled
through Easy Connect (routeChoice.ts).
*/
/** What each computer said (`on`), with the Easy Connect pairing it was said under (`pairing`). */
type KnownOn = { on: boolean; pairing: string };
type EasyConnectOnState = { on: Record<string, KnownOn> };

export const useEasyConnectOn = create<EasyConnectOnState>(() => ({ on: {} }));

const KNOWN_KEY = (machineId: string) => `easyConnect.enabled.${machineId}`;

/** The Easy Connect pairing the computer's answer belongs to: the route's pairing time, if any. */
function routePairing(machineId: string): string {
  const record = useMachinesStore.getState().machines.find((entry) => entry.id === machineId);
  return record?.easyConnectPairedAt ?? '';
}

/**
 * `known` when it was said under `easyConnectPairedAt` (the entry's pairing now); undefined
 * otherwise, so what another pairing (an edited address, say) said never shows for this one.
 */
export function easyConnectOnFor(known: KnownOn | undefined, easyConnectPairedAt: string | undefined): boolean | undefined {
  return known !== undefined && known.pairing === (easyConnectPairedAt ?? '') ? known.on : undefined;
}

/**
 * What a computer's `/api/easyConnectAddresses` answer says about its switch: its `enabled` field,
 * or, from an older computer, `true` when it named addresses and nothing otherwise.
 */
export function easyConnectOnFromAnswer(result: unknown, addressCount: number): boolean | undefined {
  const enabled = (result as { enabled?: unknown } | null)?.enabled;
  if (typeof enabled === 'boolean') return enabled;
  return addressCount > 0 ? true : undefined;
}

/** Whether the computer said Easy Connect is on there, for the current pairing; undefined when unknown. */
export async function knownEasyConnectOn(machineId: string): Promise<boolean | undefined> {
  const pairing = routePairing(machineId);
  const inMemory = useEasyConnectOn.getState().on[machineId];
  if (inMemory !== undefined && inMemory.pairing === pairing) return inMemory.on;
  try {
    const raw = await AsyncStorage.getItem(KNOWN_KEY(machineId));
    const saved: unknown = raw === null ? null : JSON.parse(raw);
    const known = saved as { on?: unknown; pairing?: unknown } | null;
    if (known === null || typeof known.on !== 'boolean' || known.pairing !== pairing) return undefined;
    setKnown(machineId, { on: known.on, pairing });
    return known.on;
  } catch {
    return undefined;
  }
}

function setKnown(machineId: string, known: KnownOn | undefined): void {
  const was = useEasyConnectOn.getState().on[machineId];
  if (was?.on === known?.on && was?.pairing === known?.pairing) return;
  useEasyConnectOn.setState((state) => {
    const { [machineId]: _was, ...rest } = state.on;
    return { on: known === undefined ? rest : { ...rest, [machineId]: known } };
  });
}

/** Keeps what the computer's own answer said about its Easy Connect switch, for this pairing. */
export function noteEasyConnectOn(machineId: string, on: boolean): void {
  const pairing = routePairing(machineId);
  setKnown(machineId, { on, pairing });
  void AsyncStorage.setItem(KNOWN_KEY(machineId), JSON.stringify({ on, pairing })).catch(
    () => undefined,
  );
  // Off there: the saved addresses go, so no later launch dials them (CDXC:RemotePairing 2026-11-13
  // in routeChoice.ts). The list is asked for again after a connect and comes back once it is on.
  if (!on) {
    const record = useMachinesStore.getState().machines.find((entry) => entry.id === machineId);
    if (record?.easyConnectPairedAt !== undefined && record.transport !== 'tailcat') {
      void setEasyConnectAddresses(machineId, '').catch(() => undefined);
    }
  }
}

/** Forgets what a computer said (its Easy Connect route went, or it was paired again). */
function forgetKnown(machineId: string): void {
  setKnown(machineId, undefined);
  void AsyncStorage.removeItem(KNOWN_KEY(machineId)).catch(() => undefined);
}

/** Whether this computer is a Tailscale or SSH one that also has Easy Connect. */
export function hasEasyConnectRoute(machine: Pick<MachineConnectionTarget, 'id' | 'transport'>): boolean {
  if (machine.transport === 'tailcat' || machine.transport === 'demo') return false;
  const record = useMachinesStore.getState().machines.find((entry) => entry.id === machine.id);
  return record?.easyConnectPairedAt !== undefined;
}

/**
 * `config` with Tailscale's short head start (`TAILSCALE_HEAD_START_SEC`) when this app build's
 * native connect takes a per-call timeout; unchanged on a build without it, which keeps its own.
 */
export function withTailscaleHeadStart(config: SshConfig): SshConfig {
  try {
    if (GhostexNative.supportsDialTimeout?.() !== true) return config;
  } catch {
    return config;
  }
  return { ...config, dialTimeoutSec: TAILSCALE_HEAD_START_SEC };
}

/** Whether Tailscale's VPN is on here; null when this app build can't tell. */
export async function tailscaleOnPhone(): Promise<boolean | null> {
  try {
    return await GhostexNative.isTailscaleConnected();
  } catch {
    return null;
  }
}

/**
 * The connection settings for the Easy Connect route: the computer's own SSH port behind the
 * tunnel, its synthetic host (so its host key is pinned apart from the Tailscale address's), and
 * the route's own key in place of the person's password or key. Null when no key is saved.
 */
export async function easyConnectConfig(machine: MachineConnectionTarget, config: SshConfig): Promise<SshConfig | null> {
  const privateKey = await getEasyConnectSshKey(machine.id);
  if (privateKey === null || privateKey.length === 0) return null;
  const { password: _password, passphrase: _passphrase, authMethod: _authMethod, ...rest } = config;
  return { ...rest, host: tailcatSyntheticHost(machine.id), privateKey, authMethod: 'credentials' };
}

/**
 * Saves the route once the computer approved it: its key, and the addresses its answer named. A
 * computer whose Easy Connect is off names none; the route is kept all the same (the pairing is
 * done, and asking again would pair again), and its addresses are fetched after a later connect
 * (`refreshEasyConnectAddressesSoon`), once Easy Connect is on there.
 */
export async function saveEasyConnectRoute(
  machineId: string,
  key: { privateKey: string; publicKey: string },
  saveAddresses: () => Promise<boolean>,
): Promise<void> {
  await Promise.all([setEasyConnectSshKey(machineId, key.privateKey), setEasyConnectPublicKey(machineId, key.publicKey)]);
  const named = await saveAddresses();
  useMachinesStore.getState().setEasyConnectRoute(machineId, new Date().toISOString());
  // The computer approves this only while its switch is on (CDXC:RemotePairing 2026-11-13 in
  // server/src/tailcat/status.rs), so the new pairing starts as on.
  noteEasyConnectOn(machineId, true);
  logAppEvent(
    named
      ? `Easy Connect: ${machineId} also reaches its computer through Easy Connect now`
      : `Easy Connect: ${machineId} paired for Easy Connect; the computer named no address yet (Easy Connect off there)`,
  );
}

/** Drops the route (the computer removed this phone, or the person did). */
export async function forgetEasyConnectRoute(machineId: string): Promise<void> {
  useMachinesStore.getState().setEasyConnectRoute(machineId, null);
  forgetKnown(machineId);
  setActiveRoute(machineId, null);
  await Promise.all([
    setEasyConnectSshKey(machineId, ''),
    setEasyConnectPublicKey(machineId, ''),
    setEasyConnectAddresses(machineId, ''),
  ]);
  await GhostexNative.stopTailcatForward(machineId).catch(() => undefined);
}
