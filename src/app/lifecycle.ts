/**
 * App foreground/background lifecycle: when the app returns to the
 * foreground, re-establish machine connections and reattach any terminal
 * tabs whose native entries died while backgrounded — the user should never
 * have to tap "Reconnect" after simply reopening the app.
 *
 * Foreground/background is also what flips attach tabs between the zmx
 * visible and hidden client states; that policy lives in
 * `src/terminal/zmxDisplay.ts`, which watches AppState itself.
 */

import { AppState, type AppStateStatus } from 'react-native';

import { useInventoryStore } from '../inventory/store';
import { useTerminalStore } from '../terminal/sessions';

let installed = false;

/** Reattach every closed/failed tab, selected tab first. */
function reattachDeadTabs(): void {
  const terminal = useTerminalStore.getState();
  const dead = terminal.tabs.filter((tab) => tab.state === 'closed' || tab.state === 'failed');
  dead.sort((a, b) => {
    if (a.sessionKey === terminal.selectedSessionKey) return -1;
    if (b.sessionKey === terminal.selectedSessionKey) return 1;
    return 0;
  });
  for (const tab of dead) {
    void terminal.reopenTab(tab.sessionKey);
  }
}

export function handleAppBecameActive(): void {
  // refreshAll runs ensureConnected per machine, which reconnects dead SSH
  // clients (the native isConnected now reports transport death correctly).
  void useInventoryStore
    .getState()
    .refreshAll()
    .then(() => reattachDeadTabs())
    .catch(() => reattachDeadTabs());
}

/** Install once at app startup; the subscription lives for the app's life. */
export function initAppLifecycle(): void {
  if (installed) return;
  installed = true;
  let last: AppStateStatus = AppState.currentState;
  AppState.addEventListener('change', (next) => {
    const cameFromBackground = last === 'background' || last === 'inactive';
    last = next;
    if (next === 'active' && cameFromBackground) {
      handleAppBecameActive();
    }
  });
}
