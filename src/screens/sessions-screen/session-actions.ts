/**
 * SessionsScreen overlay/action model: the Overlay state union, the
 * BulkSessionAction factories, and the small pure session helpers, moved
 * verbatim from src/screens/SessionsScreen.tsx.
 */

import {
  cancelDelayedSendCommand,
  closeAfterDoneCommand,
  killSessionCommand,
  parkSessionCommand,
  pinSessionCommand,
  reloadSessionCommand,
  sleepSessionCommand,
  tagSessionCommand,
  wakeSessionCommand,
} from '../../commands/ghostexCli';
import type { CollectionHeaderItem, GroupHeaderItem, ProjectHeaderItem, SessionItem } from '../../contract/grouping';
import type { GhostexQuickAction, GhostexSession } from '../../contract/mobileSummary';
import { SessionCopy } from '../../copy';
import type { OptimisticInventoryChange } from '../../inventory/optimistic';
import {
  lifecycleMutation,
  parkMutation,
  pinMutation,
  tagMutation,
} from '../../sessions/sessionCommands';
import type { MachineRecord } from '../../machines/store';
import type { ExportedTranscript } from '../terminal-screen/session-lookups';

export type SessionContext = { machine: MachineRecord; item: SessionItem };
export type ProjectContext = { machine: MachineRecord; header: ProjectHeaderItem };

export type CollectionContext = { machine: MachineRecord; header: CollectionHeaderItem };
export type GroupContext = { machine: MachineRecord; item: GroupHeaderItem };
export type MachineContext = { machine: MachineRecord };

export type Overlay =
  | { kind: 'none' }
  /** `menuPath`: the labels of the submenus opened so far, root first. */
  | { kind: 'sessionMenu'; ctx: SessionContext; menuPath: readonly string[] }
  | { kind: 'rename'; ctx: SessionContext; error: string | null }
  | { kind: 'sessionNote'; ctx: SessionContext }
  | { kind: 'delayedSend'; ctx: SessionContext }
  | { kind: 'closeConfirm'; ctx: SessionContext }
  /** Handoff / Export's result: the exported path and the follow-up conversation. */
  | { kind: 'exportedTranscript'; exported: ExportedTranscript; projectTitle: string }
  | { kind: 'projectMenu'; ctx: ProjectContext; menuPath: readonly string[] }
  | { kind: 'projectKillConfirm'; ctx: ProjectContext }
  | { kind: 'projectDetails'; ctx: ProjectContext }
  | { kind: 'agentMenu'; ctx: ProjectContext }
  | { kind: 'newCoordinator'; ctx: ProjectContext }
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

export function lifecycleSessionAction(session: GhostexSession, sleeping: boolean): BulkSessionAction {
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
    command: killSessionCommand(session.sessionId, session.projectId.length > 0 ? session.projectId : undefined),
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

/** Park or unpark; the CLI selects the session by project and id. */
export function parkSessionAction(session: GhostexSession, parked: boolean): BulkSessionAction {
  return {
    sessionId: session.sessionId,
    command: parkSessionCommand(session.sessionId, session.projectId, parked),
    closeWarmSession: false,
    optimisticChange: parkMutation(session.sessionId, parked),
  };
}

/** Set a tag, or clear it with `null`. */
export function tagSessionAction(session: GhostexSession, tag: string | null): BulkSessionAction {
  const value = tag ?? 'none';
  return {
    sessionId: session.sessionId,
    command: tagSessionCommand(session.sessionId, value),
    closeWarmSession: false,
    optimisticChange: tagMutation(session.sessionId, value),
  };
}

export function closeAfterDoneSessionAction(session: GhostexSession): BulkSessionAction {
  return {
    sessionId: session.sessionId,
    command: closeAfterDoneCommand(session.sessionId),
    closeWarmSession: false,
  };
}

export function cancelDelayedSendSessionAction(session: GhostexSession): BulkSessionAction {
  return {
    sessionId: session.sessionId,
    command: cancelDelayedSendCommand(session.sessionId),
    closeWarmSession: false,
  };
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
