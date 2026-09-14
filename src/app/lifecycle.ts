/**
 * App foreground/background lifecycle: when the app returns to the
 * foreground, re-establish machine connections and reattach any terminal
 * agent tabs whose native entries died while backgrounded, so the user should never
 * have to tap "Reconnect" after simply reopening the app.
 *
 * Foreground/background is also what flips attach tabs between the zmx
 * visible and hidden client states; that policy lives in
 * `src/terminal/zmxDisplay.ts`, which watches AppState itself.
 */

import { AppState, type AppStateStatus } from 'react-native';

import { Platform } from 'react-native';
import { GhostexNative } from '../../modules/ghostex-native/src';
import { recoverConnections } from './autoReconnect';

let installed = false;

export function handleAppBecameActive(): void {
  recoverConnections();
}

export function initAppLifecycle(): void {
  if (installed) return;
  installed = true;
  let last: AppStateStatus = AppState.currentState;
  AppState.addEventListener('change', (next) => {
    const cameFromBackground = last === 'background' || last === 'inactive';
    last = next;
    if (next === 'active' && cameFromBackground) handleAppBecameActive();
  });
  if (Platform.OS === 'android') {
    GhostexNative.addListener('onNetworkChanged', () => recoverConnections());
  }
}
