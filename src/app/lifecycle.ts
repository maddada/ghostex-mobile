/**
 * App foreground/background lifecycle: when the app returns to the
 * foreground, re-establish machine connections and reattach any terminal
 * agent tabs whose native entries died while backgrounded, so the user should never
 * have to tap "Reconnect" after simply reopening the app.
 *
 * The same lifecycle runs the app's one mobile-summary poll (`src/inventory/summaryRefresh.ts`):
 * in the foreground with a machine selected, on every screen.
 *
 * Foreground/background is also what flips attach tabs between the zmx
 * visible and hidden client states; that policy lives in
 * `src/terminal/zmxDisplay.ts`, which watches AppState itself.
 */

import { hydrateAppLog, logAppEvent, setStoredLogScrubber } from './appLog';
import { privateTerms } from '../feedback/crashReports';
import { scrubPersonalData } from '../feedback/crashReportScrub';
import { hydrateProjectIcons } from '../inventory/projectIcons';
import { AppState, type AppStateStatus } from 'react-native';

import { Platform } from 'react-native';
import { GhostexNative } from '../../modules/ghostex-native/src';
import { INVENTORY_POLL_INTERVAL_MS, useInventoryStore } from '../inventory/store';
import { startSummaryRefresh } from '../inventory/summaryRefresh';
import { selectedMachine, useMachinesStore } from '../machines/store';
import { startConnectionHealth } from '../machines/connectionHealth';
import { recoverConnections } from './autoReconnect';
import { networkChangesHeard } from './networkChanges';

let installed = false;

export function handleAppBecameActive(): void {
  recoverConnections();
}

export function initAppLifecycle(): void {
  if (installed) return;
  installed = true;
  setStoredLogScrubber((text) => scrubPersonalData(text, privateTerms()));
  void hydrateProjectIcons();
  void hydrateAppLog().then(() => logAppEvent(`App: started (${Platform.OS} ${String(Platform.Version)})`));
  let last: AppStateStatus = AppState.currentState as AppStateStatus;
  AppState.addEventListener('change', (next) => {
    const cameFromBackground = last === 'background' || last === 'inactive';
    if (next !== last && (next === 'active' || next === 'background'))
      logAppEvent(`App: ${next === 'active' ? 'in front' : 'in the background'}`);
    last = next;
    if (next === 'active' && cameFromBackground) handleAppBecameActive();
  });
  if (networkChangesHeard(Platform.OS, GhostexNative)) {
    GhostexNative.addListener('onNetworkChanged', () => {
      logAppEvent('App: the network changed');
      recoverConnections();
    });
  }
  // Runs for the app's lifetime, like the listeners above. The handle type is whatever the platform's timer
  // returns (React Native's `setInterval` is overloaded, so it is named here rather than inferred).
  startSummaryRefresh<ReturnType<typeof setInterval>>({
    appState: {
      get: () => AppState.currentState ?? 'unknown',
      subscribe: (listener) => {
        const subscription = AppState.addEventListener('change', listener);
        return () => subscription.remove();
      },
    },
    machineSelected: {
      get: () => selectedMachine(useMachinesStore.getState()) !== null,
      subscribe: (listener) => useMachinesStore.subscribe(listener),
    },
    refreshAll: () => void useInventoryStore.getState().refreshAll(),
    setPolling: (polling) => useInventoryStore.getState().setPolling(polling),
    intervalMs: INVENTORY_POLL_INTERVAL_MS,
    timers: {
      setInterval: (run, ms) => setInterval(run, ms),
      clearInterval: (handle) => clearInterval(handle),
    },
  });
  startConnectionHealth();
}
