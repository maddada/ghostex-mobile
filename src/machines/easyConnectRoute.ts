/**
 * A Tailscale or SSH computer's second route: Easy Connect, paired over the phone's own SSH login
 * (`sshPairing.ts`), so one saved computer reaches its computer either way (`routeChoice.ts` says
 * which first). What it signs in with lives in the secure store under the computer's own id: its
 * own SSH key (`ecsshkey`, apart from the person's key) and the computer's Easy Connect addresses
 * (`easyconnectaddresses`, as for an Easy Connect computer).
 */

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
  logAppEvent(
    named
      ? `Easy Connect: ${machineId} also reaches its computer through Easy Connect now`
      : `Easy Connect: ${machineId} paired for Easy Connect; the computer named no address yet (Easy Connect off there)`,
  );
}

/** Drops the route (the computer removed this phone, or the person did). */
export async function forgetEasyConnectRoute(machineId: string): Promise<void> {
  useMachinesStore.getState().setEasyConnectRoute(machineId, null);
  setActiveRoute(machineId, null);
  await Promise.all([
    setEasyConnectSshKey(machineId, ''),
    setEasyConnectPublicKey(machineId, ''),
    setEasyConnectAddresses(machineId, ''),
  ]);
  await GhostexNative.stopTailcatForward(machineId).catch(() => undefined);
}
