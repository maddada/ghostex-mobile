/**
 * ghostex:// deep links. The Android persistent notification's session rows and the agent
 * notifications fire `ghostex://session?machineId=…&sessionId=…`; handling one opens the session the
 * way a tap in the Sessions list does (reusing the warm tab when it exists) and navigates to the
 * Terminal screen, including from a cold start, where handling waits for the stores that decide or
 * overwrite the session's view (`deepLinkStoresReady`) and for navigation readiness. The rules live in
 * `deepLinkHandler.ts`; this file wires them to the stores.
 *
 * Pairing links: the computer's QR is `https://ghostex.dev/pair#ghostex-ec1:…` (an Android App Link
 * and iOS Universal Link this app claims in app.json), so scanning it with the phone's own camera
 * opens the app here; the Scan code screen then pairs exactly as if its scanner had read the QR.
 */

import { createNavigationContainerRef } from '@react-navigation/native';
import { Linking } from 'react-native';

import { useInventoryStore } from '../inventory/store';
import { useMachinesStore } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import { usePaneStore } from '../panes/store';
import { sessionHasChatView, sessionOpensInChatView } from '../screens/terminal-screen/session-lookups';
import { useSettingsStore } from '../settings/store';
import { attachSessionKey, useTerminalStore } from '../terminal/sessions';
import { revealSessionWorkspace } from '../workspaces/store';
import { handleDeepLink, type DeepLinkDeps } from './deepLinkHandler';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

let installed = false;
let pendingNavigation: (() => void) | null = null;

/**
 * The person's navigation so far: every change of the navigation's state and every change of the Terminal screen's
 * selected tab, except the app's own: the first screen at launch, and going to (or selecting) the session the latest
 * tapped notification opens (`tapOpens`). A tapped notification's opening counts it at the tap and stops once it
 * changed: the person left for another screen or session (`feedStore.ts`).
 */
let personNavigationCount = 0;
let firstScreenShown = false;
/** The session (its tab key) the latest tapped notification opens; null before any tap. */
let tapTarget: string | null = null;

navigationRef.addListener('state', () => {
  if (!firstScreenShown) {
    firstScreenShown = true;
    return;
  }
  const route = navigationRef.getCurrentRoute();
  const params = route?.name === 'Terminal' ? route.params : undefined;
  const sessionKey = params !== undefined && 'sessionKey' in params ? params.sessionKey : undefined;
  if (tapTarget !== null && sessionKey === tapTarget) return;
  personNavigationCount += 1;
});
useTerminalStore.subscribe((state, previous) => {
  if (state.selectedSessionKey === previous.selectedSessionKey) return;
  if (tapTarget !== null && state.selectedSessionKey === tapTarget) return;
  personNavigationCount += 1;
});

/** How often the person navigated so far (see above); a caller that kept a count can tell whether it moved since. */
export function personNavigations(): number {
  return personNavigationCount;
}

/** A tapped notification opens this session: going there, or selecting its tab, is the app's doing. */
export function tapOpens(machineId: string, sessionId: string): void {
  tapTarget = attachSessionKey(machineId, sessionId);
}

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

/**
 * The saved computers, Settings (the Default Agent View) and the terminal's saved per-session views are
 * loaded. Until then a link's view could be chosen from defaults or be overwritten by the loading: the
 * terminal store's hydration replaces every session's view choice.
 */
export function deepLinkStoresReady(): boolean {
  return (
    useMachinesStore.getState().hydrated && useSettingsStore.getState().hydrated && useTerminalStore.getState().hydrated
  );
}

const appDeps: DeepLinkDeps = {
  storesReady: deepLinkStoresReady,
  machine: (machineId) => {
    const machine = useMachinesStore.getState().machines.find((entry) => entry.id === machineId);
    if (machine === undefined) return undefined;
    return {
      id: machine.id,
      host: machine.host,
      username: machine.username,
      port: machine.port,
      transport: machine.transport === 'demo' ? undefined : machine.transport,
    };
  },
  session: (machineId, sessionId) => {
    const summary = useInventoryStore.getState().inventoriesByMachineId[machineId]?.summary;
    const session = summary?.sessions.find((entry) => entry.sessionId === sessionId);
    if (session === undefined) return undefined;
    return {
      projectId: session.projectId,
      title: session.displayTitle,
      hasChatView: sessionHasChatView(session),
      opensInChatView: sessionOpensInChatView(attachSessionKey(machineId, sessionId), session),
    };
  },
  loadSession: async (machineId, sessionId) => {
    const machine = useMachinesStore.getState().machines.find((entry) => entry.id === machineId);
    // A read that starts now: one already under way may have its answer from before the tap.
    if (machine !== undefined) await useInventoryStore.getState().refreshMachineFresh(machine);
    return appDeps.session(machineId, sessionId);
  },
  revealWorkspace: revealSessionWorkspace,
  openChatTab: (machine, session) => useTerminalStore.getState().openChatTab(machine, session),
  // A question's chat view stands full screen, also where panes are open.
  showChatView: (sessionKey) => {
    useTerminalStore.getState().setSessionViewMode(sessionKey, 'chat');
    usePaneStore.getState().setQuestionHold(sessionKey);
  },
  attachSession: (machine, session, current) => useTerminalStore.getState().attachSession(machine, session, { current }),
  navigate: (route, current) =>
    navigateWhenReady(() => {
      // A tapped notification's opening that was superseded while the screens got ready navigates nothing.
      if (current?.() === false) return;
      if (route.name === 'Terminal') navigationRef.navigate('Terminal', route.params);
      else if (route.name === 'Voice') navigationRef.navigate('Voice');
      else
        navigationRef.navigate({
          name: 'ScanCode',
          params: { incomingCode: { payload: route.url, at: Date.now() } },
          merge: true,
        });
    }),
  later: (retry) => setTimeout(retry, 250),
};

/**
 * Opens a ghostex:// link from inside the app: an agent notification's tap (with its opening's check `current`, see
 * `handleDeepLink`) or an attention-list row.
 */
export function openDeepLink(url: string, current?: () => boolean): void {
  handleDeepLink(url, appDeps, current);
}

/** Install once at app startup; handles both cold-start and warm URLs. */
export function initDeepLinks(): void {
  if (installed) return;
  installed = true;
  void Linking.getInitialURL().then((url) => handleDeepLink(url ?? null, appDeps));
  Linking.addEventListener('url', (event) => handleDeepLink(event.url, appDeps));
}
