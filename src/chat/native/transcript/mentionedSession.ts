/**
 * What a session pill shows besides its name (a mention in a message, a "Message from / to" card's
 * name, a Workers row): the session's state dot, the computer icon when it runs on another computer
 * than the chat's, and the card a long press shows. Read live from the phone's session list, so the
 * dot follows the session the way the sidebar's does; the transcript's own document names the
 * session but is not rebuilt for a state change.
 *
 * SEE-ALSO: `mention_card` in packages/gx-chat-core/src/transcript/session_mentions.rs (the same
 * rule for the desktop and the web build: the state words of `session_choice`, and "another
 * computer" as the ref's server against the chat's own, `chat_server`); `currentSessionDirectory`
 * in `../../rust/sessionDirectory.ts`, the list the core reads.
 */

import { useInventoryStore } from '../../../inventory/store';
import { machineDisplayLabel, useMachinesStore } from '../../../machines/store';
import { computerIconDrawing, useComputerIconsStore } from '../../../machines/computerIcons';
import type { GhostexSession } from '../../../contract/mobileSummary/session';

export type MentionState = 'Working' | 'Needs you' | 'Idle' | 'Sleeping';

export type MentionedSession = {
  title: string;
  agentName: string;
  projectName: string;
  state: MentionState;
  /** The computer's name, for a session on another computer than the chat's; '' on the chat's own. */
  computer: string;
  /** That computer's machine id, which its icon is read for; '' on the chat's own. */
  machineId: string;
};

/** The server part of a Global Ref (`S90` of `S90:P3lv0:G7hgi`); '' for anything else. */
export function serverOfRef(globalRef: string): string {
  const parts = globalRef.trim().split(':');
  return parts.length === 3 && parts.every((part) => part.length > 0) ? parts[0]! : '';
}

/** The state word gx-chat-core's `session_choice` gives a session (the `+` picker's). */
export function mentionState(session: Pick<GhostexSession, 'activity' | 'isSleeping' | 'status'>): MentionState {
  if (session.isSleeping || session.status === 'sleeping') return 'Sleeping';
  if (session.activity === 'working') return 'Working';
  if (session.activity === 'attention') return 'Needs you';
  return 'Idle';
}

/** Which session a pill names: its Global Ref (a mention), else its project and session ids (a card). */
export type MentionTarget = { globalRef?: string; projectId?: string; sessionId?: string; serverId?: string };

type Inventories = ReturnType<typeof useInventoryStore.getState>['inventoriesByMachineId'];

function lookUp(
  inventories: Inventories,
  homeMachineId: string | null,
  target: MentionTarget,
): { session: GhostexSession; machineId: string } | null {
  const ref = (target.globalRef ?? '').trim();
  const parts = ref.split(':');
  const projectId = target.projectId ?? (parts.length === 3 ? parts[1]! : '');
  const sessionId = target.sessionId ?? (parts.length === 3 ? parts[2]! : '');
  const server = target.serverId ?? serverOfRef(ref);
  // The chat's own computer first: ids are only unique within one gxserver.
  const order = Object.keys(inventories).sort((a, b) => Number(b === homeMachineId) - Number(a === homeMachineId));
  for (const machineId of order) {
    for (const session of inventories[machineId]?.summary?.sessions ?? []) {
      if (ref.length > 0 && session.globalRef === ref) return { session, machineId };
      if (
        session.projectId === projectId &&
        session.sessionId === sessionId &&
        (server.length === 0 || serverOfRef(session.globalRef) === server)
      )
        return { session, machineId };
    }
  }
  return null;
}

/** The gxserver the chat runs on: the server of its computer's sessions; '' when unknown. */
function homeServer(inventories: Inventories, homeMachineId: string | null): string {
  if (homeMachineId === null) return '';
  for (const session of inventories[homeMachineId]?.summary?.sessions ?? []) {
    const server = serverOfRef(session.globalRef);
    if (server.length > 0) return server;
  }
  return '';
}

/**
 * The session a pill names, live, or null when the phone's list does not have it. Re-renders only
 * when what the pill shows changes, not on every poll.
 */
export function useMentionedSession(
  target: MentionTarget | null,
  homeMachineId: string | null,
): MentionedSession | null {
  const key = useInventoryStore((store) => {
    if (target === null) return '';
    const found = lookUp(store.inventoriesByMachineId, homeMachineId, target);
    if (found === null) return '';
    const home = homeServer(store.inventoriesByMachineId, homeMachineId);
    const server = serverOfRef(found.session.globalRef);
    const elsewhere = home.length > 0 && server.length > 0 && server !== home;
    return JSON.stringify([
      found.session.displayTitle || found.session.title,
      found.session.agentName || found.session.agent,
      found.session.projectName,
      mentionState(found.session),
      elsewhere ? found.machineId : '',
    ]);
  });
  const machines = useMachinesStore((store) => store.machines);
  if (key.length === 0) return null;
  const [title, agentName, projectName, state, machineId] = JSON.parse(key) as [
    string,
    string,
    string,
    MentionState,
    string,
  ];
  const machine = machineId.length > 0 ? machines.find((candidate) => candidate.id === machineId) : undefined;
  return {
    title,
    agentName,
    projectName,
    state,
    computer: machineId.length === 0 ? '' : machine !== undefined ? machineDisplayLabel(machine) : 'Another computer',
    machineId,
  };
}

/** The card's second line: agent, project and computer ("This computer" for the chat's own). */
export function mentionMeta(session: MentionedSession): string {
  return [session.agentName, session.projectName, session.computer || 'This computer']
    .filter((part) => part.length > 0)
    .join(' · ');
}

/**
 * The drawing of the computer whose gxserver is `serverId` (a Workers row's `serverId`): its own
 * icon (machines/computerIcons.ts), else the plain computer.
 */
export function useServerComputerDrawing(serverId: string): string {
  const machineId = useInventoryStore((store) => {
    if (serverId.length === 0) return '';
    for (const [machineId, inventory] of Object.entries(store.inventoriesByMachineId)) {
      if ((inventory?.summary?.sessions ?? []).some((session) => serverOfRef(session.globalRef) === serverId)) {
        return machineId;
      }
    }
    return '';
  });
  return useComputerIconDrawing(machineId);
}

/** The drawing of the computer `machineId` names: its own icon, else the plain computer. */
export function useComputerIconDrawing(machineId: string): string {
  const facts = useComputerIconsStore((state) => (machineId.length > 0 ? state.facts[machineId] : undefined));
  return facts !== undefined ? computerIconDrawing(facts) : 'desktop';
}
