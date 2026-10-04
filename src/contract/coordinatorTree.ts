/**
 * Coordinator trees in the sessions drawer: each open thread drawn right under its coordinator,
 * indented, and the crew badge on the coordinator row.
 *
 * The phone's mirror of the desktop sidebar's rules in gx-core
 * (packages/gx-core/src/sidebar_view/threads.rs `nest_threads` and `tally_threads`, and
 * `RowNesting::coordinator_badge` in view.rs). The phone cannot link gx-core and builds its drawer
 * order in grouping.ts, so the nesting runs here, after that order; keep the two in step.
 * The fields come from gxserver (server/src/coordinators/presentation.rs) through the mobile summary.
 */

import type { GhostexSession } from './mobileSummary';

/** Deeper trees are drawn flat past this, as on the desktop. */
const MAX_THREAD_DEPTH = 3;

/** Where a row sits in its coordinator's tree. */
export type RowNesting = {
  /** How deep under a coordinator the row is drawn; 0 for a top-level row. */
  depth: number;
  /** The last thread directly under its coordinator, where the tree line ends. */
  lastChild: boolean;
  /** On a coordinator row: the open threads drawn under it (the fold chevron shows when > 0). */
  threadCount: number;
  /** On a coordinator row with threads under it: the user folded them away. */
  collapsed: boolean;
  /** On a thread row: a coordinator above it is folded, so the row is not drawn. */
  folded: boolean;
};

export type CoordinatorBadgeTone = 'idle' | 'working' | 'waiting';

/**
 * The coordinator row's badge: the crew icon and one number: the threads working, else the threads
 * waiting on the user, else every thread session of the coordinator still in the list. The tint
 * follows the number: orange for the working count, light blue for the waiting count, neutral for
 * the total (gx-core `coordinator_badge`, the user's 2026-10-04 decision there).
 */
export type CoordinatorBadge = { count: number; tone: CoordinatorBadgeTone };

/** A session's key in the tree, and the key a coordinator's fold is remembered under. */
export function coordinatorRowKey(session: Pick<GhostexSession, 'projectId' | 'sessionId'>): string {
  return JSON.stringify([session.projectId, session.sessionId]);
}

function parentKey(session: GhostexSession): string | null {
  if (session.coordinatorProjectId.length === 0 || session.coordinatorSessionId.length === 0) return null;
  return JSON.stringify([session.coordinatorProjectId, session.coordinatorSessionId]);
}

function isBrowser(session: GhostexSession): boolean {
  return session.kind === 'browser' || session.surface === 'browser';
}

/** A done thread leaves the tree, and a parked one stays in Parked. */
function isNestableThread(session: GhostexSession): boolean {
  return (
    parentKey(session) !== null &&
    !isBrowser(session) &&
    session.coordinatorThreadState !== 'done' &&
    session.isParked !== true
  );
}

/** Every coordinator's badge, from all of the machine's sessions (a worktree thread sits in another project). */
export function coordinatorBadges(sessions: readonly GhostexSession[]): Map<string, CoordinatorBadge> {
  const seen = new Set<string>();
  const tallies = new Map<string, { total: number; waiting: number; working: number }>();
  for (const session of sessions) {
    const parent = parentKey(session);
    if (parent === null || isBrowser(session)) continue;
    const key = coordinatorRowKey(session);
    if (seen.has(key)) continue;
    seen.add(key);
    const tally = tallies.get(parent) ?? { total: 0, waiting: 0, working: 0 };
    tally.total += 1;
    if (session.coordinatorThreadState === 'waiting') tally.waiting += 1;
    if (session.coordinatorThreadState === 'working') tally.working += 1;
    tallies.set(parent, tally);
  }
  const badges = new Map<string, CoordinatorBadge>();
  for (const [key, tally] of tallies) {
    badges.set(key, {
      count: tally.working > 0 ? tally.working : tally.waiting > 0 ? tally.waiting : tally.total,
      tone: tally.working > 0 ? 'working' : tally.waiting > 0 ? 'waiting' : 'idle',
    });
  }
  return badges;
}

export type NestedSessions<S> = {
  /** The rows in display order: each open thread right after its coordinator (folded ones included). */
  sessions: GhostexSession[];
  /** The section each row is drawn under, by coordinatorRowKey: a thread takes its coordinator's. */
  sections: Map<string, S>;
  /** Rows that sit in a tree, by coordinatorRowKey; a row absent here is an ordinary top-level row. */
  nesting: Map<string, RowNesting>;
};

/**
 * Reorders one list's rows (already in display order) so each open thread follows its coordinator.
 * A pinned coordinator takes its threads to Pinned, a parked one to Parked. The threads of a folded
 * coordinator stay in the list, marked folded, so the section headings above still count them.
 */
export function nestCoordinatorThreads<S>(
  sessions: readonly GhostexSession[],
  collapsedCoordinators: ReadonlySet<string>,
  sectionOf: (session: GhostexSession) => S,
): NestedSessions<S> {
  const keys = sessions.map(coordinatorRowKey);
  const baseSections = sessions.map(sectionOf);
  const flat = (): NestedSessions<S> => ({
    sessions: [...sessions],
    sections: new Map(keys.map((key, index) => [key, baseSections[index]])),
    nesting: new Map(),
  });
  const coordinators = new Map<string, number>();
  sessions.forEach((session, index) => {
    if (session.isCoordinator) coordinators.set(keys[index], index);
  });
  if (coordinators.size === 0) return flat();

  const children = new Map<number, number[]>();
  const parentOf: (number | null)[] = sessions.map(() => null);
  sessions.forEach((session, index) => {
    if (!isNestableThread(session)) return;
    const parent = coordinators.get(parentKey(session) ?? '');
    if (parent === undefined || parent === index) return;
    children.set(parent, [...(children.get(parent) ?? []), index]);
    parentOf[index] = parent;
  });
  if (children.size === 0) return flat();

  // A cycle (two coordinators that are each other's thread) never reaches a root; such rows stay top-level.
  const reachesRoot = (start: number): boolean => {
    let index = start;
    for (let step = 0; step <= parentOf.length; step += 1) {
      const parent = parentOf[index];
      if (parent === null) return true;
      index = parent;
    }
    return false;
  };
  for (let index = 0; index < sessions.length; index += 1) {
    if (parentOf[index] !== null && !reachesRoot(index)) parentOf[index] = null;
  }
  for (const [parent, list] of children) {
    const kept = list.filter((child) => parentOf[child] !== null);
    if (kept.length === 0) children.delete(parent);
    else children.set(parent, kept);
  }

  const isCollapsed = sessions.map((_, index) => children.has(index) && collapsedCoordinators.has(keys[index]));
  const result: NestedSessions<S> = { sessions: [], sections: new Map(), nesting: new Map() };
  const emit = (index: number, depth: number, last: boolean, section: S, folded: boolean): void => {
    const list = children.get(index) ?? [];
    result.sessions.push(sessions[index]);
    result.sections.set(keys[index], section);
    if (depth > 0 || list.length > 0) {
      result.nesting.set(keys[index], {
        depth,
        lastChild: depth > 0 && last,
        threadCount: list.length,
        collapsed: isCollapsed[index],
        folded,
      });
    }
    list.forEach((child, position) =>
      emit(
        child,
        Math.min(depth + 1, MAX_THREAD_DEPTH),
        position + 1 === list.length,
        section,
        folded || isCollapsed[index],
      ),
    );
  };
  for (let index = 0; index < sessions.length; index += 1) {
    if (parentOf[index] === null) emit(index, 0, false, baseSections[index], false);
  }
  return result;
}
