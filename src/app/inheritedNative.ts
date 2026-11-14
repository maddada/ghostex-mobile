/**
 * What the native layer still holds when this JavaScript starts.
 *
 * CDXC:RemoteMachines 2026-11-14 WHY:
 * The app applies an over-the-air update by restarting its JavaScript (`Updates.reloadAsync`, src/updates/overTheAir.ts).
 * On the iPhone the native SSH connections and terminals outlive that restart (the native module's OnDestroy closes
 * neither), but tabs are not saved, so the new JavaScript started with none: it reused each connection without checking
 * it and never closed the old terminals, which kept holding the computer's session channels (MaxSessions 10). So at
 * start every terminal without a tab is closed, and each enabled computer's connection is checked once by the usual
 * recovery (a cold start has none and dials as before). Android's OnDestroy already closes everything, so there it
 * finds nothing. `listTerminals` and `closeTerminal` exist on every phone build since 11.2.1.
 * SEE-ALSO: src/app/autoReconnect.ts (`recoverConnections`), App.tsx (runs this once the stores have loaded).
 */

import { GhostexNative } from '../../modules/ghostex-native/src';
import { useTerminalStore } from '../terminal/sessions';
import { logAppEvent } from './appLog';
import { recoverConnections } from './autoReconnect';

let reconciled = false;

/** Closes native terminals no tab owns, then checks every enabled computer's connection once. Never throws. */
export async function reconcileInheritedNative(): Promise<void> {
  if (reconciled) return;
  reconciled = true;
  try {
    const keys = await GhostexNative.listTerminals();
    const owned = new Set(useTerminalStore.getState().tabs.map((tab) => tab.sessionKey));
    const orphans = keys.filter((key) => !owned.has(key));
    if (orphans.length > 0) {
      logAppEvent(`App: closing ${orphans.length} terminals left from before the restart`);
      await Promise.all(orphans.map((key) => GhostexNative.closeTerminal(key).catch(() => undefined)));
    }
  } catch (error) {
    logAppEvent(`App: could not list the terminals left from before the restart (${String(error).slice(0, 120)})`);
  }
  recoverConnections('app started');
}
