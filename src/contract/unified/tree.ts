/**
 * A coordinator's threads under its Unified card: which sessions nest under which, in what order,
 * which of them an unfolded card lists, and what a folded card says about the ones it hides.
 *
 * A port of packages/gx-core/src/unified_sidebar/tree.rs, rule for rule (CDXC:Sidebar 2026-11-09
 * DECISION there: the maintainer's "Let's nest the threads under the coordinator's card, folded by
 * default for everyone, with the crew count as the fold toggle. No setting needed."), held to it by
 * `unifiedFixture.json`. A thread on another computer is linked by its coordinator's
 * `coordinatorRemoteThreads`, by the `globalRef` its own computer lists it under; a computer whose
 * gxserver predates the field links same-computer threads only.
 */

import type { CoordinatorBadge, FoldedStatus } from '../coordinatorTree';
import type { UnifiedFilter, UnifiedRow, UnifiedSessionInput, UnifiedSettings } from './build';

/** How long after its last activity a thread that neither works nor waits is still listed. */
const RECENT_THREAD_MS = 2 * 60 * 60 * 1000;

/** Threads are drawn no deeper than the Project sidebar's tree (gx-core `MAX_DEPTH`, coordinatorTree.ts). */
const MAX_DRAWN_DEPTH = 3;

/** What the user unfolded and listed, by `unifiedCoordinatorKey`. */
export type UnifiedFolds = {
  unfolded: readonly string[];
  olderShown: readonly string[];
  /** The row a reveal is bringing on screen (its `sidebarSessionId`): listed like a busy thread, never saved. */
  reveal?: string;
};

export const NO_UNIFIED_FOLDS: UnifiedFolds = { unfolded: [], olderShown: [] };

/** What a row with threads under it draws and says (gx-core `UnifiedCrew`). */
export type UnifiedCrew = {
  key: string;
  /** The threads are drawn now: unfolded, or a search or filter shows a match inside. */
  open: boolean;
  /** The user unfolded it (what its toggle flips). */
  unfolded: boolean;
  /** Its direct threads: the toggle's "Show N threads". */
  total: number;
  /** Its direct threads an unfold lists without the older-threads row. */
  listed: number;
  older: number;
  olderShown: boolean;
  /** A search or filter keeps its matching threads drawn whatever the fold says, so folding it only drops the saved preference. */
  heldOpen: boolean;
  /** Its "N older threads" / "Hide older threads" row is drawn after its threads. */
  olderRow: boolean;
  badge: CoordinatorBadge;
  /** While it is not open: the dots of every session under it, with its own. */
  foldedStatus: FoldedStatus;
  /** The focused session is under it and not drawn. */
  containsActive: boolean;
};

/** One line under a card. */
export type UnifiedTreeLine<S> =
  | { kind: 'thread'; row: UnifiedRow<S>; depth: number }
  | { kind: 'older'; coordinator: UnifiedRow<S>; depth: number };

/** The name a coordinator's fold and older-threads state are saved under: computer, project and session. */
export function unifiedCoordinatorKey(machineKey: string, projectId: string, sessionId: string): string {
  return `${machineKey}|${projectId}|${sessionId}`;
}

function isBusy(session: UnifiedSessionInput): boolean {
  return session.threadState === 'working' || session.threadState === 'waiting' || session.activity === 'working';
}

function isRecent(session: UnifiedSessionInput, nowMs: number): boolean {
  return isBusy(session) || (session.lastInteractionMs !== null && session.lastInteractionMs + RECENT_THREAD_MS > nowMs);
}

/** A session that needs the user: approval, stuck, a question, waiting on them, or failed. */
export function needsYou(session: UnifiedSessionInput): boolean {
  return (
    session.awaitingApproval ||
    session.stuck === true ||
    session.hasQuestion ||
    session.threadState === 'waiting' ||
    session.modelSelectionFailed ||
    session.programStatusFailed
  );
}

function busyRank(session: UnifiedSessionInput): number {
  if (needsYou(session)) return 0;
  if (session.threadState === 'working' || session.activity === 'working') return 1;
  return 2;
}

function addFolded(status: FoldedStatus, session: UnifiedSessionInput): void {
  if (session.awaitingApproval || session.stuck === true || session.modelSelectionFailed || session.programStatusFailed) {
    status.approval = true;
    return;
  }
  status.working ||= session.activity === 'working';
  const waiting = session.activity === 'attention' && session.threadState === 'waiting';
  status.question ||= session.hasQuestion || waiting;
  status.attention ||= !session.hasQuestion && session.activity === 'attention' && !waiting;
  status.backgroundWork ||=
    session.hasBackgroundWork &&
    session.activity !== 'working' &&
    session.activity !== 'attention' &&
    !session.awaitingApproval;
}

/** gx-core `RowNesting::coordinator_badge`. */
function badgeOf(tally: { total: number; waiting: number; working: number; approval: number }): CoordinatorBadge {
  if (tally.approval > 0) return { count: tally.approval, tone: 'approval' };
  if (tally.waiting > 0) return { count: tally.waiting, tone: 'waiting' };
  if (tally.working > 0) return { count: tally.working, tone: 'working' };
  return { count: tally.total, tone: 'idle' };
}

function byText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

type Subtree = { matched: boolean; listed: boolean; rank: number };

/** One row of the build, before nesting: its key, its coordinator's key, and the filter's word on it. */
export type NestInput<S> = {
  row: UnifiedRow<S>;
  key: string;
  parent: string | null;
  matched: boolean;
};

/**
 * Puts each worker under its coordinator; returns the top-level rows, each holding its tree, with
 * every row's fold, match and crew filled in. `rows[i].parent` is null for a detached row (parked
 * while parking is on, or snoozed).
 */
export function nestUnifiedRows<S>(
  rows: NestInput<S>[],
  folds: UnifiedFolds,
  filter: UnifiedFilter,
  settings: UnifiedSettings,
  nowMs: number,
): UnifiedRow<S>[] {
  const indexOf = new Map<string, number>();
  rows.forEach((entry, index) => indexOf.set(entry.key, index));
  const parentOf: Array<number | null> = rows.map((entry, index) => {
    const session = entry.row.session;
    const detached =
      (settings.parking && session.isParked) || (session.snoozedUntilMs !== null && session.snoozedUntilMs > nowMs);
    if (detached || entry.parent === null) return null;
    const parent = indexOf.get(entry.parent);
    return parent === undefined || parent === index ? null : parent;
  });
  const reachesTop = (start: number): boolean => {
    let at = start;
    for (let step = 0; step <= parentOf.length; step += 1) {
      const parent = parentOf[at];
      if (parent === null || parent === undefined) return true;
      at = parent;
    }
    return false;
  };
  // Decided on the links as they are, so every row of a loop stays a card.
  const looped = parentOf.map((parent, index) => parent !== null && !reachesTop(index));
  looped.forEach((loop, index) => {
    if (loop) parentOf[index] = null;
  });
  const children = new Map<number, number[]>();
  parentOf.forEach((parent, index) => {
    if (parent === null) return;
    const list = children.get(parent) ?? [];
    list.push(index);
    children.set(parent, list);
  });
  const matchedOf = new Map<UnifiedRow<S>, boolean>();
  const keyOf = new Map<UnifiedRow<S>, string>();
  const assemble = (index: number): UnifiedRow<S> => {
    const entry = rows[index]!;
    const row: UnifiedRow<S> = { ...entry.row, threads: (children.get(index) ?? []).map(assemble) };
    matchedOf.set(row, entry.matched);
    keyOf.set(row, entry.key);
    return row;
  };
  const tops: UnifiedRow<S>[] = [];
  parentOf.forEach((parent, index) => {
    if (parent === null) tops.push(assemble(index));
  });
  const narrowing = (filter.query ?? '').trim().length > 0;
  const gather = (row: UnifiedRow<S>): Subtree => {
    row.matched = matchedOf.get(row) ?? false;
    const session = row.session;
    const facts: Subtree = {
      matched: row.matched,
      listed:
        isRecent(session, nowMs) ||
        needsYou(session) ||
        session.isFocused === true ||
        session.isVisible === true ||
        folds.reveal === row.sidebarSessionId,
      rank: busyRank(session),
    };
    const ranked = row.threads.map((child) => ({ facts: gather(child), child }));
    ranked.sort(
      (left, right) =>
        left.facts.rank - right.facts.rank ||
        right.child.cameBackMs - left.child.cameBackMs ||
        byText(left.child.sidebarSessionId, right.child.sidebarSessionId),
    );
    for (const { facts: childFacts } of ranked) {
      facts.matched ||= childFacts.matched;
      facts.listed ||= childFacts.listed;
      facts.rank = Math.min(facts.rank, childFacts.rank);
    }
    row.threads = ranked.map(({ facts: childFacts, child }) => {
      child.shown = childFacts.listed;
      child.subtreeMatched = childFacts.matched;
      return child;
    });
    return facts;
  };
  const approvalsBelow = (row: UnifiedRow<S>): number =>
    row.threads.reduce((sum, child) => sum + (child.session.awaitingApproval ? 1 : 0) + approvalsBelow(child), 0);
  const layOut = (row: UnifiedRow<S>, narrowingHere: boolean, subtreeMatched: boolean): void => {
    const query = narrowing;
    row.subtreeMatched = subtreeMatched;
    if (row.threads.length === 0) {
      row.crew = null;
      return;
    }
    const key = keyOf.get(row) ?? '';
    const unfolded = folds.unfolded.includes(key);
    const olderShown = folds.olderShown.includes(key);
    const narrowed = narrowingHere && !row.matched;
    const listed = row.threads.filter((child) => child.shown).length;
    const total = row.threads.length;
    const matchBelow = row.threads.some((child) => child.subtreeMatched);
    // A text search opens a folded row whose threads match, even one it matched itself; a filter pick that keeps
    // the row itself leaves its fold alone (gx-core tree.rs `lay_out`).
    const forced = !narrowed && query && !unfolded && matchBelow;
    const open = narrowed ? matchBelow : unfolded || forced;
    const tally = { total: 0, waiting: 0, working: 0, approval: 0 };
    for (const child of row.threads) {
      tally.total += 1;
      if (child.session.threadState === 'waiting') tally.waiting += 1;
      if (child.session.threadState === 'working') tally.working += 1;
      const listedChild = child.shown;
      child.shown = narrowed || forced
        ? child.subtreeMatched
        : listedChild || olderShown || (narrowingHere && child.subtreeMatched);
    }
    tally.approval = approvalsBelow(row);
    const foldedStatus: FoldedStatus = {
      working: false,
      attention: false,
      backgroundWork: false,
      question: false,
      approval: false,
    };
    if (!open) {
      const stack: UnifiedRow<S>[] = [row];
      for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
        addFolded(foldedStatus, next.session);
        stack.push(...next.threads);
      }
    }
    row.crew = {
      key,
      open,
      unfolded,
      total,
      listed,
      older: total - listed,
      olderShown,
      heldOpen: matchBelow && (narrowed || query),
      olderRow: open && !narrowed && !forced && total > listed,
      badge: badgeOf(tally),
      foldedStatus,
      containsActive: false,
    };
    for (const child of row.threads) layOut(child, narrowingHere, child.subtreeMatched);
  };
  const markActive = (row: UnifiedRow<S>, hidden: boolean): boolean => {
    const open = row.crew?.open === true;
    let pending = hidden && row.session.isFocused === true;
    for (const child of row.threads) {
      const childHidden = hidden || !open || !child.shown;
      pending = markActive(child, childHidden) || pending;
    }
    if (pending && !hidden) {
      if (row.crew !== null) row.crew.containsActive = true;
      return false;
    }
    return pending;
  };
  for (const top of tops) {
    const facts = gather(top);
    const narrowed = narrowing || !top.matched;
    layOut(top, narrowed, facts.matched);
    markActive(top, false);
    lift(top);
  }
  return tops;
}

/** A card with a thread that needs you leaves Moving and sorts by when that thread came back. */
function lift<S>(top: UnifiedRow<S>): void {
  let newest: number | null = null;
  const stack = [...top.threads];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    if (needsYou(next.session)) newest = Math.max(newest ?? next.cameBackMs, next.cameBackMs);
    stack.push(...next.threads);
  }
  if (newest === null) return;
  top.cameBackMs = Math.max(top.cameBackMs, newest);
  if (top.shelf === 'working') top.shelf = 'active';
}

/** The lines drawn under a card now, in order (gx-core `UnifiedRow::drawn_lines`). */
export function drawnLines<S>(card: UnifiedRow<S>): UnifiedTreeLine<S>[] {
  const lines: UnifiedTreeLine<S>[] = [];
  const into = (row: UnifiedRow<S>, depth: number) => {
    if (row.crew === null || !row.crew.open) return;
    for (const child of row.threads) {
      if (!child.shown) continue;
      lines.push({ kind: 'thread', row: child, depth: Math.min(depth, MAX_DRAWN_DEPTH) });
      into(child, depth + 1);
    }
    if (row.crew.olderRow) lines.push({ kind: 'older', coordinator: row, depth: Math.min(depth, MAX_DRAWN_DEPTH) });
  };
  into(card, 1);
  return lines;
}

/** The row and every row under it, depth first. */
export function rowsInTree<S>(row: UnifiedRow<S>): UnifiedRow<S>[] {
  return [row, ...row.threads.flatMap((child) => rowsInTree(child))];
}

/** When a nested thread stops being recent or a snoozed worker wakes, so the list is built again then. */
export function treeDeadlineMs<S>(tops: readonly UnifiedRow<S>[], nowMs: number): number | null {
  let next: number | null = null;
  const keep = (at: number | null) => {
    if (at !== null && at > nowMs) next = next === null ? at : Math.min(next, at);
  };
  const visit = (row: UnifiedRow<S>, nested: boolean) => {
    const session = row.session;
    if (nested && !isBusy(session) && session.lastInteractionMs !== null) keep(session.lastInteractionMs + RECENT_THREAD_MS);
    if ((session.coordinatorSessionId ?? '') !== '') keep(session.snoozedUntilMs);
    for (const child of row.threads) visit(child, true);
  };
  for (const top of tops) visit(top, false);
  return next;
}

/** The coordinators above the session `rowId` in `top`'s tree, outermost first, when it is in it. */
export function ancestorsOf<S>(top: UnifiedRow<S>, rowId: string): string[] | null {
  if (top.id === rowId) return [];
  if (top.crew === null) return null;
  for (const child of top.threads) {
    const chain = ancestorsOf(child, rowId);
    if (chain !== null) return [top.crew.key, ...chain];
  }
  return null;
}
