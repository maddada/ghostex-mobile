/**
 * Which sessions just arrived in Drafts, so the list opens Drafts for them.
 *
 * CDXC:Drafts 2026-11-02 SEE-ALSO:
 * packages/gx-core/src/sidebar_view/draft_arrivals.rs owns the rule (a draft the previous list lacked, created in the last two minutes and after the first list was seen; the first list after launch is only recorded) and the user's decision; keep this mirror aligned.
 */

import {
  groupCollapseKey,
  groupsForProject,
  projectKeyForSession,
  sessionKindCollapseKey,
  sessionKindSection,
} from './grouping';
import type { GhostexMobileSummary, GhostexSession } from './mobileSummary';

export const DRAFT_ARRIVAL_WINDOW_MS = 2 * 60 * 1_000;
/** How much older than the first list a draft may be and still count (computer and phone clocks differ). */
export const DRAFT_CLOCK_SLACK_MS = 5_000;

export type DraftRow = {
  id: string;
  /** Where the row's Drafts heading is kept open: the Project list's `<projectKey>|drafts`, or empty for the Unified shelf. */
  collapseKey: string;
  createdMs: number | null;
};

export class DraftArrivals {
  private known: Set<string> | null = null;
  private startedMs = 0;

  /** Reads the drafts of the list as it stands now and returns those that just arrived. */
  observe(drafts: readonly DraftRow[], nowMs: number): DraftRow[] {
    const previous = this.known;
    this.known = new Set(drafts.map((draft) => draft.id));
    if (previous === null) {
      this.startedMs = nowMs;
      return [];
    }
    return drafts.filter(
      (draft) =>
        !previous.has(draft.id) &&
        draft.createdMs !== null &&
        draft.createdMs + DRAFT_ARRIVAL_WINDOW_MS > nowMs &&
        draft.createdMs + DRAFT_CLOCK_SLACK_MS >= this.startedMs,
    );
  }

  /** Forgets the list, so the next one is only recorded. */
  reset(): void {
    this.known = null;
  }
}

/** How long an arrival waits for the phone to open it before it stops counting (gx-core `DRAFT_FOCUS_WAIT_MS`). */
export const OPENED_ARRIVAL_WAIT_MS = 15_000;

/**
 * Every new row, whatever its heading, waiting for the phone to open it: the one it opens is revealed.
 *
 * CDXC:Sidebar 2026-11-14 SEE-ALSO:
 * packages/gx-core/src/sidebar_view/draft_arrivals.rs holds the user's decision ("i had sessions area in the sidebar collapsed and i clicked on new terminal it created the terminal but didn't expand the sessions section please fix") and the desktop's half; this mirrors it: a new session this phone opens opens its collection, project, session group and heading, and nothing else.
 */
export class OpenedArrivals {
  private readonly arrivals = new DraftArrivals();
  private readonly awaiting = new Map<string, number>();

  /** Reads every row of the list as it stands now. */
  observe(rows: readonly DraftRow[], nowMs: number): void {
    for (const [id, deadline] of this.awaiting) if (deadline <= nowMs) this.awaiting.delete(id);
    for (const arrival of this.arrivals.observe(rows, nowMs)) this.awaiting.set(arrival.id, nowMs + OPENED_ARRIVAL_WAIT_MS);
  }

  /** Whether `id` is the open session and a new row still waiting; each arrival is answered once. */
  takeOpened(id: string | null, nowMs: number): boolean {
    if (id === null) return false;
    const deadline = this.awaiting.get(id);
    if (deadline === undefined) return false;
    this.awaiting.delete(id);
    return deadline > nowMs;
  }

  reset(): void {
    this.arrivals.reset();
    this.awaiting.clear();
  }
}

/** What has to be open in the Project list for a session's row to show. */
export type SessionRevealPlan = {
  projectKey: string;
  /** The saved collection holding the project; the home project sits outside every collection. */
  collectionId: string | null;
  /** The named session group holding the session (`groupCollapseKey`). */
  groupCollapseKey: string | null;
  /** The heading it falls under (`sessionKindCollapseKey`). */
  kindCollapseKey: string;
};

export function sessionRevealPlan(
  summary: GhostexMobileSummary,
  session: GhostexSession,
  nowMs: number,
): SessionRevealPlan {
  const projectKey = projectKeyForSession(session);
  const project = summary.projects.find((candidate) => candidate.projectId === session.projectId);
  const collection =
    project === undefined || project.isHome === true
      ? undefined
      : summary.projectCollections.find((candidate) => candidate.projectIds.includes(session.projectId));
  const group = groupsForProject(summary, session.projectId).find((candidate) =>
    candidate.sessionIds.includes(session.sessionId),
  );
  return {
    projectKey,
    collectionId: collection?.collectionId ?? null,
    groupCollapseKey: group === undefined ? null : groupCollapseKey(projectKey, group.groupId),
    kindCollapseKey: sessionKindCollapseKey(projectKey, sessionKindSection(session, nowMs)),
  };
}
