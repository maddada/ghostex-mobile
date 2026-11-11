/**
 * Registers this phone's own Easy Connect key with each computer that can take one, after that
 * computer's handshake (CDXC:RemotePairing 2026-11-10 in easyConnectLinkKeyState.ts). Installed from
 * the app's root, apart from the connection code, which only reads the result.
 */

import { GhostexNative } from '../../modules/ghostex-native/src';
import { logAppEvent } from '../app/appLog';
import { chatMachineLink, onChatLinkHandshake } from '../chat/rust/machine-link';
import type { MachineConnectionTarget } from './credentials';
import { loadRegistered, nativeHasMachineKeys, saveRegistered } from './easyConnectLinkKeyState';
import { pairingEpoch, samePairing } from './pairingEpoch';
import { enabledMachines, useMachinesStore } from './store';

/** gxserver's capability for `/api/registerEasyConnectClientKey`. */
export const EASY_CONNECT_CLIENT_KEYS_CAPABILITY = 'easyConnectClientKeys';
const REGISTER_ENDPOINT = 'registerEasyConnectClientKey';
const REGISTER_TIMEOUT_MS = 15_000;

const registering = new Set<string>();

async function registerLinkKey(
  machine: MachineConnectionTarget,
  capabilities: readonly string[],
  redial: (machineId: string) => void,
): Promise<void> {
  if (machine.transport !== 'tailcat' || !nativeHasMachineKeys()) return;
  if (!capabilities.includes(EASY_CONNECT_CLIENT_KEYS_CAPABILITY) || registering.has(machine.id)) return;
  registering.add(machine.id);
  // The computer that takes the key is the one the entry is paired with now; one it was paired
  // with before must not mark the key as accepted here (machines/pairingEpoch.ts).
  const epoch = pairingEpoch(machine.id);
  try {
    const publicKey = await GhostexNative.tailcatMachineClientKey!(machine.id);
    if ((await loadRegistered())[machine.id] === publicKey) return;
    const answer = await chatMachineLink(machine).rpc(REGISTER_ENDPOINT, { clientKey: publicKey }, REGISTER_TIMEOUT_MS);
    if (answer.error !== null && answer.error !== undefined) {
      logAppEvent(`Easy Connect: ${machine.id} kept its shared key (${answer.error.code ?? 'error'})`);
      return;
    }
    if (!samePairing(machine.id, epoch)) {
      logAppEvent(`Easy Connect: ${machine.id} was paired again while its own key was registered; not kept`);
      return;
    }
    await saveRegistered((current) => ({ ...current, [machine.id]: publicKey }));
    await GhostexNative.useTailcatMachineClientKey!(machine.id, true);
    // The computer restarts its Easy Connect helper for the new allow-list, which ends this tunnel:
    // dial again on the new key straight away instead of waiting to notice.
    redial(machine.id);
  } catch (error) {
    logAppEvent(
      `Easy Connect: ${machine.id} kept its shared key (${error instanceof Error ? error.message : String(error)})`,
    );
  } finally {
    registering.delete(machine.id);
  }
}

let installed = false;

/** Registers each Easy Connect computer's own key after its handshake; `redial` reconnects it on the new key. */
export function installEasyConnectLinkKeys(redial: (machineId: string) => void): void {
  if (installed) return;
  installed = true;
  onChatLinkHandshake((machine, capabilities) => {
    void registerLinkKey(machine, capabilities, redial);
  });
  if (!nativeHasMachineKeys()) return;
  // The handshake runs when a chat or Voice first needs the computer; one that is only listed would never
  // register. A connected Easy Connect computer without its own key yet is asked here instead.
  GhostexNative.addListener('onConnectionState', (event) => {
    if (event.state !== 'connected') return;
    const machine = enabledMachines(useMachinesStore.getState()).find((entry) => entry.id === event.machineId);
    if (machine === undefined || machine.transport !== 'tailcat') return;
    void loadRegistered().then((accepted) => {
      if (accepted[machine.id] === undefined) void chatMachineLink(machine).route();
    });
  });
}
