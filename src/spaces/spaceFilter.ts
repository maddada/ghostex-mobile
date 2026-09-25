/**
 * Space filtering for the sessions drawer: which Space a machine is showing,
 * and the summary that Space's content is built from.
 *
 * The membership rule itself lives in ./otherSpace, mirrored verbatim from
 * packages/shared/sidebar-spaces-other.ts, so the phone and the desktop sidebar
 * can never disagree about what a Space — or the built-in Other — contains.
 */

import type {
  GhostexMobileSummary,
  GhostexSidebarSpace,
  GhostexSidebarSpaces,
} from '../contract/mobileSummary';
import { countSessions, type SessionCounts } from '../contract/grouping';
import {
  isSidebarSpaceProject,
  isUnassignedSidebarSpaceProject,
  OTHER_SIDEBAR_SPACE_ID,
} from './otherSpace';

/** The Space row as rendered: the machine's Spaces in order, then Other last. */
export type SpaceRowItem = {
  spaceId: string;
  name: string;
  /** COMMAND_ICONS glyph name. */
  icon: string;
  color: string;
};

/** Spaces in `order`, ignoring ids the daemon no longer knows. */
export function orderedSpaces(spaces: GhostexSidebarSpaces): GhostexSidebarSpace[] {
  return spaces.order.flatMap((spaceId) => {
    const space = spaces.spaces[spaceId];
    return space === undefined ? [] : [space];
  });
}

/**
 * The default selection rule, mirroring `resolveSelectedSidebarSpace` in
 * packages/core-ui/sidebar-app/space-filtering.ts: nothing stored — and a
 * stored Space the daemon no longer has — shows the FIRST Space in order, or
 * Other when the machine has no Spaces. Never a ghost Space, and never an
 * "unfiltered" view.
 */
export function resolveSelectedSpaceId(
  spaces: GhostexSidebarSpaces,
  storedSpaceId: string | undefined,
): string {
  if (storedSpaceId === OTHER_SIDEBAR_SPACE_ID) return OTHER_SIDEBAR_SPACE_ID;
  if (storedSpaceId !== undefined && spaces.spaces[storedSpaceId] !== undefined) {
    return storedSpaceId;
  }
  return spaces.order.find((spaceId) => spaces.spaces[spaceId] !== undefined)
    ?? OTHER_SIDEBAR_SPACE_ID;
}

/**
 * Collection ("group") each project resolves to, including one level of
 * worktree inheritance — mirroring `createProjectCollectionIdByProjectId` in
 * packages/core-ui/sidebar-app/drag-drop-geometry.ts.
 */
function collectionIdByProjectId(summary: GhostexMobileSummary): Map<string, string> {
  const result = new Map<string, string>();
  for (const collection of summary.projectCollections) {
    for (const projectId of collection.projectIds) result.set(projectId, collection.collectionId);
  }
  for (const project of summary.projects) {
    const parentProjectId = project.worktreeParentProjectId;
    if (parentProjectId.length === 0) continue;
    const inherited = result.get(parentProjectId);
    if (inherited !== undefined) result.set(project.projectId, inherited);
  }
  return result;
}

/**
 * The summary the drawer renders for one Space. Chat projects and their
 * sessions are never filtered: they are the Quick section, which is not part of
 * the Projects list a Space scopes. Collections are left verbatim because
 * `buildDrawerItems` already drops a collection whose member projects are gone.
 *
 * Returns the input unchanged when the machine has no Spaces at all — Other
 * alone would then be every project, and the row is hidden.
 */
export function filterSummaryForSpace(
  summary: GhostexMobileSummary,
  selectedSpaceId: string,
): GhostexMobileSummary {
  const spaces = orderedSpaces(summary.sidebarSpaces);
  if (spaces.length === 0) return summary;
  const selectedSpace =
    selectedSpaceId === OTHER_SIDEBAR_SPACE_ID
      ? null
      : (summary.sidebarSpaces.spaces[selectedSpaceId] ?? null);
  const collectionByProjectId = collectionIdByProjectId(summary);

  const keepProject = (projectId: string, worktreeParentProjectId: string): boolean => {
    const membership = {
      collectionId: collectionByProjectId.get(projectId),
      parentProjectId:
        worktreeParentProjectId.length > 0 ? worktreeParentProjectId : undefined,
      projectId,
    };
    return selectedSpace === null
      ? isUnassignedSidebarSpaceProject({ ...membership, spaces })
      : isSidebarSpaceProject({ ...membership, space: selectedSpace });
  };

  const knownProjectIds = new Set(summary.projects.map((project) => project.projectId));
  const projects = summary.projects.filter(
    (project) =>
      project.isChat === true || keepProject(project.projectId, project.worktreeParentProjectId),
  );
  const keptProjectIds = new Set(projects.map((project) => project.projectId));
  /*
   * A session whose project the inventory does not list cannot be resolved to a
   * collection or a parent, so no Space claims it and Other is the only view
   * left that can show it — the same call the desktop row predicate makes for
   * an unresolvable project id.
   */
  const sessions = summary.sessions.filter((session) =>
    knownProjectIds.has(session.projectId)
      ? keptProjectIds.has(session.projectId)
      : selectedSpace === null,
  );

  if (projects.length === summary.projects.length && sessions.length === summary.sessions.length) {
    return summary;
  }
  return { ...summary, projects, sessions };
}

/**
 * The machine's own Spaces as row items, in order. The built-in Other button is
 * appended by the row component, which owns its reserved id, label, and glyph.
 */
export function spaceRowItems(spaces: GhostexSidebarSpaces): SpaceRowItem[] {
  return orderedSpaces(spaces).map((space) => ({
    spaceId: space.spaceId,
    name: space.name,
    icon: space.icon,
    color: space.color,
  }));
}

/**
 * The counts each Space button's status dots draw: the sessions that Space
 * shows, counted by the desktop header rule (packages/gx-core/src/sidebar_view/
 * assemble.rs, the Space rows), for every Space plus Other.
 */
export function spaceSessionCounts(
  summary: GhostexMobileSummary | null,
  spaceIds: readonly string[],
): Record<string, SessionCounts> {
  const counts: Record<string, SessionCounts> = {};
  if (summary === null) return counts;
  for (const spaceId of [...spaceIds, OTHER_SIDEBAR_SPACE_ID]) {
    counts[spaceId] = countSessions(filterSummaryForSpace(summary, spaceId).sessions);
  }
  return counts;
}
