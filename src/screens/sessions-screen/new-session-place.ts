/**
 * Where a new session starts on the phone: every computer's projects as the agent menu, its
 * project sheet and the composer's tray offer them (gx-core `unified_sidebar/choices.rs` through
 * `contract/unified/choices.ts`), read from the stores at the moment they are opened.
 *
 * CDXC:Sidebar 2026-11-03 DECISION:
 * User (Q1167, Q1188 "all"): "i want to pick the project then pick which machine on the "New thread" page itself (default to the machine used last)", on the phone in the same change. So the phone's agent menu starts on a project and a machine, its top row opens a project-only list (Recent first, projects with no session marked "No sessions"), and its machine chips under that row change the machine.
 * SEE-ALSO: apps/desktop/src/app/gx_store/unified_new_session.rs (the desktop's picker host).
 */

import { LOCAL_MACHINE_KEY, OTHER_SPACE_ID, spaceFilterKey, spaceOfProject } from '../../contract/unified/build';
import {
  unifiedProjectChoices,
  type UnifiedChoiceMachineInput,
  type UnifiedProjectChoice,
} from '../../contract/unified/choices';
import { unifiedMachineInput } from '../../contract/unified/fromSummary';
import { mergedRepoIdentities, repoIdentity } from '../../contract/unified/repo';
import type { GhostexMobileSummary } from '../../contract/mobileSummary';
import { useInventoryStore } from '../../inventory/store';
import { enabledMachines, machineDisplayLabel, useMachinesStore } from '../../machines/store';
import { filterSummaryForSpace } from '../../spaces/spaceFilter';
import { filterSummaryForWorkspace, projectWorkspaceIdOf } from '../../workspaces/workspaceFilter';
import type { NewSessionComputer } from './new-session-button';
import { useUnifiedListStore } from './unified-list-store';

/** Each computer the phone has read, with its projects and which of them has an open session. */
export function projectChoiceInputsNow(): UnifiedChoiceMachineInput[] {
  const inventories = useInventoryStore.getState().inventoriesByMachineId;
  const machines = enabledMachines(useMachinesStore.getState());
  const inputs: UnifiedChoiceMachineInput[] = [];
  for (const machine of machines) {
    const inventory = inventories[machine.id];
    const summary = inventory?.summary ?? null;
    if (summary === null) continue;
    const label = machineDisplayLabel(machine);
    const { projects, sessions } = unifiedMachineInput({ machineId: machine.id, label, summary, workspaceId: null }, false);
    const live = sessions.filter((session) => !session.isBrowser);
    const withSessions = new Set(live.map((session) => session.projectId));
    // Recent leads with the projects whose sessions came back to you last (gx-core `recent_order`).
    const activity = new Map<string, number>();
    for (const session of live) {
      if (session.lastInteractionMs === null) continue;
      activity.set(session.projectId, Math.max(activity.get(session.projectId) ?? session.lastInteractionMs, session.lastInteractionMs));
    }
    inputs.push({
      machine: machine.id,
      label,
      connected: (inventory?.lastError ?? null) === null,
      projects: projects.map((project) => ({
        ...project,
        hasSessions: withSessions.has(project.projectId),
        lastActivityMs: activity.get(project.projectId) ?? null,
      })),
    });
  }
  return inputs;
}

/** The project list, Recent first, each row starting on its own default machine. */
export function projectChoicesNow(currentMachineId: string): UnifiedProjectChoice[] {
  const { lastMachines, recentRepos } = useUnifiedListStore.getState();
  return unifiedProjectChoices(projectChoiceInputsNow(), lastMachines, recentRepos, currentMachineId, currentMachineId);
}

/**
 * The repository a project of a computer belongs to, as the project list keys it: merged across
 * every computer the phone has read (gx-core `merge_repo_identities`), so a project on another
 * computer and its twin here share one key.
 */
export function repoKeyOfProject(machineId: string, projectId: string): string | null {
  const inputs = projectChoiceInputsNow();
  const machineIndex = inputs.findIndex((machine) => machine.machine === machineId);
  if (machineIndex < 0) return null;
  const projectIndex = inputs[machineIndex]!.projects.findIndex((project) => project.projectId === projectId);
  if (projectIndex < 0) return null;
  const identities = mergedRepoIdentities(
    inputs.map((machine) =>
      machine.projects.map((project) =>
        repoIdentity(project.gitRemoteOriginUrl, project.path, project.worktreeParentPath, project.title),
      ),
    ),
  );
  return identities[machineIndex]![projectIndex]!.key;
}

/** The Unified filter's key of the Space that shows a project, or null when its computer has none. */
export function spaceKeyOfProject(machineId: string, projectId: string): string | null {
  const summary = useInventoryStore.getState().inventoriesByMachineId[machineId]?.summary ?? null;
  if (summary === null) return null;
  const machine = unifiedMachineInput({ machineId, label: '', summary, workspaceId: null }, false);
  const project = machine.projects.find((entry) => entry.projectId === projectId);
  if (machine.spaces === null || project === undefined) return null;
  // The list keys a lone computer as `local` (`unifiedListOf`), and its Spaces with it.
  const alone = projectChoiceInputsNow().length === 1;
  return spaceFilterKey(alone ? LOCAL_MACHINE_KEY : machineId, spaceOfProject(machine.spaces, project));
}

/** A session started in a project of a computer: its machine and Recent, and the filter's chips. */
export function noteNewSessionIn(machineId: string, projectId: string): void {
  const repoKey = repoKeyOfProject(machineId, projectId);
  if (repoKey === null) return;
  const alone = projectChoiceInputsNow().length === 1;
  useUnifiedListStore
    .getState()
    .noteNewSession(repoKey, alone ? LOCAL_MACHINE_KEY : machineId, spaceKeyOfProject(machineId, projectId));
}

/** Every saved computer, as the New session button reads an empty project list (./new-session-button.tsx). */
export function newSessionComputersNow(): NewSessionComputer[] {
  const inventories = useInventoryStore.getState().inventoriesByMachineId;
  return enabledMachines(useMachinesStore.getState()).map((machine) => {
    const inventory = inventories[machine.id];
    return {
      label: machineDisplayLabel(machine),
      read: (inventory?.summary ?? null) !== null,
      failed: (inventory?.lastError ?? null) !== null,
    };
  });
}

/**
 * The Space a project's agent pick is looked up and remembered under, in `summary` (the project's
 * own workspace): the drawer's Space when it shows the project (so the Project list's headers keep
 * theirs), else the Space that shows it
 * (`spaceOfProject`: its collection's, its worktree parent's, or Other). A start from the New
 * session sheet, a Unified group or the filter can be in a project of another Space.
 */
export function agentSpaceOfProject(
  summary: GhostexMobileSummary,
  machineId: string,
  projectId: string,
  drawerSpaceId: string,
): string {
  // A Space of this summary (the drawer can be on another workspace's).
  const drawerHere = drawerSpaceId === OTHER_SPACE_ID || summary.sidebarSpaces.spaces[drawerSpaceId] !== undefined;
  if (
    drawerHere &&
    filterSummaryForSpace(summary, drawerSpaceId).projects.some((project) => project.projectId === projectId)
  ) {
    return drawerSpaceId;
  }
  const machine = unifiedMachineInput({ machineId, label: '', summary, workspaceId: null }, false);
  const project = machine.projects.find((entry) => entry.projectId === projectId);
  if (machine.spaces === null || project === undefined) return OTHER_SPACE_ID;
  return spaceOfProject(machine.spaces, project);
}

/**
 * A computer's summary as the workspace of one of its projects sees it, with that workspace's
 * Spaces: the workspace shown on the phone can have none while the project's has some.
 */
export function summaryOfProjectWorkspace(summary: GhostexMobileSummary, projectId: string): GhostexMobileSummary {
  const workspaceId = projectWorkspaceIdOf(summary, projectId);
  return workspaceId === null ? summary : filterSummaryForWorkspace(summary, workspaceId);
}
