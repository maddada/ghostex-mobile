/**
 * Each connected computer's link health: its round trip, measured with one small request every 15 s while the
 * Sessions poll runs, the times its link dropped, and the Easy Connect path it is on. `connectionHealthModel.ts`
 * holds the slow rule; the Sessions screen's computer icons and the Connections sheet read this store.
 *
 * CDXC:RemoteMachines 2026-11-12 WHY:
 * The round trip is timed on what the phone already asks of every computer, never a new kind of request: gxserver's
 * open `GET /api/health` over the chat link's port forward when the computer has one (the chat's own quiet check), else
 * an `echo` over SSH (the reconnect's probe, so it adds a process start to the time). Nothing is measured while a
 * heavy transfer holds the link (`linkActivity.ts`): a probe queued behind an upload measures the upload.
 */

import { create } from 'zustand';

import { withCommandChannel } from '../remote/channelBudget';
import { GhostexNative } from '../../modules/ghostex-native/src';
import { logAppEvent } from '../app/appLog';
import { chatMachineLink, onChatLinkCutOff } from '../chat/rust/machine-link';
import { isCloudBoxMachineId } from '../cloudBoxes/types';
import { isDemoMachine } from '../demo/identity';
import { useInventoryStore, type MachineInventory } from '../inventory/store';
import { linkTransferring } from '../remote/linkActivity';
import {
  emptyHealth,
  evaluateHealth,
  SLOW_ROUND_TRIP_MS,
  withDrop,
  withSample,
  type MachineHealth,
} from './connectionHealthModel';
import { readEasyConnectPath, type EasyConnectPath } from './easyConnectPathModel';
import { useMachineRoutes } from './easyConnectRoute';
import { machineDisplayLabel, useMachinesStore, type MachineRecord } from './store';

const CHECK_EVERY_MS = 15_000;
/** A check with no answer by then counts as this slow. */
const CHECK_TIMEOUT_MS = 5_000;

type HealthState = {
  byId: Record<string, MachineHealth>;
  /** The Easy Connect path each computer on Easy Connect is on; absent when unknown. */
  paths: Record<string, EasyConnectPath>;
};

export const useConnectionHealth = create<HealthState>(() => ({ byId: {}, paths: {} }));

function update(machineId: string, change: (health: MachineHealth) => MachineHealth, machine?: MachineRecord): void {
  const before = useConnectionHealth.getState().byId[machineId] ?? emptyHealth();
  const after = evaluateHealth(change(before), Date.now());
  if (after === before) return;
  if ((before.slowSince === null) !== (after.slowSince === null)) {
    const name = machine === undefined ? machineId : machineDisplayLabel(machine);
    logAppEvent(
      after.slowSince === null
        ? `Connection: ${name} is fine again`
        : `Connection: ${name} is slow (${after.slowReason === 'drops' ? 'dropped twice in 5 min' : `round trip over ${SLOW_ROUND_TRIP_MS} ms for 30 s`})`,
    );
  }
  useConnectionHealth.setState((state) => ({ byId: { ...state.byId, [machineId]: after } }));
}

function healthy(inventory: MachineInventory | undefined): boolean {
  return inventory !== undefined && inventory.summary !== null && inventory.lastError === null;
}

function checked(machine: MachineRecord): boolean {
  return machine.disabled !== true && !isDemoMachine(machine) && !isCloudBoxMachineId(machine.id);
}

async function timed(run: (signal: AbortSignal) => Promise<unknown>): Promise<number> {
  const startedAt = Date.now();
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      controller.abort();
      resolve();
    }, CHECK_TIMEOUT_MS);
  });
  try {
    await Promise.race([run(controller.signal), timedOut]);
  } finally {
    clearTimeout(timer);
  }
  return Math.min(Date.now() - startedAt, CHECK_TIMEOUT_MS);
}

async function roundTrip(machine: MachineRecord): Promise<number | null> {
  const link = chatMachineLink(machine);
  try {
    if (link.current() === 'socket') {
      const gxserver = await link.gxserverLink();
      if (gxserver !== null) {
        return await timed(async (signal) => {
          const response = await fetch(`http://127.0.0.1:${gxserver.localPort}/api/health`, { signal });
          await response.text();
        });
      }
    }
    // Timed from when the echo gets its slot; the slot is held until the echo itself settles. A check that never got
    // one (`E_BUSY`) is no sample, like any other failed check below.
    return await new Promise<number>((resolve, reject) => {
      withCommandChannel(machine.id, CHECK_TIMEOUT_MS, () => {
        const echo = GhostexNative.exec(machine.id, 'echo __GHOSTEX_CONNECTED__', CHECK_TIMEOUT_MS);
        timed(() => echo).then(resolve, reject);
        return echo;
      }).catch(reject);
    });
  } catch {
    // A check that failed outright is the list poll's to report, not a slow link.
    return null;
  }
}

async function readPath(machine: MachineRecord): Promise<void> {
  const onEasyConnect =
    machine.transport === 'tailcat' || useMachineRoutes.getState().active[machine.id] === 'easyConnect';
  const read = GhostexNative.tailcatPath;
  let path: EasyConnectPath | null = null;
  if (onEasyConnect && typeof read === 'function') {
    path = await read
      .call(GhostexNative, machine.id)
      .then(readEasyConnectPath)
      .catch(() => null);
  }
  const known = useConnectionHealth.getState().paths[machine.id];
  if (path === null && known === undefined) return;
  if (path !== null && known !== undefined && JSON.stringify(path) === JSON.stringify(known)) return;
  useConnectionHealth.setState((state) => {
    const { [machine.id]: _was, ...rest } = state.paths;
    return { paths: path === null ? rest : { ...rest, [machine.id]: path } };
  });
}

let running = false;

async function checkAll(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const inventories = useInventoryStore.getState().inventoriesByMachineId;
    const machines = useMachinesStore.getState().machines.filter((machine) => checked(machine));
    await Promise.all(
      machines.map(async (machine) => {
        if (!healthy(inventories[machine.id])) return;
        await readPath(machine);
        if (linkTransferring(machine.id)) return;
        const ms = await roundTrip(machine);
        if (ms === null || !healthy(useInventoryStore.getState().inventoriesByMachineId[machine.id])) return;
        if (ms > SLOW_ROUND_TRIP_MS) logAppEvent(`Connection: ${machineDisplayLabel(machine)} round trip ${ms} ms`);
        update(machine.id, (health) => withSample(health, { at: Date.now(), ms }), machine);
      }),
    );
  } finally {
    running = false;
  }
}

function noteDrop(machineId: string): void {
  const machine = useMachinesStore.getState().machines.find((entry) => entry.id === machineId);
  if (machine === undefined || !checked(machine)) return;
  update(machineId, (health) => withDrop(health, Date.now()), machine);
}

let installed = false;

/** Starts the checks for the app's lifetime: every 15 s while the Sessions poll runs. */
export function startConnectionHealth(): void {
  if (installed) return;
  installed = true;
  let timer: ReturnType<typeof setInterval> | null = null;
  const evaluate = (polling: boolean): void => {
    if (polling && timer === null) {
      timer = setInterval(() => void checkAll(), CHECK_EVERY_MS);
      void checkAll();
    } else if (!polling && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
  // A computer whose list read failed after it was connected dropped its link; so did a chat link that went silent.
  let wasHealthy: Record<string, boolean> = {};
  useInventoryStore.subscribe((state, previous) => {
    if (state.polling !== previous.polling) evaluate(state.polling);
    if (state.inventoriesByMachineId === previous.inventoriesByMachineId) return;
    const next: Record<string, boolean> = {};
    for (const [machineId, inventory] of Object.entries(state.inventoriesByMachineId)) {
      next[machineId] = healthy(inventory);
      if (wasHealthy[machineId] === true && inventory.lastError !== null) noteDrop(machineId);
    }
    wasHealthy = next;
  });
  onChatLinkCutOff(noteDrop);
  evaluate(useInventoryStore.getState().polling);
}
