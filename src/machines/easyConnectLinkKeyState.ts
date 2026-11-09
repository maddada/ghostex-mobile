/**
 * Per-computer Easy Connect keys: a phone with several Easy Connect computers dials each one with a
 * key of its own instead of its one shared key.
 *
 * Once the app build can (`tailcatMachineClientKey` in the native module) and the computer can
 * (`easyConnectClientKeys` in `ghostex server endpoint`), the phone registers its key for that
 * computer over its own paired link (`/api/registerEasyConnectClientKey`) and from then on dials it
 * with that key. Anything older keeps the shared key: an 11.2.1 app build lacks the native calls,
 * so this JavaScript, which reaches it over the air, does nothing there.
 *
 * CDXC:RemotePairing 2026-11-10 WHY: a relay delivers a key's traffic only to that key's newest
 * connection. Since 10.49.0 every computer meets its phones on Ghostex's relay, so a phone with two
 * Easy Connect computers starved the older tunnel for 15 to 30 s each time the other connected
 * (measured 2026-11-09 with two tailcat servers on relay-eu.ghostex.dev: separate keys never stalled).
 * SEE-ALSO: server/src/remote_access/paired_devices.rs (`register_device_link_key`),
 * apps/mobile/tailcat-bridge/bridge.go (`UseMachineClientKeyFile`), src/remote/connection.ts.
 */

import { GhostexNative } from '../../modules/ghostex-native/src';

const STORAGE_KEY = 'easyConnect.linkKeys.v1';

/** Machine id → the public key the computer accepted for it. */
export type Registered = Record<string, string>;

let registered: Promise<Registered> | null = null;

/** Loaded on first use, so importing this module needs no native storage (it rides along with connection.ts). */
function storage(): typeof import('@react-native-async-storage/async-storage').default {
  return (
    require('@react-native-async-storage/async-storage') as typeof import('@react-native-async-storage/async-storage')
  ).default;
}

export function loadRegistered(): Promise<Registered> {
  registered ??= storage()
    .getItem(STORAGE_KEY)
    .then((text) => {
      const parsed = text === null ? null : (JSON.parse(text) as unknown);
      return parsed !== null && typeof parsed === 'object' ? (parsed as Registered) : {};
    })
    .catch(() => ({}));
  return registered;
}

export async function saveRegistered(update: (current: Registered) => Registered): Promise<void> {
  const next = update({ ...(await loadRegistered()) });
  registered = Promise.resolve(next);
  await storage()
    .setItem(STORAGE_KEY, JSON.stringify(next))
    .catch(() => undefined);
}

/** Whether this app build can dial a computer with a key of its own. */
export function nativeHasMachineKeys(): boolean {
  return (
    typeof GhostexNative.tailcatMachineClientKey === 'function' &&
    typeof GhostexNative.useTailcatMachineClientKey === 'function'
  );
}

/** Before dialing `machineId`: its own key when the computer accepted it, the shared key otherwise. */
export async function applyEasyConnectLinkKey(machineId: string): Promise<void> {
  if (!nativeHasMachineKeys()) return;
  const accepted = (await loadRegistered())[machineId] !== undefined;
  await GhostexNative.useTailcatMachineClientKey?.(machineId, accepted).catch(() => undefined);
}

/** The computer was paired again: its rows may be new, so the key is registered again on the next connect. */
export async function forgetEasyConnectLinkKey(machineId: string): Promise<void> {
  if ((await loadRegistered())[machineId] === undefined) return;
  await saveRegistered((current) => {
    delete current[machineId];
    return current;
  });
  await GhostexNative.useTailcatMachineClientKey?.(machineId, false).catch(() => undefined);
}
