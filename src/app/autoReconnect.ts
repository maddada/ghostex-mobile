/**
 * SSH auto-reconnect (Settings › SSH connection).
 * - Watches native onConnectionState. When a machine's shared SSH connection
 *   drops for an enabled machine, reconnects in the foreground with capped backoff
 *   (in the background only Read aloud's Voice mode computer does, see `canRecover`).
 *   Manual disconnects and credential/host-key failures wait for explicit action.
 * - After a successful reconnect, re-attaches closed/failed zmx attach tabs
 *   (their sessionKeys are stable, so re-attaching cannot duplicate sessions).
 *   Plain shell tabs are left to the explicit Retry button: their remote
 *   processes died with the channel and silently respawning a fresh shell
 *   would masquerade as the old one.
 */

import { AppState } from 'react-native';

import { GhostexNative } from '../../modules/ghostex-native/src';
import type { FailureReasonCode } from '../inventory/client';
import { useInventoryStore } from '../inventory/store';
import { chatLinkKeptInBackground, onChatLinkCutOff } from '../chat/rust/machine-link';
import { hasEasyConnectRoute, useMachineRoutes } from '../machines/easyConnectRoute';
import { enabledMachines, useMachinesStore } from '../machines/store';
import { cancelConnectionAttempt, ensureConnected } from '../remote/connection';
import { isDemoMachineId } from '../demo/identity';
import { useSettingsStore } from '../settings/store';
import { restoreAttachTabs, useTerminalStore } from '../terminal/sessions';
import { commandsInFlight } from '../remote/channelBudget';
import {
  channelSnapshot,
  channelSnapshotAtEnd,
  clearChannelPressure,
  installChannelPressure,
  offerConnectionReset,
} from '../remote/channelPressure';
import { installStallWatch, resetStallWatch } from '../remote/stallWatch';
import { noteConnectionEnded, startChannelSnapshots } from '../remote/connectionTrace';
import { checkStalledConnection, reconnectMachine } from '../remote/connection';
import { logAppEvent } from './appLog';

const RECONNECT_DELAYS_MS = [2_000, 5_000, 15_000, 30_000];
let installed = false;
const manualDisconnects = new Set<string>();
const permanentFailures = new Set<string>();
const attemptsByMachineId = new Map<string, number>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const recovering = new Map<string, Promise<void>>();

function foreground(): boolean {
  return AppState.currentState !== 'background' && AppState.currentState !== 'inactive';
}

export function markManualDisconnect(machineId: string): void {
  cancelConnectionAttempt(machineId);
  manualDisconnects.add(machineId);
  resetStallWatch(machineId);
  cancelRetry(machineId);
  attemptsByMachineId.delete(machineId);
}

function cancelRetry(machineId: string): void {
  const timer = retryTimers.get(machineId);
  if (timer !== undefined) clearTimeout(timer);
  retryTimers.delete(machineId);
}

function machineTarget(machineId: string) {
  return enabledMachines(useMachinesStore.getState()).find((machine) => machine.id === machineId);
}

/**
 * In front every enabled computer recovers; in the background only the one Read aloud's Voice mode
 * reads a chat of (`keepChatLinkInBackground`), and only its SSH connection: tabs and the session
 * list wait for the foreground.
 */
function canRecover(machineId: string): boolean {
  if (isDemoMachineId(machineId)) return false;
  return (
    (foreground() || chatLinkKeptInBackground(machineId)) &&
    useSettingsStore.getState().settings.autoReconnect &&
    !manualDisconnects.has(machineId) &&
    !permanentFailures.has(machineId) &&
    machineTarget(machineId) !== undefined
  );
}

function scheduleReconnect(machineId: string): void {
  if (retryTimers.has(machineId) || !canRecover(machineId)) return;
  const attempt = attemptsByMachineId.get(machineId) ?? 0;
  attemptsByMachineId.set(machineId, attempt + 1);
  const delay = RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)];
  retryTimers.set(
    machineId,
    setTimeout(() => {
      retryTimers.delete(machineId);
      void recoverMachine(machineId, true, `retry ${attempt + 1}`);
    }, delay),
  );
}

function recoverMachine(machineId: string, verify = false, reason = 'retry'): Promise<void> {
  const existing = recovering.get(machineId);
  if (existing) return existing;
  const target = machineTarget(machineId);
  if (!target || !canRecover(machineId)) return Promise.resolve();
  logAppEvent(`Connection: ${machineId} recovering (${reason}${verify ? ', checking first' : ''})`);
  cancelRetry(machineId);
  // Global Actions are shown and run only from a summary read over the recovered connection; a list read already
  // under way is discarded, and the read that follows in the foreground brings them back.
  useInventoryStore.getState().dropGlobalQuickActions(machineId);
  const request = (async () => {
    try {
      await ensureConnected(target, { verify, reason });
      if (!canRecover(machineId)) return;
      if (!foreground()) {
        // Voice mode: the chat link reconnects on `connected`; the rest waits for the foreground.
        attemptsByMachineId.delete(machineId);
        return;
      }
      // A slow/offline second computer must not delay restoring this one's tabs.
      await restoreAttachTabs(machineId);
      await useInventoryStore.getState().refreshMachine(target);
      const failedTabs = useTerminalStore
        .getState()
        .tabs.some((tab) => tab.machineId === machineId && tab.kind === 'attach' && tab.state === 'failed');
      if (useInventoryStore.getState().inventoriesByMachineId[machineId]?.lastError || failedTabs) {
        scheduleReconnect(machineId);
      } else {
        attemptsByMachineId.delete(machineId);
      }
    } catch {
      scheduleReconnect(machineId);
    }
  })();
  recovering.set(machineId, request);
  const clear = () => {
    if (recovering.get(machineId) === request) recovering.delete(machineId);
  };
  void request.then(clear, clear);
  return request;
}

/**
 * When a computer's gxserver said it is stopping, how long each re-dial waits: its Easy Connect helper stops
 * with it and comes back with the new gxserver a few seconds later. Then the usual ladder takes over.
 */
const RESTART_REDIAL_DELAYS_MS = [2_500, 2_000, 2_500, 3_000, 5_000, 8_000];

/**
 * A computer's gxserver said it is stopping (`serverStopping` on its notification stream).
 *
 * CDXC:RemoteMachines 2026-11-10 WHY: gxserver stops its Easy Connect helpers when it stops, so every phone's
 * tunnel to it dies without closing, and the phone noticed only when its chat went quiet and a probe ran out,
 * about 15 s after the restart, then waited out the reconnect ladder. The computer says so first: an Easy
 * Connect phone drops the dead tunnel and dials again on a short ladder until the new helper answers. Over
 * Tailscale or SSH the connection outlives a gxserver restart, so nothing is done there, except for a
 * Tailscale computer that is on its Easy Connect route at the time.
 */
export function redialAfterServerStop(machineId: string): void {
  logAppEvent(`gxserver: ${machineId} says it is stopping`);
  const target = machineTarget(machineId);
  if (target === undefined || !canRecover(machineId)) return;
  // A Tailscale computer on its Easy Connect route rides the same helper (`easyConnectRoute.ts`).
  const onTunnel =
    target.transport === 'tailcat' ||
    (hasEasyConnectRoute(target) && useMachineRoutes.getState().active[machineId] === 'easyConnect');
  if (!onTunnel) return;
  cancelRetry(machineId);
  const redial = (attempt: number): void => {
    const delay = RESTART_REDIAL_DELAYS_MS[attempt];
    if (delay === undefined) {
      scheduleReconnect(machineId);
      return;
    }
    retryTimers.set(
      machineId,
      setTimeout(() => {
        retryTimers.delete(machineId);
        const current = machineTarget(machineId);
        if (current === undefined || !canRecover(machineId)) return;
        void (async () => {
          try {
            if (attempt === 0) await GhostexNative.stopTailcatForward(machineId).catch(() => undefined);
            await ensureConnected(current, { reset: true, reason: 'its gxserver said it is stopping' });
            attemptsByMachineId.delete(machineId);
            await recoverMachine(machineId);
          } catch {
            if (!retryTimers.has(machineId)) redial(attempt + 1);
          }
        })();
      }, delay),
    );
  };
  redial(0);
}

/** Validate existing sockets after resume or route changes, then resume bounded retries. */
export function recoverConnections(reason = 'back in front'): void {
  for (const machine of enabledMachines(useMachinesStore.getState())) {
    void recoverMachine(machine.id, true, reason);
  }
}

export function initAutoReconnect(): void {
  if (installed) return;
  installed = true;
  installChannelPressure({
    detachIdleTerminals: (machineId, keep) => useTerminalStore.getState().detachIdleTerminals(machineId, keep),
    openTerminals: (machineId) => {
      const open = useTerminalStore
        .getState()
        .tabs.filter((tab) => tab.machineId === machineId && (tab.state === 'open' || tab.state === 'opening'));
      return {
        agents: open.filter((tab) => tab.kind === 'attach').length,
        shells: open.filter((tab) => tab.kind !== 'attach').length,
      };
    },
    commandsInFlight,
    reset: async (machineId) => {
      const target = machineTarget(machineId);
      if (target === undefined) return;
      await reconnectMachine(target, 'the computer kept refusing channels');
      await restoreAttachTabs(machineId);
    },
  });
  installStallWatch({
    check: checkStalledConnection,
    replace: async (machineId, reason) => {
      const target = machineTarget(machineId);
      if (target === undefined || !canRecover(machineId)) return;
      await reconnectMachine(target, reason);
      if (canRecover(machineId)) await restoreAttachTabs(machineId);
    },
    mayRecover: canRecover,
    plainShells: (machineId) =>
      useTerminalStore
        .getState()
        .tabs.filter(
          (tab) =>
            tab.machineId === machineId && tab.kind !== 'attach' && (tab.state === 'open' || tab.state === 'opening'),
        ).length,
    offerReset: offerConnectionReset,
  });
  startChannelSnapshots(
    () =>
      enabledMachines(useMachinesStore.getState())
        .map((machine) => machine.id)
        .filter((machineId) => !isDemoMachineId(machineId)),
    channelSnapshot,
  );
  GhostexNative.addListener('onConnectionState', (event) => {
    const ended =
      event.state === 'disconnected' || event.state === 'failed'
        ? `, ${noteConnectionEnded(event.machineId)}. ${channelSnapshotAtEnd(event.machineId)}`
        : '';
    logAppEvent(
      `Connection: ${event.machineId} ${event.state}${'errorCode' in event && event.errorCode ? ` (${event.errorCode})` : ''}${ended}`,
    );
    // Any change of the connection (up, ending, dialling again) ends what the stall watch held for the one before.
    resetStallWatch(event.machineId);
    if (event.state === 'connected') clearChannelPressure(event.machineId);
    if (event.state === 'connecting') {
      permanentFailures.delete(event.machineId);
      return;
    }
    if (event.state === 'connected') {
      cancelRetry(event.machineId);
      attemptsByMachineId.delete(event.machineId);
      manualDisconnects.delete(event.machineId);
      permanentFailures.delete(event.machineId);
      if (canRecover(event.machineId)) void recoverMachine(event.machineId, false, 'connected');
      return;
    }
    if (event.state !== 'disconnected' && event.state !== 'failed') return;
    if (event.errorCode === 'E_AUTH_FAILED' || event.errorCode === 'E_HOST_KEY_MISMATCH') {
      permanentFailures.add(event.machineId);
      cancelRetry(event.machineId);
      return;
    }
    scheduleReconnect(event.machineId);
  });
  AppState.addEventListener('change', () => {
    if (foreground()) return;
    for (const machineId of retryTimers.keys()) if (!chatLinkKeptInBackground(machineId)) cancelRetry(machineId);
  });
  /**
   * CDXC:RemoteMachines 2026-10-16 WHY:
   * A connection that dies without a socket error (iOS suspended the app, a NAT or tunnel
   * dropped it silently) still answers isConnected, so the 5 s inventory poll only times out
   * against it and no connection-state event ever starts a reconnect. A poll that starts
   * failing for a connection reason runs the same recovery as returning to the foreground:
   * probe, replace the dead connection, retry on the ladder until it works.
   */
  useInventoryStore.subscribe((state, previous) => {
    for (const [machineId, inventory] of Object.entries(state.inventoriesByMachineId)) {
      const code = inventory.lastErrorCode;
      if (code === null || code === previous.inventoriesByMachineId[machineId]?.lastErrorCode) continue;
      if (!CONNECTION_FAILURES.has(code)) continue;
      if (canRecover(machineId)) void recoverMachine(machineId, true, `sessions list failed: ${code}`);
    }
  });
  // An open chat that went silent is the earliest sign of a stalled tunnel (CDXC:RemoteMachines 2026-11-07 in
  // chat/rust/machine-link.ts): check and replace the connection now, as the Sessions poll's failure would later.
  onChatLinkCutOff((machineId) => {
    if (canRecover(machineId)) void recoverMachine(machineId, true, 'chat went silent');
  });
}

/** Inventory failures that mean the SSH connection itself may be dead. */
const CONNECTION_FAILURES: ReadonlySet<FailureReasonCode> = new Set(['timeout', 'noRoute', 'sshRefused', 'unknown']);
