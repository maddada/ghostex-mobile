/**
 * Audible/haptic alerts.
 * - Terminal bell (BEL from either native engine) routed per the
 *   "Alerts and hardware keys" setting: vibrate (haptics), beep (native app
 *   sound), or ignore. Throttled so bell storms cannot queue endless feedback.
 * - Attention notification sound: detects remote sessions TRANSITIONING into
 *   attention/done across inventory refreshes (never re-alerts on unchanged
 *   states or on the first snapshot) and plays the native attention sound when
 *   settings.doneNotificationSound is enabled. Independent of the terminal bell.
 */

import * as Haptics from 'expo-haptics';

import { GhostexNative } from '../../modules/ghostex-native/src';
import { displayStatus } from '../contract/mobileSummary';
import { useInventoryStore } from '../inventory/store';
import { useSettingsStore } from '../settings/store';

const BELL_THROTTLE_MS = 250;

/** Statuses whose *entry* should alert the user. */
const ALERT_STATUSES = new Set(['attention', 'done']);

let installed = false;
let lastBellAt = 0;
/** `${machineId}:${sessionId}` → last seen display status. */
const lastStatusBySession = new Map<string, string>();
/** Machines whose sessions have been observed at least once (no first-snapshot alerts). */
const observedMachines = new Set<string>();

function handleBell(): void {
  const { settings, hydrated } = useSettingsStore.getState();
  if (!hydrated || settings.bellBehavior === 'ignore') return;
  const now = Date.now();
  if (now - lastBellAt < BELL_THROTTLE_MS) return;
  lastBellAt = now;
  if (settings.bellBehavior === 'vibrate') {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
    return;
  }
  void GhostexNative.playAlertSound('bell').catch(() => undefined);
}

function scanInventoryTransitions(): void {
  const inventories = useInventoryStore.getState().inventoriesByMachineId;
  let shouldAlert = false;

  for (const [machineId, inventory] of Object.entries(inventories)) {
    const summary = inventory.summary;
    if (summary === null) continue;
    const firstSnapshot = !observedMachines.has(machineId);
    const seenKeys = new Set<string>();

    for (const session of summary.sessions) {
      const key = `${machineId}:${session.sessionId}`;
      seenKeys.add(key);
      const status = displayStatus(session);
      const previous = lastStatusBySession.get(key);
      lastStatusBySession.set(key, status);
      if (firstSnapshot || previous === undefined) continue;
      if (previous !== status && ALERT_STATUSES.has(status) && !ALERT_STATUSES.has(previous)) {
        shouldAlert = true;
      }
    }

    // Drop sessions that disappeared so a later reappearance is a fresh observation.
    for (const key of lastStatusBySession.keys()) {
      if (key.startsWith(`${machineId}:`) && !seenKeys.has(key)) {
        lastStatusBySession.delete(key);
      }
    }
    observedMachines.add(machineId);
  }

  if (!shouldAlert) return;
  const { settings, hydrated } = useSettingsStore.getState();
  if (!hydrated || !settings.doneNotificationSound) return;
  // One sound per refresh pass even when several sessions transitioned together.
  void GhostexNative.playAlertSound('attention').catch(() => undefined);
}

/** Install once at app startup; subscriptions live for the app's lifetime. */
export function initAlerts(): void {
  if (installed) return;
  installed = true;
  GhostexNative.addListener('onTerminalBell', handleBell);
  useInventoryStore.subscribe(scanInventoryTransitions);
}
