/**
 * SSH auto-reconnect (Settings › SSH connection).
 * - Watches native onConnectionState. When a machine's shared SSH connection
 *   drops while terminal tabs exist for it (and the drop was not a deliberate
 *   manual disconnect), reconnects with a short backoff.
 * - After a successful reconnect, re-attaches closed/failed zmx attach tabs
 *   (their sessionKeys are stable, so re-attaching cannot duplicate sessions).
 *   Plain shell tabs are left to the explicit Retry button: their remote
 *   processes died with the channel and silently respawning a fresh shell
 *   would masquerade as the old one.
 */

import { GhostexNative } from '../../modules/ghostex-native/src';
import { ensureConnected } from '../inventory/client';
import type { MachineConnectionTarget } from '../machines/credentials';
import { useMachinesStore } from '../machines/store';
import { useSettingsStore } from '../settings/store';
import { useTerminalStore } from '../terminal/sessions';

const RECONNECT_DELAYS_MS = [2_000, 5_000, 15_000];

let installed = false;
/** Machines whose next disconnected/failed event is user-initiated. */
const manualDisconnects = new Set<string>();
const attemptsByMachineId = new Map<string, number>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();

/**
 * Call immediately before a deliberate GhostexNative.disconnect so the
 * resulting state event does not trigger a reconnect.
 */
export function markManualDisconnect(machineId: string): void {
  manualDisconnects.add(machineId);
  cancelRetry(machineId);
  attemptsByMachineId.delete(machineId);
}

function cancelRetry(machineId: string): void {
  const timer = retryTimers.get(machineId);
  if (timer !== undefined) {
    clearTimeout(timer);
    retryTimers.delete(machineId);
  }
}

function machineTarget(machineId: string): MachineConnectionTarget | null {
  const record = useMachinesStore.getState().machines.find((machine) => machine.id === machineId);
  if (record === undefined) return null;
  return {
    id: record.id,
    host: record.host,
    username: record.username,
    port: record.port,
    transport: record.transport,
  };
}

function hasTabsFor(machineId: string): boolean {
  return useTerminalStore.getState().tabs.some((tab) => tab.machineId === machineId);
}

function scheduleReconnect(machineId: string): void {
  if (retryTimers.has(machineId)) return;
  const attempt = attemptsByMachineId.get(machineId) ?? 0;
  if (attempt >= RECONNECT_DELAYS_MS.length) return;
  attemptsByMachineId.set(machineId, attempt + 1);
  const timer = setTimeout(() => {
    retryTimers.delete(machineId);
    const target = machineTarget(machineId);
    if (target === null || !hasTabsFor(machineId)) return;
    void ensureConnected(target).catch(() => {
      // The resulting "failed" state event schedules the next attempt.
    });
  }, RECONNECT_DELAYS_MS[attempt]);
  retryTimers.set(machineId, timer);
}

function reattachDroppedTabs(machineId: string): void {
  const store = useTerminalStore.getState();
  for (const tab of store.tabs) {
    if (tab.machineId !== machineId || tab.kind !== 'attach') continue;
    if (tab.state !== 'closed' && tab.state !== 'failed') continue;
    void store.reopenTab(tab.sessionKey).catch(() => undefined);
  }
}

/** Install once at app startup. */
export function initAutoReconnect(): void {
  if (installed) return;
  installed = true;

  GhostexNative.addListener('onConnectionState', (event) => {
    if (event.state === 'connected') {
      cancelRetry(event.machineId);
      attemptsByMachineId.delete(event.machineId);
      manualDisconnects.delete(event.machineId);
      reattachDroppedTabs(event.machineId);
      return;
    }
    if (event.state !== 'disconnected' && event.state !== 'failed') return;
    if (manualDisconnects.delete(event.machineId)) return;
    if (!useSettingsStore.getState().settings.autoReconnect) return;
    if (!hasTabsFor(event.machineId)) return;
    scheduleReconnect(event.machineId);
  });
}
