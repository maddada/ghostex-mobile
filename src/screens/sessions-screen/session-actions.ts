/**
 * SessionsScreen overlay/action model: the Overlay state union, the
 * BulkSessionAction factories, and the small pure session helpers, moved
 * verbatim from src/screens/SessionsScreen.tsx.
 */

import {
  attachCommand,
  killSessionCommand,
  loginShellCommand,
  pinSessionCommand,
  reloadSessionCommand,
  shellQuote,
  sleepSessionCommand,
  wakeSessionCommand,
} from '../../commands/ghostexCli';
import type {
  CollectionHeaderItem,
  GroupHeaderItem,
  ProjectHeaderItem,
  SessionItem,
} from '../../contract/grouping';
import type {
  GhostexQuickAction,
  GhostexSession,
} from '../../contract/mobileSummary';
import { SessionCopy } from '../../copy';
import type { OptimisticInventoryChange } from '../../inventory/optimistic';
import { lifecycleMutation, pinMutation } from '../../sessions/sessionCommands';
import type { MachineRecord } from '../../machines/store';

export type SessionContext = { machine: MachineRecord; item: SessionItem };
export type ProjectContext = { machine: MachineRecord; header: ProjectHeaderItem };

export type CollectionContext = { machine: MachineRecord; header: CollectionHeaderItem };
export type GroupContext = { machine: MachineRecord; item: GroupHeaderItem };
export type MachineContext = { machine: MachineRecord };

export type Overlay =
  | { kind: 'none' }
  | { kind: 'sessionMenu'; ctx: SessionContext; view: 'root' | 'tags' }
  | { kind: 'sessionDetails'; ctx: SessionContext }
  | { kind: 'rename'; ctx: SessionContext; error: string | null }
  | { kind: 'sessionNote'; ctx: SessionContext }
  | { kind: 'delayedSend'; ctx: SessionContext }
  | { kind: 'closeConfirm'; ctx: SessionContext }
  | { kind: 'copyText'; title: string; text: string }
  | { kind: 'projectMenu'; ctx: ProjectContext; view: 'root' | 'collections' }
  | { kind: 'projectKillConfirm'; ctx: ProjectContext }
  | { kind: 'projectDetails'; ctx: ProjectContext }
  | { kind: 'agentMenu'; ctx: ProjectContext }
  | { kind: 'actionsMenu'; ctx: ProjectContext }
  | { kind: 'collectionMenu'; ctx: CollectionContext; view: 'root' | 'colors' }
  | { kind: 'collectionRename'; ctx: CollectionContext; error: string | null }
  | { kind: 'groupMenu'; ctx: GroupContext }
  | { kind: 'machineMenu'; ctx: MachineContext }
  /** Header hamburger: Search Prompts, Settings, Logout. */
  | { kind: 'appMenu' }
  | { kind: 'sectionMenu'; machine: MachineRecord; section: 'quick' | 'projects' }
  | {
      kind: 'confirmAction';
      title: string;
      body: string;
      confirmLabel: string;
      run: () => void;
    }
  | { kind: 'recentProjects'; machine: MachineRecord }
  | { kind: 'recovery'; machine: MachineRecord | null }
  | { kind: 'logs' };

export const NONE: Overlay = { kind: 'none' };

export type BulkSessionAction = {
  sessionId: string;
  command: string;
  closeWarmSession: boolean;
  optimisticChange?: OptimisticInventoryChange;
};

export function closeMutation(sessionId: string): OptimisticInventoryChange {
  return { kind: 'sessionClose', sessionId };
}

export function lifecycleSessionAction(
  session: GhostexSession,
  sleeping: boolean,
): BulkSessionAction {
  const projectId = session.projectId.length > 0 ? session.projectId : undefined;
  return {
    sessionId: session.sessionId,
    command: sleeping
      ? sleepSessionCommand(session.sessionId, projectId)
      : wakeSessionCommand(session.sessionId, projectId),
    closeWarmSession: sleeping,
    optimisticChange: lifecycleMutation(session.sessionId, sleeping),
  };
}

export function closeSessionAction(session: GhostexSession): BulkSessionAction {
  return {
    sessionId: session.sessionId,
    command: killSessionCommand(
      session.sessionId,
      session.projectId.length > 0 ? session.projectId : undefined,
    ),
    closeWarmSession: true,
    optimisticChange: closeMutation(session.sessionId),
  };
}

export function pinSessionAction(session: GhostexSession, isPinned: boolean): BulkSessionAction {
  return {
    sessionId: session.sessionId,
    command: pinSessionCommand(session.sessionId, isPinned),
    closeWarmSession: false,
    optimisticChange: pinMutation(session.sessionId, isPinned),
  };
}

export function reloadSessionAction(session: GhostexSession): BulkSessionAction {
  return {
    sessionId: session.sessionId,
    command: reloadSessionCommand(session.sessionId),
    closeWarmSession: false,
  };
}

/**
 * `ssh -tt [-p port] user@host '<login-shell attach command>'` (§2 row 7). A
 * tailcat machine has no address to ssh to — its host is a synthetic host-key
 * identity — so the copied command is the attach command to run on the machine.
 */
export function attachSshCommand(machine: MachineRecord, session: GhostexSession): string {
  const remote = loginShellCommand(
    attachCommand(session.sessionId, session.projectId.length > 0 ? session.projectId : undefined),
  );
  if (machine.transport === 'tailcat') return remote;
  const portFlag = machine.port === 22 ? '' : ` -p ${machine.port}`;
  return `ssh -tt${portFlag} ${machine.username}@${machine.host} ${shellQuote(remote)}`;
}

export function sessionTitle(session: GhostexSession): string {
  return session.displayTitle.length > 0 ? session.displayTitle : SessionCopy.fallbackTitle;
}

export function quickActionDisplayName(action: GhostexQuickAction): string {
  if (action.name !== undefined && action.name.length > 0) {
    return action.name;
  }
  return action.actionType === 'browser' ? 'Browser' : 'Terminal';
}
