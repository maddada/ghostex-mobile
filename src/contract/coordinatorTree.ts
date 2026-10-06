/**
 * Coordinator trees in the sessions drawer: each thread drawn right under its coordinator,
 * indented, the crew badge on the coordinator row, and which threads wait behind its "N older
 * threads" row.
 *
 * The phone's mirror of the desktop sidebar's rules in gx-core
 * (packages/gx-core/src/sidebar_view/threads.rs `nest_threads` and `tally_threads`, and
 * `RowNesting::coordinator_badge` in view.rs). The phone cannot link gx-core and builds its drawer
 * order in grouping.ts, so the nesting runs here, after that order; keep the two in step.
 * The fields come from gxserver (server/src/coordinators/presentation.rs) through the mobile summary.
 *
 * An expanded coordinator lists its threads that are working, waiting, or were active in the last
 * two hours; the older ones, resolved threads included, wait behind one "N older threads" row at the
 * end of its children (the user's 2026-10-06 decision in gx-core threads.rs: "Don't actually 'hide'
 * them please").
 */

import type { GhostexSession } from './mobileSummary';

/** Deeper trees are drawn flat past this, as on the desktop. */
const MAX_THREAD_DEPTH = 3;

/** How long after its last activity a thread that neither works nor waits is still listed. */
const RECENT_THREAD_MS = 2 * 60 * 60 * 1000;

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
  /**
   * On a thread row: a coordinator above it is folded, or the row waits behind its coordinator's
   * "N older threads" row, so it is not drawn.
   */
  folded: boolean;
  /** On a coordinator row: its older threads, which its "N older threads" row lists. */
  olderThreads: number;
  /** On a coordinator row: the user listed its older threads. */
  olderShown: boolean;
};

export type CoordinatorBadgeTone = 'idle' | 'working' | 'waiting';

/**
 * The coordinator row's badge: the crew icon and one number: the threads working, else the threads
 * waiting on the user, else the threads it lists by default (working, waiting or active in the last
 * two hours). The tint follows the number: orange for the working count, light blue for the waiting
 * count, neutral otherwise (gx-core `coordinator_badge`, the user's 2026-10-04 decision there).
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

/** A parked thread stays in Parked; every other thread, resolved ones included, joins the tree. */
function isNestableThread(session: GhostexSession): boolean {
  return parentKey(session) !== null && !isBrowser(session) && session.isParked !== true;
}

function isBusyThread(session: GhostexSession): boolean {
  return (
    session.coordinatorThreadState === 'working' ||
    session.coordinatorThreadState === 'waiting' ||
    session.activity === 'working'
  );
}

/** A thread an expanded coordinator lists without its "N older threads" row. */
function isRecentThread(session: GhostexSession, nowMs: number): boolean {
  if (isBusyThread(session)) return true;
  const activeAt = Date.parse(session.lastActiveAt);
  return Number.isFinite(activeAt) && activeAt + RECENT_THREAD_MS > nowMs;
}

/** Every coordinator's badge, from all of the machine's sessions (a worktree thread sits in another project). */
export function coordinatorBadges(
  sessions: readonly GhostexSession[],
  nowMs: number = Date.now(),
): Map<string, CoordinatorBadge> {
  const seen = new Set<string>();
  const tallies = new Map<string, { total: number; waiting: number; working: number }>();
  for (const session of sessions) {
    const parent = parentKey(session);
    if (parent === null || isBrowser(session)) continue;
    const key = coordinatorRowKey(session);
    if (seen.has(key)) continue;
    seen.add(key);
    const tally = tallies.get(parent) ?? { total: 0, waiting: 0, working: 0 };
    if (isRecentThread(session, nowMs)) tally.total += 1;
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
  /** The rows in display order: each thread right after its coordinator (folded ones included). */
  sessions: GhostexSession[];
  /** The section each row is drawn under, by coordinatorRowKey: a thread takes its coordinator's. */
  sections: Map<string, S>;
  /** Rows that sit in a tree, by coordinatorRowKey; a row absent here is an ordinary top-level row. */
  nesting: Map<string, RowNesting>;
};

/**
 * Reorders one list's rows (already in display order) so each thread follows its coordinator, its
 * recent threads before its older ones. A pinned coordinator takes its threads to Pinned, a parked
 * one to Parked. The threads of a folded coordinator, and the older threads of one not in
 * `olderShown`, stay in the list, marked folded, so the section headings above still count them.
 */
export function nestCoordinatorThreads<S>(
  sessions: readonly GhostexSession[],
  collapsedCoordinators: ReadonlySet<string>,
  sectionOf: (session: GhostexSession) => S,
  olderShown: ReadonlySet<string> = new Set<string>(),
  nowMs: number = Date.now(),
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

  const isOlder = sessions.map((session) => !isRecentThread(session, nowMs));
  for (const [parent, list] of children) {
    children.set(parent, [...list.filter((child) => !isOlder[child]), ...list.filter((child) => isOlder[child])]);
  }
  const isCollapsed = sessions.map((_, index) => children.has(index) && collapsedCoordinators.has(keys[index]));
  const result: NestedSessions<S> = { sessions: [], sections: new Map(), nesting: new Map() };
  const emit = (index: number, depth: number, last: boolean, section: S, folded: boolean): void => {
    const list = children.get(index) ?? [];
    const showsOlder = olderShown.has(keys[index]);
    const hidden = (child: number): boolean => !showsOlder && isOlder[child];
    const drawn = list.filter((child) => !hidden(child)).length;
    result.sessions.push(sessions[index]);
    result.sections.set(keys[index], section);
    if (depth > 0 || list.length > 0) {
      result.nesting.set(keys[index], {
        depth,
        lastChild: depth > 0 && last,
        threadCount: list.length,
        collapsed: isCollapsed[index],
        folded,
        olderThreads: list.filter((child) => isOlder[child]).length,
        olderShown: showsOlder,
      });
    }
    list.forEach((child, position) =>
      emit(
        child,
        Math.min(depth + 1, MAX_THREAD_DEPTH),
        position + 1 === drawn,
        section,
        folded || isCollapsed[index] || hidden(child),
      ),
    );
  };
  for (let index = 0; index < sessions.length; index += 1) {
    if (parentOf[index] === null) emit(index, 0, false, baseSections[index], false);
  }
  return result;
}
