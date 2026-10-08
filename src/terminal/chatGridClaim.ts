/**
 * The chat grid claim for the chat on screen.
 *
 * CDXC:Zmx 2026-10-08 DECISION:
 * User: Chat View opens without a terminal ("Chat-only, no terminal"). The agent should still run at
 * the 200-column resting width while its chat is read, which only an attached terminal typing
 * `ZMX_CHAT` used to claim. The phone reports the one chat it shows as a lease
 * (`/api/holdSessionChatGrid`, renewed like keep-awake), and gxserver holds the claim on the
 * session's daemon for as long as a lease lives. A visible terminal on any device still owns the
 * grid. Only the focused Terminal screen's chat in the foreground counts; leaving it releases.
 * SEE-ALSO: server/src/session_chat_grid_claim.rs, apps/desktop/src/app/gx_store/terminal_lifecycle/chat_grid_claims.rs.
 */

import { AppState, type AppStateStatus } from 'react-native';

import { chatMachineLink } from '../chat/rust/machine-link';
import { holdSessionChatGridCommand } from '../commands/ghostexCli';
import { runGhostexCli } from '../components/sessions/cli';
import { FailureCopy } from '../copy';
import { useInventoryStore } from '../inventory/store';
import type { MachineConnectionTarget } from '../machines/credentials';
import { useMachinesStore } from '../machines/store';
import { useTerminalStore } from './sessions';

/** Lease asked of gxserver; renewed well inside it, so a dropped phone releases within it. */
const CHAT_GRID_TTL_MS = 45_000;
const CHAT_GRID_RENEW_MS = 15_000;
const REQUEST_TIMEOUT_MS = 10_000;

type Held = { machineId: string; projectId: string; sessionId: string };

let installed = false;
let chatSessionKey: string | null = null;
let appState: AppStateStatus = AppState.currentState;
let held: Held | null = null;
let renewTimer: ReturnType<typeof setInterval> | undefined;
let holderId: string | null = null;
/** Computers whose Ghostex predates the lease; asking again is noise. */
const unsupportedMachineIds = new Set<string>();

function isForeground(state: AppStateStatus): boolean {
  return state === 'active' || state === 'unknown';
}

function resolveHolderId(): string {
  holderId ??= `mobile-chat-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return holderId;
}

function machineTarget(machineId: string): MachineConnectionTarget | null {
  const record = useMachinesStore.getState().machines.find((machine) => machine.id === machineId);
  if (record === undefined) return null;
  return { id: record.id, host: record.host, username: record.username, port: record.port, transport: record.transport };
}

function desired(): Held | null {
  if (chatSessionKey === null || !isForeground(appState)) return null;
  const tab = useTerminalStore.getState().tabs.find((entry) => entry.sessionKey === chatSessionKey);
  if (tab === undefined || tab.kind !== 'attach' || tab.ghostexSessionId === undefined) return null;
  if (unsupportedMachineIds.has(tab.machineId)) return null;
  const sessionId = tab.ghostexSessionId;
  const projectId =
    tab.ghostexProjectId ??
    useInventoryStore
      .getState()
      .inventoriesByMachineId[tab.machineId]?.summary?.sessions.find((entry) => entry.sessionId === sessionId)
      ?.projectId;
  if (projectId === undefined || projectId.length === 0) return null;
  return { machineId: tab.machineId, projectId, sessionId };
}

async function send(hold: Held, release: boolean): Promise<void> {
  const target = machineTarget(hold.machineId);
  if (target === null) return;
  const sessions = [{ projectId: hold.projectId, sessionId: hold.sessionId }];
  const params = { holderId: resolveHolderId(), sessions, ttlMs: CHAT_GRID_TTL_MS, ...(release ? { release: true } : {}) };
  const link = chatMachineLink(target);
  if ((await link.route()) === 'socket') {
    const answer = await link.rpc('holdSessionChatGrid', params, REQUEST_TIMEOUT_MS);
    // An older gxserver has no such endpoint; it answers with a request failure, not a lease.
    if (answer.error !== null && answer.error.code !== 'unreachable') unsupportedMachineIds.add(hold.machineId);
    return;
  }
  try {
    await runGhostexCli(target, holdSessionChatGridCommand(sessions, { holderId: params.holderId, ttlMs: CHAT_GRID_TTL_MS, release }), {
      timeoutMs: REQUEST_TIMEOUT_MS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === FailureCopy.outdatedForFeature || message === FailureCopy.noCli) {
      unsupportedMachineIds.add(hold.machineId);
    }
  }
}

function sameHold(a: Held | null, b: Held | null): boolean {
  return a?.machineId === b?.machineId && a?.projectId === b?.projectId && a?.sessionId === b?.sessionId;
}

/** Brings gxserver in line with the chat on screen; `renew` re-sends an unchanged hold. */
function sync(renew: boolean): void {
  const next = desired();
  const previous = held;
  if (sameHold(previous, next) && !renew) return;
  held = next;
  if (previous !== null && !sameHold(previous, next)) void send(previous, true);
  if (next !== null) void send(next, false);
  if (next !== null && renewTimer === undefined) {
    renewTimer = setInterval(() => sync(true), CHAT_GRID_RENEW_MS);
  } else if (next === null && renewTimer !== undefined) {
    clearInterval(renewTimer);
    renewTimer = undefined;
  }
}

/** Called by the Terminal screen with the session key whose chat it shows (or null). */
export function setChatGridSessionKey(sessionKey: string | null): void {
  if (chatSessionKey === sessionKey) return;
  chatSessionKey = sessionKey;
  sync(false);
}

/** Install once at app startup; the subscriptions live for the app's life. */
export function initChatGridClaim(): void {
  if (installed) return;
  installed = true;
  AppState.addEventListener('change', (next) => {
    const changed = isForeground(next) !== isForeground(appState);
    appState = next;
    if (changed) sync(false);
  });
  // A tab's project can resolve after it opens (inventory catching up).
  useTerminalStore.subscribe(() => sync(false));
}
