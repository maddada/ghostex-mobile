/**
 * Android persistent-notification feed (port of the Termux fork's
 * TermuxService notification): while at least one machine is configured, a
 * silent ongoing foreground-service notification shows the remote session
 * inventory, stated and ordered as the bell's list (Needs you, Done, Failed,
 * then working, then the rest: persistentNotificationRows.ts), and keeps SSH +
 * warm terminals alive in the background. A row's tap opens its session as the
 * bell's row does, marking its rows read (`source=notification`, deepLinks.ts).
 */

import { Platform } from 'react-native';

import { GhostexNative } from '../../modules/ghostex-native/src';
import type { NotificationSessionRow } from '../../modules/ghostex-native/src/GhostexNative.types';
import { useInventoryStore } from '../inventory/store';
import { useMachinesStore } from '../machines/store';
import { currentAttentionInbox } from '../notifications/attentionInbox';
import { useAttentionFeedStore } from '../notifications/feedStore';
import { useSettingsStore } from '../settings/store';
import { notificationRows, type NotificationSource } from './persistentNotificationRows';

let installed = false;
let serviceEnabled = false;
let lastRowsJson = '';

function collectRows(): NotificationSessionRow[] {
  const inventories = useInventoryStore.getState().inventoriesByMachineId;
  const sources: NotificationSource[] = [];
  for (const [machineId, inventory] of Object.entries(inventories)) {
    if (inventory.summary !== null) sources.push({ machineId, summary: inventory.summary });
  }
  // The bell's inbox states and orders the rows, so the two clear together (persistentNotificationRows.ts).
  return notificationRows(sources, currentAttentionInbox());
}

function sync(): void {
  const hasMachines = useMachinesStore.getState().machines.length > 0;
  if (hasMachines !== serviceEnabled) {
    serviceEnabled = hasMachines;
    void GhostexNative.setPersistentNotificationEnabled(hasMachines).catch(() => {});
    if (!hasMachines) {
      lastRowsJson = '';
      return;
    }
  }
  if (!serviceEnabled) return;
  const rows = collectRows();
  const json = JSON.stringify(rows);
  if (json === lastRowsJson) return;
  lastRowsJson = json;
  void GhostexNative.updatePersistentNotification(rows).catch(() => {});
}

/** Install once at app startup (no-op on iOS). */
export function initPersistentNotification(): void {
  if (installed || Platform.OS !== 'android') return;
  installed = true;
  void GhostexNative.requestNotificationPermission().catch(() => {});
  useInventoryStore.subscribe(() => sync());
  useMachinesStore.subscribe(() => sync());
  // The bell's inbox also reads the feeds, the closed lists and the sessions removed from the list.
  useAttentionFeedStore.subscribe(() => sync());
  useSettingsStore.subscribe(() => sync());
  sync();
}
