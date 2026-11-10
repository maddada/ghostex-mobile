/**
 * The session list the chat core names the other session from on a message between agents
 * (`Event::SessionDirectoryChanged` in `packages/gx-chat-core/src/event.rs`): every session the
 * phone's inventory knows, on every machine. The desktop host builds the same list from its
 * sidebar store (`apps/desktop/src/app/gx_chat/session_directory.rs`).
 */

import type { ChatKnownSession } from './core-types';
import { useInventoryStore } from '../../inventory/store';
import { machineDisplayLabel, useMachinesStore } from '../../machines/store';

type Directory = { key: string; sessions: ChatKnownSession[] };

let cached: Directory = { key: '', sessions: [] };

/** The inventory's sessions as the core reads them. */
export function currentSessionDirectory(): ChatKnownSession[] {
  const sessions: ChatKnownSession[] = [];
  const machines = useMachinesStore.getState().machines;
  for (const [machineId, inventory] of Object.entries(useInventoryStore.getState().inventoriesByMachineId)) {
    // The `+` picker offers sessions on the other computers by name, and none on a computer whose
    // last poll failed (the sessions list's own test for a computer that is not connected).
    const machine = machines.find((candidate) => candidate.id === machineId);
    const computer = machine !== undefined ? machineDisplayLabel(machine) : '';
    const offline = !inventory.hasLoaded || inventory.lastError !== null;
    for (const session of inventory.summary?.sessions ?? []) {
      sessions.push({
        globalRef: session.globalRef,
        projectId: session.projectId,
        sessionId: session.sessionId,
        title: session.displayTitle || session.title,
        agentId: session.agent,
        agentName: session.agentName,
        coordinator: session.isCoordinator === true,
        // The `+` picker's "Main" (gx-chat-core `choice_detail`).
        mainCoordinator: session.isMainCoordinator === true,
        // The composer's `+` picker shows each session's state, newest first.
        activity: session.activity,
        lifecycleState: session.isSleeping ? 'sleeping' : session.status,
        activeAt: session.lastInteractionAt || session.lastActiveAt,
        computer,
        projectName: session.projectName,
        offline,
      });
    }
  }
  // The inventory is replaced on every 5 s poll, so a change is a change to what the core reads.
  const key = JSON.stringify(sessions);
  if (key !== cached.key) cached = { key, sessions };
  return cached.sessions;
}

/** Calls `listener` with the directory whenever a session is added, removed or renamed. */
export function subscribeSessionDirectory(listener: (sessions: ChatKnownSession[]) => void): () => void {
  let last = currentSessionDirectory();
  return useInventoryStore.subscribe((state, previous) => {
    if (state.inventoriesByMachineId === previous.inventoriesByMachineId) return;
    const next = currentSessionDirectory();
    if (next === last) return;
    last = next;
    listener(next);
  });
}

/**
 * The phone's computer a session on another computer than the chat's runs on, by its Global Ref
 * (`<serverId>:<projectId>:<sessionId>`), for a mention pill's `openAgentSession` that names a
 * `serverId` (`open_mentioned_session` in gx-chat-core `transcript/actions.rs`); `null` when no
 * computer the phone polls has it.
 */
export function machineIdOfGlobalRef(globalRef: string): string | null {
  for (const [machineId, inventory] of Object.entries(useInventoryStore.getState().inventoriesByMachineId)) {
    if ((inventory.summary?.sessions ?? []).some((session) => session.globalRef === globalRef)) return machineId;
  }
  return null;
}
