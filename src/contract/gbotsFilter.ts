/**
 * Which projects and sessions of a computer belong to its GBots (server/src/gbots/): a GBot's folder is a project
 * marked `gbotsProject`, and its chats are that project's sessions. None of them is one of the user's projects, so the
 * projects list, the Spaces, the Unified list and every project picker leave them out; Main Hub draws them as its GBots
 * section instead (contract/gbots.ts).
 *
 * CDXC:GBots 2026-11-09 WHY: `gbotsProject` comes whether GBots are on or off (server/src/gbots/presentation.rs), so a
 * GBot's folder never turns into a plain project when they are switched off: nothing of a bot shows then. A separate
 * module from contract/gbots.ts so contract/grouping.ts can use it without an import cycle.
 * CDXC:Autopilot 2026-11-18 DECISION: User (Q88, "All three, over the air"): the phone leaves Autopilot's own project (its
 * supervisor's folder, `autopilotSupervisorProject`) out of its lists the way the desktop starts it hidden; the phone has no
 * per-project hiding, so it takes the same exits as a GBot's folder. The supervisor opens from Settings > Autopilot.
 * SEE-ALSO: packages/gx-core/src/sidebar_view/projects.rs (the desktop's same rule).
 */

import type { GhostexMobileSummary, GhostexProject, GhostexRecentProject, GhostexSession } from './mobileSummary';

/** A GBot's folder (on or off), never one of the user's projects. */
export function isGbotProject(project: Pick<GhostexProject, 'gbotsProject' | 'gbotsBot'>): boolean {
  return project.gbotsProject === true || project.gbotsBot !== undefined;
}

/** A GBot's folder or Autopilot's own project: no list or picker of the user's projects shows either. */
export function isHiddenProject(
  project: Pick<GhostexProject, 'gbotsProject' | 'gbotsBot' | 'autopilotSupervisorProject'>,
): boolean {
  return isGbotProject(project) || project.autopilotSupervisorProject === true;
}

/** The project ids of the computer's GBots' folders and of Autopilot's project (see `isHiddenProject`). */
export function gbotProjectIds(summary: Pick<GhostexMobileSummary, 'projects'>): Set<string> {
  return new Set(summary.projects.filter(isHiddenProject).map((project) => project.projectId));
}

/** Whether `session` is a GBot's chat (its project is a bot's folder, or the computer marks it). */
export function isGbotSession(
  session: Pick<GhostexSession, 'projectId' | 'gbotsChat'>,
  botProjects: Set<string>,
): boolean {
  return session.gbotsChat !== undefined || botProjects.has(session.projectId);
}

/** The summary as the user's own projects see it: no GBot folder and no GBot chat. */
export function withoutGbots<T extends Pick<GhostexMobileSummary, 'projects' | 'sessions'>>(summary: T): T {
  const botProjects = gbotProjectIds(summary);
  const hasChat = summary.sessions.some((session) => session.gbotsChat !== undefined);
  if (botProjects.size === 0 && !hasChat) return summary;
  return {
    ...summary,
    projects: summary.projects.filter((project) => !botProjects.has(project.projectId)),
    sessions: summary.sessions.filter((session) => !isGbotSession(session, botProjects)),
  };
}

/** The computer's recent projects without GBot folders (the Recent projects menu). */
export function recentProjectsWithoutGbots(
  summary: Pick<GhostexMobileSummary, 'projects' | 'recentProjects'> | null | undefined,
): GhostexRecentProject[] {
  if (summary === null || summary === undefined) return [];
  const botProjects = gbotProjectIds(summary);
  return summary.recentProjects.filter((project) => !botProjects.has(project.projectId));
}
