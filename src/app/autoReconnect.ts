/**
 * SSH auto-reconnect (Settings › SSH connection).
 * - Watches native onConnectionState. When a machine's shared SSH connection
 *   drops for an enabled machine, reconnects in the foreground with capped backoff.
 *   Manual disconnects and credential/host-key failures wait for explicit action.
 * - After a successful reconnect, re-attaches closed/failed zmx attach tabs
 *   (their sessionKeys are stable, so re-attaching cannot duplicate sessions).
 *   Plain shell tabs are left to the explicit Retry button: their remote
 *   processes died with the channel and silently respawning a fresh shell
 *   would masquerade as the old one.
 */

import { AppState } from 'react-native';

import { GhostexNative } from '../../modules/ghostex-native/src';
import { useInventoryStore } from '../inventory/store';
import { enabledMachines, useMachinesStore } from '../machines/store';
import { cancelConnectionAttempt, ensureConnected } from '../remote/connection';
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

function canRecover(machineId: string): boolean {
  return (
    foreground() &&
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
      void recoverMachine(machineId);
    }, delay)
  );
}

function recoverMachine(machineId: string, verify = false): Promise<void> {
  const existing = recovering.get(machineId);
  if (existing) return existing;
  const target = machineTarget(machineId);
  if (!target || !canRecover(machineId)) return Promise.resolve();
  cancelRetry(machineId);
  const request = (async () => {
    try {
      await ensureConnected(target, { verify });
      if (!canRecover(machineId)) return;
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
    if (!foreground()) for (const machineId of retryTimers.keys()) cancelRetry(machineId);
  });
}
