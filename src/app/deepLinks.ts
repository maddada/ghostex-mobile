/**
 * ghostex:// deep links. The Android persistent notification's session rows
 * fire `ghostex://session?machineId=…&sessionId=…`; handling one attaches the
 * session (reusing the warm tab when it exists) and navigates to the
 * Terminal screen — including from a cold start, where handling waits for
 * store hydration and navigation readiness.
 */

import { createNavigationContainerRef } from '@react-navigation/native';
import { Linking } from 'react-native';

import { useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { useTerminalStore } from '../terminal/sessions';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

let installed = false;
let pendingNavigation: (() => void) | null = null;

/** Flush a navigation deferred until NavigationContainer became ready. */
export function flushPendingDeepLink(): void {
  const run = pendingNavigation;
  pendingNavigation = null;
  run?.();
}

function navigateWhenReady(run: () => void): void {
  if (navigationRef.isReady()) run();
  else pendingNavigation = run;
}

function queryParam(url: string, name: string): string | null {
  const match = new RegExp(`[?&]${name}=([^&#]*)`).exec(url);
  if (match === null) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function handleUrl(url: string | null): void {
  if (url === null || !url.startsWith('ghostex://session')) return;
  const machineId = queryParam(url, 'machineId') ?? '';
  const sessionId = queryParam(url, 'sessionId') ?? '';
  if (machineId.length === 0 || sessionId.length === 0) return;

  const attach = (): void => {
    const machinesState = useMachinesStore.getState();
    if (!machinesState.hydrated) {
      // Cold start: stores hydrate within moments of launch.
      setTimeout(attach, 250);
      return;
    }
    const machine = machinesState.machines.find((entry) => entry.id === machineId);
    if (machine === undefined) return;
    void useTerminalStore
      .getState()
      .attachSession(
        { id: machine.id, host: machine.host, username: machine.username, port: machine.port },
        { sessionId },
      )
      .then((sessionKey) => {
        navigateWhenReady(() => {
          navigationRef.navigate('Terminal', { sessionKey, machineId: machine.id });
        });
      })
      .catch(() => {
        // Connection failures surface on the Sessions screen as usual.
      });
  };
  attach();
}

/** Install once at app startup; handles both cold-start and warm URLs. */
export function initDeepLinks(): void {
  if (installed) return;
  installed = true;
  void Linking.getInitialURL().then(handleUrl);
  Linking.addEventListener('url', (event) => handleUrl(event.url));
}
