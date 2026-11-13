/**
 * Asking once whether a Tailscale or SSH computer falls back to Easy Connect, and changing the answer later
 * (CDXC:RemotePairing 2026-11-13 in easyConnectRoute.ts). The phone asks the first time it connects to such a
 * computer that has no answer saved yet, once the computer said Easy Connect is on there (a yes could not be
 * set up otherwise), and only for a computer that can add this phone over its SSH login or already has an
 * Easy Connect route. The dialog is src/components/security/EasyConnectFallbackAsk.tsx; the switch is on the
 * computer's page and in the Connections sheet (EasyConnectFallbackSwitch.tsx).
 */

import { create } from 'zustand';

import { onChatLinkHandshake } from '../chat/rust/machine-link';
import { isDemoMachine } from '../demo/identity';
import type { MachineConnectionTarget } from './credentials';
import { checkEasyConnectOn } from './easyConnectDial';
import {
  easyConnectOnFor,
  fallbackChoice,
  hasEasyConnectRoute,
  knownEasyConnectOn,
  setFallbackChoice,
  useEasyConnectOn,
} from './easyConnectRoute';
import { addEasyConnect, PAIR_OVER_SSH_EASY_CONNECT_CAPABILITY, signsInOverSsh } from './sshPairing';
import { useMachinesStore } from './store';

type AskState = {
  /** Computers waiting for the person's answer, in the order they connected. */
  asking: string[];
};

export const useEasyConnectFallbackAsk = create<AskState>(() => ({ asking: [] }));

/** Computers answered or put away this launch: not asked again until the next launch. */
const settled = new Set<string>();
/** Computers being checked now, so two handshakes close together ask once. */
const checking = new Set<string>();

/**
 * Whether this computer can fall back to Easy Connect from this phone: one it signs in to over SSH (not an
 * Easy Connect, sample or Cloud Box computer) that offers adding this phone (`offered`) or already has a route.
 */
export function canFallBack(machine: Pick<MachineConnectionTarget, 'id' | 'transport'>, offered: boolean): boolean {
  if (isDemoMachine(machine) || !signsInOverSsh(machine)) return false;
  return offered || hasEasyConnectRoute(machine);
}

function stopAsking(machineId: string): void {
  settled.add(machineId);
  useEasyConnectFallbackAsk.setState((state) => ({ asking: state.asking.filter((id) => id !== machineId) }));
}

async function askIfUndecided(machine: MachineConnectionTarget): Promise<void> {
  const id = machine.id;
  if (settled.has(id) || checking.has(id) || useEasyConnectFallbackAsk.getState().asking.includes(id)) return;
  checking.add(id);
  try {
    if ((await fallbackChoice(id)) !== undefined) return;
    // Asked only where a yes can work now: Easy Connect is on there.
    await checkEasyConnectOn(machine);
    if ((await knownEasyConnectOn(id)) !== true) return;
    // Answered on its page meanwhile, or removed from this phone.
    if ((await fallbackChoice(id)) !== undefined || settled.has(id)) return;
    if (!useMachinesStore.getState().machines.some((record) => record.id === id)) return;
    useEasyConnectFallbackAsk.setState((state) =>
      state.asking.includes(id) ? state : { asking: [...state.asking, id] },
    );
  } finally {
    checking.delete(id);
  }
}

/**
 * Saves the person's answer, and with a yes asks the computer to add this phone to its Easy Connect when it
 * has no route yet and Easy Connect isn't known to be off there (it would refuse; the switch shows why and
 * offers Ask again once it is on). The tap is the opt-in: no Face ID before it (CDXC:RemotePairing 2026-11-13
 * in sshPairing.ts).
 */
export function changeFallback(machine: MachineConnectionTarget, on: boolean): void {
  setFallbackChoice(machine.id, on ? 'yes' : 'no');
  if (!on || hasEasyConnectRoute(machine)) return;
  const record = useMachinesStore.getState().machines.find((entry) => entry.id === machine.id);
  const known = easyConnectOnFor(useEasyConnectOn.getState().on[machine.id], record?.easyConnectPairedAt);
  if (known === false) return;
  void addEasyConnect(machine);
}

/** The dialog's Fall back / Don't fall back. */
export function answerFallbackAsk(machineId: string, yes: boolean): void {
  stopAsking(machineId);
  const machine = useMachinesStore.getState().machines.find((record) => record.id === machineId);
  if (machine !== undefined) changeFallback(machine, yes);
}

/** The dialog put away without an answer (the back gesture, a tap outside): asked again next launch. */
export function dismissFallbackAsk(machineId: string): void {
  stopAsking(machineId);
}

// Registered when the dialog's module loads (EasyConnectFallbackAsk.tsx, mounted at the app's root).
onChatLinkHandshake((machine, capabilities) => {
  if (!canFallBack(machine, capabilities.includes(PAIR_OVER_SSH_EASY_CONNECT_CAPABILITY))) return;
  void askIfUndecided(machine);
});
