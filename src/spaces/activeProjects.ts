/**
 * Active projects: the star chip first in the Space row, a view that lists the projects being worked on from every
 * Space of every connected computer in one list, as the desktop's star does.
 *
 * CDXC:Spaces 2026-11-12 SEE-ALSO: the DECISION in packages/gx-core/src/sidebar_view/active_projects.rs, which this
 * mirrors rule for rule: a project is active while one of its sessions works, waits on the user (approval, question,
 * attention) or still runs something in the background, or was used in the last 8 hours, and the project of the
 * session open now always stays; it leaves as soon as neither holds. The list is flat, in the Space row's order and
 * each Space's own project order, with every session of a project. The computer's `sidebarActiveProjects` switch
 * (Settings > Sidebar & Sessions > Spaces, on by default) shows or hides the star; a long press on it turns that
 * switch off on the computer.
 */

import { withoutGbots } from '../contract/gbotsFilter';
import { showsBackgroundWork } from '../contract/grouping';
import { hasQuestion, type GhostexMobileSummary, type GhostexSession } from '../contract/mobileSummary';
import { isSidebarSpaceProject } from './otherSpace';
import { orderedSpaces } from './spaceFilter';

/** The reserved Space id the star picks, the desktop's `ACTIVE_SPACE_ID`. */
export const ACTIVE_SPACE_ID = 'active';
export const ACTIVE_SPACE_LABEL = 'Active projects';
/** The desktop star's glyph and colour (`starFilled`, the menus' star yellow). */
export const ACTIVE_SPACE_ICON = 'starFilled';
export const ACTIVE_SPACE_COLOR = '#e8b931';
/** How long a project stays active after it was last used. */
export const ACTIVE_RECENT_MS = 8 * 60 * 60 * 1000;

/** What the rule reads of a session, from the drawer's sessions and the Unified list's alike. */
export type ActiveRuleSession = {
  activity: string;
  awaitingApproval: boolean;
  hasQuestion: boolean;
  hasBackgroundWork: boolean;
  lastInteractionMs: number | null;
  isBrowser?: boolean;
};

/** Where the list is drawn from: the clock it is read at and the session open now (`<sessionId>`), if any. */
export type ActiveProjectsContext = { nowMs: number; focusedSessionId: string | null };

/** The computer shows the star: Spaces are on there and its `sidebarActiveProjects` is not off. */
export function activeProjectsOn(summary: GhostexMobileSummary | null | undefined): boolean {
  if (summary == null) return false;
  return summary.sidebarActiveProjects !== false && orderedSpaces(summary.sidebarSpaces).length > 0;
}

/** gx-core `row_keeps_active`: whether this session keeps its project in the list at `nowMs`. */
export function sessionKeepsActive(session: ActiveRuleSession, nowMs: number): boolean {
  if (session.isBrowser === true) return false;
  if (
    session.activity === 'working' ||
    session.activity === 'attention' ||
    session.awaitingApproval ||
    session.hasQuestion ||
    session.hasBackgroundWork
  ) {
    return true;
  }
  return session.lastInteractionMs !== null && session.lastInteractionMs + ACTIVE_RECENT_MS > nowMs;
}

function parseMs(iso: string): number | null {
  const trimmed = iso.trim();
  if (trimmed.length === 0) return null;
  const ms = Date.parse(trimmed);
  return Number.isNaN(ms) ? null : ms;
}

/** A drawer session as the rule reads it (the same time the row draws: its last meaningful activity). */
export function activeRuleSession(session: GhostexSession, awaitingAnswer: boolean): ActiveRuleSession {
  return {
    activity: session.activity,
    awaitingApproval: session.awaitingApproval,
    hasQuestion: hasQuestion(session.pendingQuestionCount, awaitingAnswer && session.awaitingAnswer),
    hasBackgroundWork: showsBackgroundWork(session),
    lastInteractionMs: parseMs(session.lastInteractionAt) ?? parseMs(session.lastActiveAt),
  };
}

/**
 * The ids of the projects the list shows: those a session keeps active, and the one holding the session open now.
 * A worktree's activity counts for its parent too, whose card can list the worktree's sessions.
 */
export function activeProjectIds(summary: GhostexMobileSummary, context: ActiveProjectsContext): Set<string> {
  const parentOf = new Map(summary.projects.map((project) => [project.projectId, project.worktreeParentProjectId]));
  const active = new Set<string>();
  for (const session of summary.sessions) {
    const keeps =
      session.sessionId === context.focusedSessionId ||
      sessionKeepsActive(activeRuleSession(session, summary.capabilities.awaitingAnswer), context.nowMs);
    if (!keeps) continue;
    active.add(session.projectId);
    const parent = parentOf.get(session.projectId);
    if (parent !== undefined && parent.length > 0) active.add(parent);
  }
  return active;
}

/**
 * Where a project sorts in Space order (gx-core `space_rank_of_project`): its Space's place in the row, Other after
 * every Space. `spaceNames` ranks by name instead, so another computer's copy of a synced Space sorts with this one's.
 */
export function spaceRankOfProject(
  summary: GhostexMobileSummary,
  projectId: string,
  collectionId: string | undefined,
  parentProjectId: string | undefined,
  spaceNames?: readonly string[],
): number {
  const spaces = orderedSpaces(summary.sidebarSpaces);
  const own = spaces.findIndex((space) => isSidebarSpaceProject({ collectionId, parentProjectId, projectId, space }));
  const order = spaceNames ?? spaces.map((space) => space.name);
  if (own < 0) return order.length;
  const named = order.findIndex((name) => name.trim().toLowerCase() === spaces[own]!.name.trim().toLowerCase());
  return named < 0 ? order.length : named;
}

/**
 * The summary the drawer renders for Active projects: the active projects alone, in Space order, with no collection
 * folding them (the list is flat), and their sessions. GBots belong to no Space, so they are left out.
 */
export function filterSummaryForActiveProjects(
  whole: GhostexMobileSummary,
  context: ActiveProjectsContext,
  collectionOf: (projectId: string) => string | undefined,
  spaceNames?: readonly string[],
): GhostexMobileSummary {
  const summary = withoutGbots(whole);
  const active = activeProjectIds(summary, context);
  const kept = summary.projects.filter((project) => active.has(project.projectId));
  // The list's own project order (the desktop's), then stably by Space.
  const base = [
    ...(summary.workspaceGroups?.projectOrder ?? []).filter((projectId) => active.has(projectId)),
    ...kept.map((project) => project.projectId),
  ].filter((projectId, index, all) => all.indexOf(projectId) === index);
  const projectById = new Map(kept.map((project) => [project.projectId, project]));
  const rank = (projectId: string): number => {
    const project = projectById.get(projectId);
    const parent = project?.worktreeParentProjectId ?? '';
    return spaceRankOfProject(
      summary,
      projectId,
      collectionOf(projectId),
      parent.length > 0 ? parent : undefined,
      spaceNames,
    );
  };
  const order = base
    .map((projectId, index) => ({ projectId, index, rank: rank(projectId) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((entry) => entry.projectId);
  const keptIds = new Set(order);
  return {
    ...summary,
    projects: order.flatMap((projectId) => {
      const project = projectById.get(projectId);
      return project === undefined ? [] : [project];
    }),
    projectCollections: [],
    workspaceGroups:
      summary.workspaceGroups == null ? summary.workspaceGroups : { ...summary.workspaceGroups, projectOrder: order },
    sessions: summary.sessions.filter((session) => keptIds.has(session.projectId)),
  };
}

/**
 * The next time a session's 8 hours run out after `nowMs` (its project may then leave the list), or `null` when none
 * does: a session that works or waits leaves only with a new summary.
 */
export function nextActiveExpiryMs(sessions: readonly GhostexSession[], nowMs: number): number | null {
  let next: number | null = null;
  for (const session of sessions) {
    const at = parseMs(session.lastInteractionAt) ?? parseMs(session.lastActiveAt);
    if (at === null) continue;
    const ends = at + ACTIVE_RECENT_MS;
    if (ends > nowMs && (next === null || ends < next)) next = ends;
  }
  return next;
}
