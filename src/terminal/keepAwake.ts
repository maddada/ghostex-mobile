/**
 * Keep-awake leases for attached sessions.
 *
 * The machine decides Auto Sleep ("Sleep inactive agents") in whichever Ghostex
 * client owns its sidebar, and that client can only see its own panes — a
 * session this phone is attached to looked exactly like an abandoned idle
 * terminal and got slept mid-conversation. `ghostex hold-sessions-awake`
 * registers a TTL-bounded lease on the daemon that makes it decline AUTOMATIC
 * sleeps for those sessions; explicit Sleep (from anywhere, including this app's
 * own Agent Actions menu) still works.
 *
 * Scope, deliberately: holds exist only while the app is FOREGROUNDED and only
 * for tabs with a live terminal. A backgrounded phone is not "someone looking at
 * this session", and Auto Sleep exists to reclaim those. Coming back to the
 * foreground reattaches dead tabs (src/app/lifecycle.ts) and `ghostex attach`
 * resumes a slept session, so the round trip stays seamless.
 *
 * One exec per machine per renewal carries every attached session on it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus } from 'react-native';

import { holdSessionsAwakeCommand } from '../commands/ghostexCli';
import { runGhostexCli } from '../components/sessions/cli';
import { FailureCopy } from '../copy';
import { useInventoryStore } from '../inventory/store';
import type { MachineConnectionTarget } from '../machines/credentials';
import { useMachinesStore } from '../machines/store';
import { useTerminalStore } from './sessions';

/**
 * Lease length asked of the daemon. Comfortably longer than the renewal cadence
 * so one failed heartbeat (a blip on the SSH link) does not expose the session
 * to the next Auto Sleep sweep.
 */
export const KEEP_AWAKE_TTL_MS = 180_000;
export const KEEP_AWAKE_RENEW_INTERVAL_MS = 60_000;

const HOLDER_STORAGE_KEY = 'terminal.keepAwakeHolder.v1';

/** projectId by session id, per machine. */
type HeldSessions = Map<string, Map<string, string>>;

let installed = false;
let renewTimer: ReturnType<typeof setInterval> | undefined;
let renewing = false;
/** A hold set that changed mid-renewal; the in-flight pass re-runs for it. */
let renewAgain = false;
let holderId: string | null = null;
/** What the daemon has been told, so tabs that go away can be released. */
const heldByMachineId: HeldSessions = new Map();
/** Machines whose Ghostex predates `hold-sessions-awake`; asking again is noise. */
const unsupportedMachineIds = new Set<string>();

/**
 * Stable per-install holder id. It scopes the lease to THIS device so two phones
 * on one session cannot release each other's hold.
 */
async function resolveHolderId(): Promise<string> {
  if (holderId !== null) return holderId;
  try {
    const stored = await AsyncStorage.getItem(HOLDER_STORAGE_KEY);
    if (stored !== null && stored.trim().length > 0) {
      holderId = stored.trim();
      return holderId;
    }
  } catch {
    // An unreadable store just means a fresh id for this app run.
  }
  const generated = `mobile-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  holderId = generated;
  void AsyncStorage.setItem(HOLDER_STORAGE_KEY, generated).catch(() => undefined);
  return generated;
}

function machineTarget(machineId: string): MachineConnectionTarget | null {
  const record = useMachinesStore.getState().machines.find((machine) => machine.id === machineId);
  if (record === undefined) return null;
  return { id: record.id, host: record.host, username: record.username, port: record.port };
}

/**
 * The project a tab's session belongs to. Attach tabs remember it from the row
 * they were opened from; a tab opened by id alone (notification deep link) falls
 * back to the machine's inventory, which is the same list the row came from.
 */
function projectIdForSession(machineId: string, sessionId: string, tabProjectId?: string): string | null {
  const remembered = tabProjectId?.trim() ?? '';
  if (remembered.length > 0) return remembered;
  const session = useInventoryStore
    .getState()
    .inventoriesByMachineId[machineId]?.summary?.sessions.find(
      (entry) => entry.sessionId === sessionId,
    );
  const discovered = session?.projectId.trim() ?? '';
  return discovered.length > 0 ? discovered : null;
}

/** Sessions that should be held right now: attach tabs with a live terminal. */
function desiredHolds(): HeldSessions {
  const desired: HeldSessions = new Map();
  for (const tab of useTerminalStore.getState().tabs) {
    if (tab.kind !== 'attach' || tab.ghostexSessionId === undefined) continue;
    if (tab.state !== 'open' && tab.state !== 'opening') continue;
    if (unsupportedMachineIds.has(tab.machineId)) continue;
    const projectId = projectIdForSession(tab.machineId, tab.ghostexSessionId, tab.ghostexProjectId);
    if (projectId === null) continue;
    const machine = desired.get(tab.machineId) ?? new Map<string, string>();
    machine.set(tab.ghostexSessionId, projectId);
    desired.set(tab.machineId, machine);
  }
  return desired;
}

function holdsKey(holds: HeldSessions): string {
  return [...holds.entries()]
    .map(([machineId, sessions]) => `${machineId}:${[...sessions.keys()].sort().join(',')}`)
    .sort()
    .join('|');
}

async function runHoldCommand(
  machineId: string,
  sessions: { projectId: string; sessionId: string }[],
  release: boolean,
): Promise<void> {
  if (sessions.length === 0) return;
  const target = machineTarget(machineId);
  if (target === null) return;
  try {
    await runGhostexCli(
      target,
      holdSessionsAwakeCommand(sessions, {
        holderId: await resolveHolderId(),
        ttlMs: KEEP_AWAKE_TTL_MS,
        ...(release ? { release: true } : {}),
      }),
    );
  } catch (error) {
    // runGhostexCli hands back already-summarized copy, so these are the two
    // summaries that mean "this machine can never answer": no CLI at all, and a
    // CLI/daemon that predates the verb. Retrying either every minute would burn
    // an SSH exec per machine forever for a guaranteed failure.
    const message = error instanceof Error ? error.message : String(error);
    if (message === FailureCopy.outdatedForFeature || message === FailureCopy.noCli) {
      unsupportedMachineIds.add(machineId);
      heldByMachineId.delete(machineId);
      return;
    }
    if (!release) {
      // A failed renewal must not leave stale bookkeeping behind: the lease will
      // lapse on the daemon, so the next pass should register it fresh.
      heldByMachineId.delete(machineId);
    }
  }
}

/** Renew every live hold and release the ones whose tabs are gone. */
export async function renewKeepAwakeHolds(): Promise<void> {
  if (renewing) {
    // A tab closed (or opened) while the previous pass was mid-flight. Dropping
    // this would leave the release waiting for the next tick.
    renewAgain = true;
    return;
  }
  renewing = true;
  try {
    const desired = desiredHolds();
    const machineIds = new Set([...desired.keys(), ...heldByMachineId.keys()]);
    for (const machineId of machineIds) {
      const wanted = desired.get(machineId) ?? new Map<string, string>();
      const held = heldByMachineId.get(machineId) ?? new Map<string, string>();
      const dropped = [...held.entries()]
        .filter(([sessionId]) => !wanted.has(sessionId))
        .map(([sessionId, projectId]) => ({ projectId, sessionId }));
      const renew = [...wanted.entries()].map(([sessionId, projectId]) => ({
        projectId,
        sessionId,
      }));
      if (wanted.size > 0) {
        heldByMachineId.set(machineId, wanted);
      } else {
        heldByMachineId.delete(machineId);
      }
      await runHoldCommand(machineId, renew, false);
      await runHoldCommand(machineId, dropped, true);
    }
  } finally {
    renewing = false;
  }
  if (renewAgain) {
    renewAgain = false;
    await renewKeepAwakeHolds();
  }
}

/** Drop every hold this device owns (backgrounding, or the last tab closing). */
async function releaseAllHolds(): Promise<void> {
  const snapshot = [...heldByMachineId.entries()];
  heldByMachineId.clear();
  for (const [machineId, sessions] of snapshot) {
    await runHoldCommand(
      machineId,
      [...sessions.entries()].map(([sessionId, projectId]) => ({ projectId, sessionId })),
      true,
    );
  }
}

/**
 * Backgrounded and inactive phones stop holding. `unknown` (which Android can
 * report before the first AppState change) counts as foreground: treating the
 * app's own cold start as "backgrounded" would leave the first attached session
 * unprotected until the user switched away and back.
 */
function isForeground(state: AppStateStatus): boolean {
  return state !== 'background' && state !== 'inactive';
}

function startRenewing(): void {
  if (renewTimer !== undefined) return;
  renewTimer = setInterval(() => void renewKeepAwakeHolds(), KEEP_AWAKE_RENEW_INTERVAL_MS);
  void renewKeepAwakeHolds();
}

function stopRenewing(): void {
  if (renewTimer !== undefined) {
    clearInterval(renewTimer);
    renewTimer = undefined;
  }
}

/** Install once at app startup; the subscriptions live for the app's life. */
export function initTerminalKeepAwake(): void {
  if (installed) return;
  installed = true;

  let lastDesired = '';
  useTerminalStore.subscribe(() => {
    const next = holdsKey(desiredHolds());
    if (next === lastDesired) return;
    lastDesired = next;
    // A tab opened or died: register the new hold (or release the old one) now
    // instead of leaving the session unprotected until the next tick.
    if (isForeground(AppState.currentState)) void renewKeepAwakeHolds();
  });

  let last: AppStateStatus = AppState.currentState;
  AppState.addEventListener('change', (next) => {
    const wasForeground = isForeground(last);
    last = next;
    if (isForeground(next) && !wasForeground) {
      startRenewing();
      return;
    }
    if (!isForeground(next) && wasForeground) {
      stopRenewing();
      void releaseAllHolds();
    }
  });

  if (isForeground(AppState.currentState)) startRenewing();
}
