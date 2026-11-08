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
 * end of its children (the user's 2026-10-07 decision in gx-chat-core coordinator_threads.rs: "Don't
 * actually 'hide' them please"). Both change only when the user taps them.
 */

import { hasQuestion, type GhostexSession, type GhostexSummaryCapabilities } from './mobileSummary';

/** Deeper trees are drawn flat past this, as on the desktop. */
const MAX_THREAD_DEPTH = 3;

/** How long after its last activity a thread that neither works nor waits is still listed. */
const RECENT_THREAD_MS = 2 * 60 * 60 * 1000;

/**
 * The `passingLines` a row at `depth` hands to the rows directly under it: the ones that run past the
 * row itself, plus its own level's line while a sibling of it follows (gx-core `passing_lines_below`).
 */
export function passingLinesBelow(passingLines: number, depth: number, last: boolean): number {
  return depth > 0 && !last ? passingLines | (1 << depth) : passingLines;
}

/** Where a row sits in its coordinator's tree. */
export type RowNesting = {
  /** How deep under a coordinator the row is drawn; 0 for a top-level row. */
  depth: number;
  /**
   * The last thread directly under its coordinator, where the tree line ends. Not set on a last
   * thread at the depth limit whose own threads are drawn flat under it: its line runs on to them
   * (gx-core `RowNesting::last_child`).
   */
  lastChild: boolean;
  /**
   * The tree lines that run on past this row: bit `k` is set when the row's ancestor drawn at depth
   * `k` has a sibling drawn further down, so the line of that level goes on beside this row to reach
   * it. Past the depth limit a row is drawn at its parent's depth, so a bit can be the row's own
   * depth (gx-core `RowNesting::passing_lines`).
   */
  passingLines: number;
  /** The `passingLines` this row hands to its threads and to its "N older threads" row (gx-core `RowNesting::passing_lines_below`). */
  passingLinesBelow: number;
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
  /**
   * On a coordinator row: the selected session is one of its threads that a fold hides, so this row
   * carries the active highlight and the hollow ring in the crown's place (gx-core
   * `RowNesting::contains_active_session`, the user's 2026-10-22 decision there).
   */
  containsActive: boolean;
  /**
   * On a coordinator row whose threads are folded: the status dots of the threads the fold hides,
   * with the coordinator's own, drawn as one overlapping stack in the trailing slot (gx-core
   * `RowNesting::folded_status`, the user's 2026-10-24 decision there: "show 2 dots (yellow and
   * blue) in this case (they need to be overlapping dots pls)"). Absent when nothing has a dot.
   */
  foldedStatus?: FoldedStatus;
};

/**
 * Which dots a folded coordinator's stack draws, counted as the machine tabs count them: a row with a question
 * (`hasQuestion`), or a thread waiting on the user, is pink, not blue.
 */
export type FoldedStatus = {
  working: boolean;
  attention: boolean;
  backgroundWork: boolean;
  question: boolean;
  /** A row waiting for approval: the red dot, in place of that row's other dots (gx-core `FoldedStatus::add`). */
  approval: boolean;
};

function addFoldedStatus(
  status: FoldedStatus,
  session: GhostexSession,
  capabilities: GhostexSummaryCapabilities,
): void {
  if (session.awaitingApproval) {
    status.approval = true;
    return;
  }
  const question = hasQuestion(session.pendingQuestionCount, capabilities.awaitingAnswer && session.awaitingAnswer);
  // A thread waiting on the user (gxserver's `waiting`: a permission prompt, a bell) is the pink needs-you dot (the
  // user's choice, gx-core `FoldedStatus::add`); only a finished turn is the stack's blue, so the blue is exactly what
  // opening the orchestrator clears.
  const waiting = session.activity === 'attention' && session.coordinatorThreadState === 'waiting';
  status.working ||= session.activity === 'working';
  status.question ||= question || waiting;
  status.attention ||= !question && session.activity === 'attention' && !waiting;
  status.backgroundWork ||=
    session.backgroundWorkDetectedAt.length > 0 && session.activity !== 'working' && session.activity !== 'attention';
}

export type CoordinatorBadgeTone = 'idle' | 'working' | 'waiting' | 'approval';

/**
 * The coordinator row's badge: the crew icon and one number: the sessions under it (at any depth)
 * waiting for approval, else the threads waiting on the user, else the threads working, else the
 * threads it lists by default (working, waiting or active in the last two hours). The tint follows
 * the number: red for approval, light blue for waiting, orange for working, neutral otherwise
 * (gx-core `coordinator_badge`, the user's 2026-10-27 decision there: "Light blue (waiting), then
 * orange (working)" under the red).
 */
export type CoordinatorBadge = { count: number; tone: CoordinatorBadgeTone };

/** A session's key in the tree, and the key a coordinator's fold is remembered under. */
export function coordinatorRowKey(session: Pick<GhostexSession, 'projectId' | 'sessionId'>): string {
  return JSON.stringify([session.projectId, session.sessionId]);
}

function parentKey(session: GhostexSession): string | null {
  if ((session.coordinatorProjectId ?? '').length === 0 || (session.coordinatorSessionId ?? '').length === 0) return null;
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
  type Tally = { total: number; waiting: number; working: number; approval: number };
  const tallies = new Map<string, Tally>();
  const tallyOf = (key: string): Tally => {
    const tally = tallies.get(key) ?? { total: 0, waiting: 0, working: 0, approval: 0 };
    tallies.set(key, tally);
    return tally;
  };
  const parents = new Map<string, string>();
  const approvals: string[] = [];
  for (const session of sessions) {
    const parent = parentKey(session);
    if (parent === null || isBrowser(session)) continue;
    const key = coordinatorRowKey(session);
    if (seen.has(key)) continue;
    seen.add(key);
    parents.set(key, parent);
    if (session.awaitingApproval) approvals.push(parent);
    const tally = tallyOf(parent);
    if (isRecentThread(session, nowMs)) tally.total += 1;
    if (session.coordinatorThreadState === 'waiting') tally.waiting += 1;
    if (session.coordinatorThreadState === 'working') tally.working += 1;
  }
  // A session waiting for approval counts on every orchestrator above it (gx-core `tally_threads`); the walk stops at
  // a loop or past any real depth.
  for (const parent of approvals) {
    const visited = new Set<string>();
    for (let ancestor: string | undefined = parent; ancestor !== undefined; ancestor = parents.get(ancestor)) {
      if (visited.has(ancestor) || visited.size >= 32) break;
      visited.add(ancestor);
      tallyOf(ancestor).approval += 1;
    }
  }
  const badges = new Map<string, CoordinatorBadge>();
  for (const [key, tally] of tallies) {
    badges.set(
      key,
      tally.approval > 0
        ? { count: tally.approval, tone: 'approval' }
        : tally.waiting > 0
          ? { count: tally.waiting, tone: 'waiting' }
          : tally.working > 0
            ? { count: tally.working, tone: 'working' }
            : { count: tally.total, tone: 'idle' },
    );
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
 * `capabilities` are the computer's, which a folded stack's question dot reads.
 */
export function nestCoordinatorThreads<S>(
  sessions: readonly GhostexSession[],
  capabilities: GhostexSummaryCapabilities,
  collapsedCoordinators: ReadonlySet<string>,
  sectionOf: (session: GhostexSession) => S,
  olderShown: ReadonlySet<string> = new Set<string>(),
  nowMs: number = Date.now(),
  isActive: (session: GhostexSession) => boolean = () => false,
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
  const foldedStatus = (index: number): FoldedStatus | undefined => {
    if (!isCollapsed[index]) return undefined;
    const status: FoldedStatus = {
      working: false,
      attention: false,
      backgroundWork: false,
      question: false,
      approval: false,
    };
    const stack = [index];
    for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
      addFoldedStatus(status, sessions[next], capabilities);
      stack.push(...(children.get(next) ?? []));
    }
    return status.working || status.attention || status.backgroundWork || status.question || status.approval
      ? status
      : undefined;
  };
  const result: NestedSessions<S> = { sessions: [], sections: new Map(), nesting: new Map() };
  const foldedOf = sessions.map(() => false);
  const emit = (
    index: number,
    depth: number,
    last: boolean,
    passingLines: number,
    section: S,
    folded: boolean,
  ): void => {
    const list = children.get(index) ?? [];
    const showsOlder = olderShown.has(keys[index]);
    const hidden = (child: number): boolean => !showsOlder && isOlder[child];
    const drawn = list.filter((child) => !hidden(child)).length;
    const below = passingLinesBelow(passingLines, depth, last);
    foldedOf[index] = folded;
    result.sessions.push(sessions[index]);
    result.sections.set(keys[index], section);
    if (depth > 0 || list.length > 0) {
      result.nesting.set(keys[index], {
        depth,
        // Past the depth limit the row's threads are drawn at its own level, so the line it would end runs on to
        // them; the line the threads take is still the one handed down in `below`.
        lastChild: depth > 0 && last && !(depth === MAX_THREAD_DEPTH && !isCollapsed[index] && drawn > 0),
        passingLines,
        passingLinesBelow: below,
        threadCount: list.length,
        collapsed: isCollapsed[index],
        folded,
        olderThreads: list.filter((child) => isOlder[child]).length,
        olderShown: showsOlder,
        containsActive: false,
        foldedStatus: foldedStatus(index),
      });
    }
    list.forEach((child, position) =>
      emit(
        child,
        Math.min(depth + 1, MAX_THREAD_DEPTH),
        position + 1 === drawn,
        below,
        section,
        folded || isCollapsed[index] || hidden(child),
      ),
    );
  };
  for (let index = 0; index < sessions.length; index += 1) {
    if (parentOf[index] === null) emit(index, 0, false, 0, baseSections[index], false);
  }
  // The drawn row that stands for the selected thread when a folded coordinator hides it: its nearest drawn ancestor.
  const focused = sessions.findIndex(isActive);
  if (focused !== -1 && foldedOf[focused]) {
    let ancestor = parentOf[focused];
    while (ancestor !== null && foldedOf[ancestor]) ancestor = parentOf[ancestor];
    const holder = ancestor === null ? undefined : result.nesting.get(keys[ancestor]);
    if (holder !== undefined) holder.containsActive = true;
  }
  return result;
}
