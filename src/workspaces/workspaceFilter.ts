/**
 * Workspace filtering for the sessions drawer: which of a computer's workspaces the phone shows,
 * and the summary that workspace's projects, sessions and Spaces are drawn from.
 *
 * CDXC:Workspaces 2026-10-09 SEE-ALSO:
 * The rules mirror gx-core `sidebar_view/workspaces.rs` (`WindowWorkspace`, `project_workspace_id`):
 * a project or Space with no or an unknown `workspaceId` belongs to the default workspace, a
 * worktree project follows its parent checkout's, an `everyWorkspace` project shows in every
 * workspace, and a row whose project the summary does not list is never hidden. On the phone each
 * computer is its own tab with its own workspaces, so the desktop's rule for a remote machine's
 * tab (shown only in the workspace it was assigned to) has no counterpart here.
 */

import type {
  GhostexMobileSummary,
  GhostexProject,
  GhostexWorkspace,
  GhostexWorkspaces,
} from '../contract/mobileSummary';

/** `id` when it names a workspace, else the default workspace's (`SidebarWorkspacesState::resolve`). */
export function resolveWorkspaceId(workspaces: GhostexWorkspaces, id: string | undefined): string {
  if (id !== undefined && workspaces.workspaces[id] !== undefined) return id;
  return workspaces.defaultWorkspaceId;
}

/** Workspaces in display order. */
export function orderedWorkspaces(workspaces: GhostexWorkspaces): GhostexWorkspace[] {
  return workspaces.order.flatMap((workspaceId) => {
    const workspace = workspaces.workspaces[workspaceId];
    return workspace === undefined ? [] : [workspace];
  });
}

/**
 * The workspace one tap on the workspace tile's letter switches to: the most recently shown other
 * workspace, else the next one in display order. Null with a single workspace, when the letter
 * opens the menu instead. Mirrors gx-core `workspace_switch_target` (sidebar_menu/workspace.rs).
 */
export function workspaceSwitchTarget(
  workspaces: GhostexWorkspaces,
  currentId: string,
  recentIds: readonly string[],
): GhostexWorkspace | null {
  for (const id of recentIds) {
    if (id === currentId) continue;
    const recent = workspaces.workspaces[id];
    if (recent !== undefined) return recent;
  }
  const ordered = orderedWorkspaces(workspaces);
  const position = ordered.findIndex((workspace) => workspace.workspaceId === currentId);
  for (let offset = 0; offset < ordered.length; offset += 1) {
    const candidate = ordered[(position + 1 + offset) % ordered.length];
    if (candidate.workspaceId !== currentId) return candidate;
  }
  return null;
}

/** The workspace a project belongs to: its own, or its parent checkout's for a worktree project. */
function projectWorkspaceId(
  workspaces: GhostexWorkspaces,
  projectsById: ReadonlyMap<string, GhostexProject>,
  project: GhostexProject,
): string {
  const parent =
    project.worktreeParentProjectId.length > 0
      ? projectsById.get(project.worktreeParentProjectId)
      : undefined;
  return resolveWorkspaceId(workspaces, parent?.workspaceId ?? project.workspaceId);
}

function projectsById(summary: GhostexMobileSummary): Map<string, GhostexProject> {
  return new Map(summary.projects.map((project) => [project.projectId, project]));
}

/**
 * The summary the drawer renders for one workspace: its projects (chat projects are the Quick
 * section, which no workspace scopes on the phone), their sessions, and its Spaces. Unchanged when
 * the computer has no workspaces.
 */
export function filterSummaryForWorkspace(
  summary: GhostexMobileSummary,
  workspaceId: string,
): GhostexMobileSummary {
  const workspaces = summary.workspaces;
  if (workspaces === null) return summary;
  const byId = projectsById(summary);
  const projects = summary.projects.filter(
    (project) =>
      project.isChat === true ||
      project.everyWorkspace === true ||
      projectWorkspaceId(workspaces, byId, project) === workspaceId,
  );
  const keptProjectIds = new Set(projects.map((project) => project.projectId));
  const sessions = summary.sessions.filter(
    (session) => !byId.has(session.projectId) || keptProjectIds.has(session.projectId),
  );
  const spaceIds = summary.sidebarSpaces.order.filter((spaceId) => {
    const space = summary.sidebarSpaces.spaces[spaceId];
    return space !== undefined && resolveWorkspaceId(workspaces, space.workspaceId) === workspaceId;
  });
  const spaces = Object.fromEntries(
    spaceIds.map((spaceId) => [spaceId, summary.sidebarSpaces.spaces[spaceId]]),
  );
  return { ...summary, projects, sessions, sidebarSpaces: { order: spaceIds, spaces } };
}

/**
 * The workspace a session is shown in, or null when it shows in every workspace (its project is
 * shown everywhere, is unknown to the summary, or the computer has no workspaces).
 */
export function sessionWorkspaceId(summary: GhostexMobileSummary, sessionId: string): string | null {
  const workspaces = summary.workspaces;
  if (workspaces === null) return null;
  const session = summary.sessions.find((entry) => entry.sessionId === sessionId);
  if (session === undefined) return null;
  const byId = projectsById(summary);
  const project = byId.get(session.projectId);
  if (project === undefined || project.everyWorkspace === true || project.isChat === true) return null;
  return projectWorkspaceId(workspaces, byId, project);
}
