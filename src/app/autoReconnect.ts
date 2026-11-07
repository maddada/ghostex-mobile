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
import { chatLinkKeptInBackground } from '../chat/rust/machine-link';
import { enabledMachines, useMachinesStore } from '../machines/store';
import { cancelConnectionAttempt, ensureConnected } from '../remote/connection';
import { isDemoMachineId } from '../demo/identity';
import { useSettingsStore } from '../settings/store';
import { restoreAttachTabs, useTerminalStore } from '../terminal/sessions';

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
      void recoverMachine(machineId, true);
    }, delay),
  );
}

function recoverMachine(machineId: string, verify = false): Promise<void> {
  const existing = recovering.get(machineId);
  if (existing) return existing;
  const target = machineTarget(machineId);
  if (!target || !canRecover(machineId)) return Promise.resolve();
  cancelRetry(machineId);
  // Global Actions are shown and run only from a summary read over the recovered connection; a list read already
  // under way is discarded, and the read that follows in the foreground brings them back.
  useInventoryStore.getState().dropGlobalQuickActions(machineId);
  const request = (async () => {
    try {
      await ensureConnected(target, { verify });
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

/** Validate existing sockets after resume or route changes, then resume bounded retries. */
export function recoverConnections(): void {
  for (const machine of enabledMachines(useMachinesStore.getState())) {
    void recoverMachine(machine.id, true);
  }
}

export function initAutoReconnect(): void {
  if (installed) return;
  installed = true;
  GhostexNative.addListener('onConnectionState', (event) => {
    if (event.state === 'connecting') {
      permanentFailures.delete(event.machineId);
      return;
    }
    if (event.state === 'connected') {
      cancelRetry(event.machineId);
      attemptsByMachineId.delete(event.machineId);
      manualDisconnects.delete(event.machineId);
      permanentFailures.delete(event.machineId);
      if (canRecover(event.machineId)) void recoverMachine(event.machineId);
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
      if (canRecover(machineId)) void recoverMachine(machineId, true);
    }
  });
}

/** Inventory failures that mean the SSH connection itself may be dead. */
const CONNECTION_FAILURES: ReadonlySet<FailureReasonCode> = new Set(['timeout', 'noRoute', 'sshRefused', 'unknown']);
