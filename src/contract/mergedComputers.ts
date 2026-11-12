/**
 * The Project list as one list for every connected computer, as the desktop draws it while Separate by machine is
 * off (the default): a project on several computers is one entry with the sessions of every copy, and a project
 * only another computer has is listed after the selected computer's own. A port of the rules in
 * packages/gx-core/src/sidebar_view/merged.rs, which the phone does not run.
 *
 * The computers' summaries become one summary the ordinary Project list rules (./grouping.ts) draw: each other
 * computer's copy of a project is renamed to the entry's project id, its sessions with it, and `origins` gives each
 * drawn row its own computer back (`restoreOrigins`), so opening, menus and actions still go to that computer.
 *
 * CDXC:RemoteMachines 2026-11-12 SEE-ALSO: the DECISIONs in packages/gx-core/src/sidebar_view/merged.rs (Q1350 to
 * Q1353, #461, #518, Q1993). A project matches another by git remote and its folder inside the repository, else by
 * folder name (./unified/repo.ts); every computer's home project is one Main Hub entry; a worktree and a GBot are
 * never merged; an entry takes at most one copy from each other computer; the header's creating actions go to the
 * copy a session last started in; Spaces and project groups are each computer's added together, by id, else by name.
 */

import type {
  GhostexMobileSummary,
  GhostexProject,
  GhostexProjectCollection,
  GhostexSession,
  GhostexSidebarSpace,
  GhostexSummaryCapabilities,
} from './mobileSummary';
import { folderInRepository, mergeRepoIdentities, projectRepoKey, repoIdentity } from './unified/repo';

export type MergeComputer = { machineId: string; summary: GhostexMobileSummary };

/** Where a drawn session really lives. */
export type SessionOrigin = { machineId: string; session: GhostexSession; capabilities: GhostexSummaryCapabilities };

/** One copy of an entry: its computer and that computer's project id. */
export type ProjectCopyOrigin = { machineId: string; projectId: string };

export type MergedComputers = {
  summary: GhostexMobileSummary;
  /** Every session of the merged summary (a renamed copy for another computer's) to where it lives. */
  origins: Map<GhostexSession, SessionOrigin>;
  /** Each entry's copies, the selected computer's first, by the entry's project id in the merged summary. */
  copies: Map<string, ProjectCopyOrigin[]>;
};

function displayName(project: GhostexProject): string {
  return (project.name ?? '').trim() || (project.path ?? '').split(/[\\/]/).filter(Boolean).pop() || project.projectId;
}

/** Whether a project can join another computer's entry: not a worktree and not a GBot's folder. */
function mergeable(project: GhostexProject): boolean {
  return project.worktreeParentProjectId.length === 0 && project.gbotsProject !== true && project.gbotsBot === undefined;
}

/** Spaces and groups of every computer added together: by id, else by name, members renamed to the entries. */
function unionSpaces(
  computers: readonly MergeComputer[],
  rename: (machineIndex: number, projectId: string) => string,
): GhostexMobileSummary['sidebarSpaces'] {
  const first = computers[0]!.summary.sidebarSpaces;
  const spaces: Record<string, GhostexSidebarSpace> = {};
  const order = [...first.order];
  for (const id of first.order) {
    const space = first.spaces[id];
    if (space !== undefined) spaces[id] = { ...space, memberProjectIds: space.memberProjectIds.map((p) => rename(0, p)) };
  }
  computers.slice(1).forEach(({ summary }, offset) => {
    for (const id of summary.sidebarSpaces.order) {
      const theirs = summary.sidebarSpaces.spaces[id];
      if (theirs === undefined) continue;
      const name = theirs.name.trim().toLowerCase();
      const ours =
        spaces[id] ?? Object.values(spaces).find((space) => space.name.trim().toLowerCase() === name) ?? undefined;
      const members = theirs.memberProjectIds.map((projectId) => rename(offset + 1, projectId));
      if (ours === undefined) {
        spaces[id] = { ...theirs, memberProjectIds: members };
        order.push(id);
        continue;
      }
      ours.memberProjectIds = [...new Set([...ours.memberProjectIds, ...members])];
      ours.memberCollectionIds = [...new Set([...ours.memberCollectionIds, ...theirs.memberCollectionIds])];
    }
  });
  return { order, spaces };
}

function unionCollections(
  computers: readonly MergeComputer[],
  rename: (machineIndex: number, projectId: string) => string,
): GhostexProjectCollection[] {
  const collections: GhostexProjectCollection[] = [];
  computers.forEach(({ summary }, index) => {
    for (const collection of summary.projectCollections) {
      const members = collection.projectIds.map((projectId) => rename(index, projectId));
      const title = collection.title.trim().toLowerCase();
      const ours =
        collections.find((entry) => entry.collectionId === collection.collectionId) ??
        (index === 0 ? undefined : collections.find((entry) => entry.title.trim().toLowerCase() === title));
      if (ours === undefined) collections.push({ ...collection, projectIds: members });
      else ours.projectIds = [...new Set([...ours.projectIds, ...members])];
    }
  });
  return collections;
}

/**
 * One summary for `computers`, the selected computer first (its projects, order, collections and settings lead).
 * Sessions and projects of the others keep their objects' identity apart through `origins`.
 */
export function mergeComputers(computers: readonly MergeComputer[]): MergedComputers {
  const primary = computers[0]!;
  const origins = new Map<GhostexSession, SessionOrigin>();
  const copies = new Map<string, ProjectCopyOrigin[]>();
  // Each computer's own project ids, renamed to the entry they joined (absent: kept as they are).
  const renamed: Map<string, string>[] = computers.map(() => new Map());
  const rename = (machineIndex: number, projectId: string): string => renamed[machineIndex]?.get(projectId) ?? projectId;

  const identityOf = (project: GhostexProject) =>
    repoIdentity(project.gitRemoteOriginUrl, project.path ?? '', null, displayName(project));
  const canonical = mergeRepoIdentities(
    computers.flatMap(({ summary }) => summary.projects.filter(mergeable).map(identityOf)),
  );
  const keyOf = (project: GhostexProject): string => {
    if (project.isHome === true) return 'home:';
    const identity = identityOf(project);
    const folder = identity.key.startsWith('dir:')
      ? null
      : folderInRepository(project.path ?? '', project.gitRepositoryRootPath);
    return projectRepoKey(canonical.get(identity.key)?.key ?? identity.key, folder);
  };

  // The entries, by key: the first copy's project id, and which computers already gave it a copy.
  const entries = new Map<string, { projectId: string; machines: Set<number> }>();
  const projects: GhostexProject[] = [];
  const projectOrder: string[] = [];
  const takenIds = new Set<string>();
  computers.forEach(({ machineId, summary }, machineIndex) => {
    const order = [
      ...(summary.workspaceGroups?.projectOrder ?? []),
      ...summary.projects.map((project) => project.projectId),
    ].filter((id, index, all) => all.indexOf(id) === index);
    const byId = new Map(summary.projects.map((project) => [project.projectId, project]));
    for (const projectId of order) {
      const project = byId.get(projectId);
      if (project === undefined) continue;
      const key = mergeable(project) || project.isHome === true ? keyOf(project) : null;
      const entry = key === null ? undefined : entries.get(key);
      if (entry !== undefined && machineIndex > 0 && !entry.machines.has(machineIndex)) {
        entry.machines.add(machineIndex);
        renamed[machineIndex]!.set(projectId, entry.projectId);
        copies.get(entry.projectId)?.push({ machineId, projectId });
        continue;
      }
      // Its own entry; another computer's project whose id the list already holds gets a distinct one.
      const ownId = takenIds.has(projectId) ? `${machineId}:${projectId}` : projectId;
      if (ownId !== projectId) renamed[machineIndex]!.set(projectId, ownId);
      takenIds.add(ownId);
      if (key !== null && entry === undefined) entries.set(key, { projectId: ownId, machines: new Set([machineIndex]) });
      copies.set(ownId, [{ machineId, projectId }]);
      projects.push(ownId === projectId ? project : { ...project, projectId: ownId });
      projectOrder.push(ownId);
    }
  });
  // A worktree under another computer's copy hangs under the entry.
  for (const [index, project] of projects.entries()) {
    const machineIndex = computers.findIndex(({ machineId }) => copies.get(project.projectId)?.[0]?.machineId === machineId);
    if (machineIndex <= 0 || project.worktreeParentProjectId.length === 0) continue;
    projects[index] = { ...project, worktreeParentProjectId: rename(machineIndex, project.worktreeParentProjectId) };
  }

  const sessions: GhostexSession[] = [];
  computers.forEach(({ machineId, summary }, machineIndex) => {
    for (const session of summary.sessions) {
      const copy =
        machineIndex === 0
          ? session
          : {
              ...session,
              projectId: rename(machineIndex, session.projectId),
              coordinatorProjectId:
                session.coordinatorProjectId.length > 0
                  ? rename(machineIndex, session.coordinatorProjectId)
                  : session.coordinatorProjectId,
            };
      origins.set(copy, { machineId, session, capabilities: summary.capabilities });
      sessions.push(copy);
    }
  });

  // Each project's own session groups, for the projects drawn as their own entry (a merged copy's are not: its
  // sessions are listed with the entry's own, as on the desktop).
  const groupProjects: NonNullable<NonNullable<GhostexMobileSummary['workspaceGroups']>['projects']> = {
    ...(primary.summary.workspaceGroups?.projects ?? {}),
  };
  computers.slice(1).forEach(({ summary }, offset) => {
    for (const [projectId, groups] of Object.entries(summary.workspaceGroups?.projects ?? {})) {
      const ownId = rename(offset + 1, projectId);
      if (copies.get(ownId)?.[0]?.projectId === projectId && groupProjects[ownId] === undefined) {
        groupProjects[ownId] = groups;
      }
    }
  });

  return {
    summary: {
      ...primary.summary,
      projects,
      sessions,
      workspaceGroups: { ...(primary.summary.workspaceGroups ?? {}), projectOrder, projects: groupProjects },
      projectCollections: unionCollections(computers, rename),
      sidebarSpaces: unionSpaces(computers, rename),
    },
    origins,
    copies,
  };
}

/**
 * The copy of an entry its header creates in: the one a session of the entry last started in, else the selected
 * computer's (gx-core merged.rs, Q1353).
 */
export function creatingCopy(merged: MergedComputers, entryProjectId: string): ProjectCopyOrigin | null {
  const copies = merged.copies.get(entryProjectId);
  if (copies === undefined || copies.length === 0) return null;
  let newest: { at: number; copy: ProjectCopyOrigin } | null = null;
  for (const session of merged.summary.sessions) {
    if (session.projectId !== entryProjectId) continue;
    const origin = merged.origins.get(session);
    if (origin === undefined) continue;
    const at = Date.parse(session.createdAt ?? '') || 0;
    const copy = copies.find(
      (candidate) => candidate.machineId === origin.machineId && candidate.projectId === origin.session.projectId,
    );
    if (copy !== undefined && (newest === null || at > newest.at)) newest = { at, copy };
  }
  return newest?.copy ?? copies[0]!;
}
