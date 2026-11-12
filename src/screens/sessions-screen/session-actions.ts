/**
 * SessionsScreen overlay/action model: the Overlay state union, the
 * BulkSessionAction factories, and the small pure session helpers, moved
 * verbatim from src/screens/SessionsScreen.tsx.
 */

import {
  type WorkLinkKind,
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
import type {
  CollectionHeaderItem,
  GroupHeaderItem,
  ProjectHeaderItem,
  SessionItem,
  SessionKindLabelItem,
} from '../../contract/grouping';
import { claudeCloudCloseSleeps } from '../../contract/claudeCloud';
import type { MenuAnchor } from '../../components/sessions/ContextMenu';
import type { GhostexSession } from '../../contract/mobileSummary';
import { SessionCopy } from '../../copy';
import type { OptimisticInventoryChange } from '../../inventory/optimistic';
import { lifecycleMutation, parkMutation, pinMutation, tagMutation } from '../../sessions/sessionCommands';
import type { MachineRecord } from '../../machines/store';
import type { ExportedTranscript } from '../terminal-screen/session-lookups';
import { isRunningSession } from './sidebar-menus';

/** `unified`: opened from the Unified list, whose menu also offers Snooze and the project's Actions…. */
export type SessionContext = { machine: MachineRecord; item: SessionItem; unified?: boolean };
export type ProjectContext = { machine: MachineRecord; header: ProjectHeaderItem };

export type CollectionContext = { machine: MachineRecord; header: CollectionHeaderItem };
export type GroupContext = { machine: MachineRecord; item: GroupHeaderItem };
/** A Parked section heading (the only section heading with a menu). */
export type ParkedContext = { machine: MachineRecord; item: SessionKindLabelItem };
export type MachineContext = { machine: MachineRecord };

export type Overlay =
  | { kind: 'none' }
  /** `menuPath`: the labels of the submenus opened so far, root first. */
  | { kind: 'sessionMenu'; ctx: SessionContext; menuPath: readonly string[] }
  | { kind: 'rename'; ctx: SessionContext; error: string | null }
  | { kind: 'sessionNote'; ctx: SessionContext }
  /** The Link to picker for one kind of work link. */
  | { kind: 'workLinkPicker'; ctx: SessionContext; linkKind: WorkLinkKind }
  | { kind: 'delayedSend'; ctx: SessionContext }
  /** A session's links sheet, from its long-press menu's Links row. */
  | { kind: 'sessionLinks'; ctx: SessionContext }
  /** An orchestrator's Goal & Instructions or Memory editor (./CoordinatorDetailsSheet.tsx). */
  | { kind: 'coordinatorDetails'; ctx: SessionContext; mode: 'goal' | 'memory' }
  /** An orchestrator's playbook, read-only (./CoordinatorPlaybookSheet.tsx). */
  | { kind: 'coordinatorPlaybook'; ctx: SessionContext }
  | { kind: 'closeConfirm'; ctx: SessionContext }
  /** Handoff / Export's result: the exported path and the follow-up conversation. */
  | { kind: 'exportedTranscript'; exported: ExportedTranscript; projectTitle: string }
  | { kind: 'projectMenu'; ctx: ProjectContext; menuPath: readonly string[] }
  | { kind: 'projectKillConfirm'; ctx: ProjectContext }
  | { kind: 'projectDetails'; ctx: ProjectContext }
  | { kind: 'agentMenu'; ctx: ProjectContext }
  /**
   * The project list: from the agent menu's project row a pick opens the agent menu again on that
   * project (`agentMenu`); from the header's New session a pick starts there (`start`).
   */
  | { kind: 'newSessionProject'; currentMachineId: string; purpose: 'agentMenu' | 'start' }
  | { kind: 'newCoordinator'; ctx: ProjectContext }
  | { kind: 'actionsMenu'; ctx: ProjectContext }
  | { kind: 'collectionMenu'; ctx: CollectionContext; view: 'root' | 'colors' }
  | { kind: 'collectionRename'; ctx: CollectionContext; error: string | null }
  | { kind: 'groupMenu'; ctx: GroupContext }
  | { kind: 'parkedMenu'; ctx: ParkedContext }
  | { kind: 'machineMenu'; ctx: MachineContext }
  | { kind: 'machinePicker'; purpose: 'select' | 'addProject' }
  /** Header hamburger: Search Prompts, Settings, Logout; at its button on the iPhone Duo (`anchor`). */
  | { kind: 'appMenu'; anchor?: MenuAnchor }
  /** The desktop's More › Sort & Filter: how the list is organized (synced) and the tag filter (this phone's). */
  | { kind: 'sortFilter' }
  | { kind: 'sectionMenu'; machine: MachineRecord; section: 'projects' }
  | {
      kind: 'confirmAction';
      title: string;
      body: string;
      confirmLabel: string;
      run: () => void;
    }
  | { kind: 'recentProjects'; machine: MachineRecord }
  | { kind: 'recovery'; machine: MachineRecord | null }
  | { kind: 'logs' }
  /** Every computer's connection (src/components/sessions/ConnectionsSheet.tsx). */
  | { kind: 'connections' };

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

/**
 * Close: an awake Claude cloud row is put to sleep instead and stays listed ("Keep it listed,
 * asleep", `claudeCloudCloseSleeps`); every other row is killed.
 */
export function closeSessionAction(session: GhostexSession, closeSource: string): BulkSessionAction {
  return closePutsSessionToSleep(session)
    ? lifecycleSessionAction(session, true)
    : killSessionAction(session, closeSource);
}

/** `closeSessionAction` for a list's `map`, every close naming the same door. */
export function closeSessionActionFrom(closeSource: string): (session: GhostexSession) => BulkSessionAction {
  return (session) => closeSessionAction(session, closeSource);
}

/** Whether Close puts this row to sleep instead of closing it (an awake Claude cloud row). */
export function closePutsSessionToSleep(session: GhostexSession): boolean {
  return claudeCloudCloseSleeps(session.claudeCloud) && isRunningSession(session);
}

/** Kill: the session's row leaves the list, Claude cloud rows included. */
export function killSessionAction(session: GhostexSession, closeSource: string): BulkSessionAction {
  return {
    sessionId: session.sessionId,
    command: killSessionCommand(
      session.sessionId,
      session.projectId.length > 0 ? session.projectId : undefined,
      closeSource,
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
