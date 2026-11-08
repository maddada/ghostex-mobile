/**
 * The attention list's model: what needs the user now, one row per session by its live state, not the history of
 * events (the computer's own bell keeps that list). Sections:
 *
 * - Needs you: every session the computer's session list shows waiting for the user (`waitsForUser`: an approval, a
 *   question, a wait that is no finished turn), the one waiting longest first across computers. Its source is the
 *   session list, not the feed: a wait needs no feed row to show, and a `needsInput` row of a session that no longer
 *   waits shows nowhere.
 * - Failed: a session with an unread `failed` or `sendFailed` row (`stateOf`), newest first. Opening it leaves those
 *   rows unread (`readOnOpen`); it stays until the computer reads them (a send that went through, a failure dealt
 *   with), the user marks it done, or someone reads them on the computer.
 * - Done: a session with an unread `finished` row, newest first; it stays until those rows are read (opened, Clear
 *   Done, or read on the computer), with no time limit.
 * - Accounts: the account rows (banked usage resets), read or not, newest first, last.
 *
 * A session shows once: Needs you before Failed before Done, so a failure shows once its wait is answered.
 * Feed rows of other kinds (`bell`, `custom`) are no state and show nowhere here.
 *
 * A Done or Failed session reads "Ended" only when its computer says it is closed: it is in that computer's
 * closed-session list (`MachineFeed.closed`). Absence from the session list alone proves nothing, since that list also
 * leaves out live sessions of inactive projects; it only makes the session a candidate (`endedCandidates`) whose
 * closed list is worth reading. A computer that cannot be reached, or whose session list was not read yet, has none.
 *
 * Rows join the session list for agent, project and title. A row reads as the desktop bell's card (CDXC:Notifications
 * 2026-11-08 in feedContract.ts): the session's title, the feed row's message as its body (a wait the feed holds no
 * row for says what it waits on), and "project · state" in the desktop's words as its footer. Kept free of React
 * Native so it is testable under `bun test`.
 */

import { NotificationsCopy } from '../copy';
import {
  hasQuestion,
  isCustomAgentId,
  resolveAgentIconId,
  type AgentIconId,
  type GhostexMobileSummary,
  type GhostexSession,
  type GhostexSummaryCapabilities,
} from '../contract/mobileSummary';
import { longestWaitFirst, waitsForUser } from '../screens/triage/model';
import type { ClosedSession } from '../sessions/sessionSearch';
import { sessionFacts, type SessionFacts } from './events';
import { isAccountRow, type FeedRow } from './feedContract';

export type InboxSection = 'needsYou' | 'failed' | 'done' | 'accounts';

export type ListKind =
  | 'approval'
  | 'question'
  | 'waiting'
  | 'finished'
  | 'failed'
  | 'sendFailed'
  | 'resetExpiring'
  | 'resetRedeemed';

export type AttentionRow = {
  /** Unique across computers. */
  key: string;
  /** The session's id; for an account row its feed row's id. */
  id: string;
  machineId: string;
  sessionId: string;
  projectId: string;
  section: InboxSection;
  kind: ListKind;
  /** The state in words ("Waiting for approval", "finished · not opened", "Ended", ...), for the row's spoken label. */
  label: string;
  /** The card's title: the session's title ("Session" without one); for an account row the computer's notice. */
  title: string;
  /** The card's body: the feed row's message, or what a wait waits on; '' when there is none. */
  body: string;
  /** The card's footer: "project · state" in the desktop bell's words ("Ghostex · Needs input"). */
  footer: string;
  /** "agent · project"; for an account row the account. */
  who: string;
  /** The session's title; for an account row the computer's one-line notice. */
  detail: string;
  agentIconId: AgentIconId;
  /** ISO time the row shows: when the wait began, or the newest feed row behind the state. */
  at: string;
  /** An account row that was read; a session row is never "read" (its state is what shows). */
  read: boolean;
  account: boolean;
  /** The computer lists the session as closed: its row reads "Ended" and offers Restore (if it can) and Remove. */
  ended: ClosedSession | null;
  /** Its computer cannot be reached now: the row is its last known state. */
  lastKnown: boolean;
  /** The unread feed rows opening the row marks read on the computer (`readOnOpen`). */
  unreadIds: readonly string[];
  /** The unread feed rows that hold the session under Done or Failed: Clear Done and Mark as Done mark them read. */
  stateIds: readonly string[];
  /** The computer's name, only while more than one computer feeds the list. */
  machineLabel: string | null;
};

export type MachineFeed = {
  machineId: string;
  machineLabel: string;
  rows: readonly FeedRow[];
  /** The computer's session list as the phone last read it; null before its first read. */
  summary: GhostexMobileSummary | null;
  /** The computer cannot be reached now (its feed or its session list did not answer the last read). */
  offline: boolean;
  /** The sessions the computer lists as closed, as last read for this list. */
  closed: readonly ClosedSession[];
};

export type AttentionInbox = {
  needsYou: AttentionRow[];
  failed: AttentionRow[];
  done: AttentionRow[];
  accounts: AttentionRow[];
};

/** The key a row and its "removed from this list" mark share. */
export function sessionKey(machineId: string, sessionId: string): string {
  return `${machineId}\n${sessionId}`;
}

/**
 * Whether a computer cannot be reached now: its feed or its session list did not answer the last read. Its rows and
 * waits are then its last known state.
 */
export function cannotReach(feedStatus: string | undefined, inventoryError: string | null | undefined): boolean {
  return feedStatus === 'unreachable' || (inventoryError ?? null) !== null;
}

/**
 * One computer's part of the list from what the phone holds: its feed (rows kept through a failed read), its session
 * list and its closed list. It counts as offline while it cannot be reached (`cannotReach`).
 */
export function machineFeed(
  machine: { id: string; label: string },
  feed: { status: string; rows: readonly FeedRow[] } | undefined,
  inventory: { summary: GhostexMobileSummary | null; lastError: string | null } | undefined,
  closed: readonly ClosedSession[],
): MachineFeed {
  return {
    machineId: machine.id,
    machineLabel: machine.label,
    rows: feed?.rows ?? [],
    summary: inventory?.summary ?? null,
    offline: cannotReach(feed?.status, inventory?.lastError),
    closed,
  };
}

/**
 * Which rows opening a session marks read on the computer: every unread row of it, as the shared read state has it,
 * except its failure rows (`failed`, `sendFailed`). Opening fixes no failure, so those stay unread, here and in the
 * computer's bell, and keep the session under Failed until the computer reads them or the user marks it done.
 */
export function readOnOpen(unread: readonly FeedRow[]): string[] {
  return unread.filter((row) => row.kind !== 'failed' && row.kind !== 'sendFailed').map((row) => row.id);
}

/**
 * When a session that does not wait is under Failed or Done, and the unread rows that hold it there: a failure first
 * (its unread `failed` or `sendFailed` rows, until they are read), else a finished turn (its unread `finished` rows).
 * `unread` is newest first, so `newest` is the row the section shows.
 */
export function stateOf(
  unread: readonly FeedRow[],
): { section: 'failed' | 'done'; rows: FeedRow[]; newest: FeedRow } | null {
  const failures = unread.filter((row) => row.kind === 'failed' || row.kind === 'sendFailed');
  const rows = failures.length > 0 ? failures : unread.filter((row) => row.kind === 'finished');
  const newest = rows[0];
  if (newest === undefined) return null;
  return { section: failures.length > 0 ? 'failed' : 'done', rows, newest };
}

/** A waiting session's state: an approval before a question before a plain wait. */
function waitKind(session: GhostexSession, capabilities: GhostexSummaryCapabilities): ListKind {
  if (session.awaitingApproval) return 'approval';
  return hasQuestion(session.pendingQuestionCount, capabilities.awaitingAnswer && session.awaitingAnswer)
    ? 'question'
    : 'waiting';
}

/** Each session's unread feed rows, newest first; account rows are no session's. */
function unreadBySession(rows: readonly FeedRow[]): Map<string, FeedRow[]> {
  const sessions = new Map<string, FeedRow[]>();
  for (const row of rows) {
    if (row.read || isAccountRow(row)) continue;
    const list = sessions.get(row.sessionId);
    if (list === undefined) sessions.set(row.sessionId, [row]);
    else list.push(row);
  }
  for (const list of sessions.values()) list.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  return sessions;
}

function waitingIds(feed: MachineFeed): Set<string> {
  const summary = feed.summary;
  if (summary === null) return new Set();
  return new Set(
    summary.sessions
      .filter((session) => waitsForUser(session, summary.capabilities))
      .map((session) => session.sessionId),
  );
}

/** Whether the computer's session list can tell that a session is gone: read, and the computer answers now. */
export function listsCurrently(feed: MachineFeed): feed is MachineFeed & { summary: GhostexMobileSummary } {
  return !feed.offline && feed.summary !== null;
}

/**
 * The Done and Failed sessions the computer's session list does not hold: only its closed-session list can say
 * whether they ended. None for a computer that cannot be reached or whose session list was not read yet.
 */
export function endedCandidates(feed: MachineFeed): string[] {
  if (!listsCurrently(feed)) return [];
  const listed = new Set(feed.summary.sessions.map((session) => session.sessionId));
  const candidates: string[] = [];
  for (const [sessionId, unread] of unreadBySession(feed.rows)) {
    if (!listed.has(sessionId) && stateOf(unread) !== null) candidates.push(sessionId);
  }
  return candidates;
}

/** The rows of a session that `readOnOpen` marks read, as the feed holds them now. */
export function unreadRowIds(rows: readonly FeedRow[], sessionId: string): string[] {
  return readOnOpen(unreadBySession(rows).get(sessionId) ?? []);
}

/**
 * The bell's number: the sessions under Needs you, across `feeds`. `lastKnown` when at least one of them comes from
 * a computer that cannot be reached now, so the number holds a wait that may be over; a number of current waits only
 * is not marked.
 */
export function needsYouCount(
  feeds: readonly Pick<MachineFeed, 'summary' | 'offline'>[],
): { count: number; lastKnown: boolean } {
  let count = 0;
  let lastKnown = false;
  for (const { summary, offline } of feeds) {
    if (summary === null) continue;
    for (const session of summary.sessions) {
      if (!waitsForUser(session, summary.capabilities)) continue;
      count += 1;
      if (offline) lastKnown = true;
    }
  }
  return { count, lastKnown };
}

function identity(facts: SessionFacts | undefined, row: FeedRow | undefined, state: string) {
  const agent =
    facts !== undefined && facts.agentLabel.length > 0
      ? facts.agentLabel
      : row !== undefined && row.agentName.length > 0 && !isCustomAgentId(row.agentName)
        ? row.agentName
        : NotificationsCopy.unknownAgent;
  const project = facts !== undefined && facts.projectName.length > 0 ? facts.projectName : (row?.subtitle ?? '');
  const detail = facts !== undefined && facts.title.length > 0 ? facts.title : (row?.title ?? '');
  return {
    who: project.length > 0 ? `${agent} · ${project}` : agent,
    detail,
    title: detail.length > 0 ? detail : NotificationsCopy.untitledSession,
    footer: project.length > 0 ? `${project} · ${state}` : state,
    agentIconId: facts?.agentIconId ?? resolveAgentIconId(undefined, row?.agentName),
  };
}

/**
 * A waiting session's card body: the message of its newest unread `needsInput` row (the computer's own words, "2
 * questions are waiting for your answers: …", "Waiting for your approval"), else what it waits on.
 */
function waitBody(kind: ListKind, session: GhostexSession, unread: readonly FeedRow[]): string {
  const written = unread.find((row) => row.kind === 'needsInput' && (row.body ?? '').length > 0)?.body;
  if (written !== undefined) return written;
  if (kind === 'approval') return NotificationsCopy.waitBody.approval;
  if (kind === 'question') return NotificationsCopy.waitBody.question(session.pendingQuestionCount);
  return NotificationsCopy.waitBody.waiting;
}

const newestFirst = (a: AttentionRow, b: AttentionRow): number => Date.parse(b.at) - Date.parse(a.at);

/**
 * Every computer's inbox. `removed` holds the sessions the user removed from this phone's list, or whose ended session
 * was restored (`sessionKey`): their Done and Failed rows stay away, also once the closed list no longer holds them
 * (it holds a window, and a read can fail), since the session was proven ended when the mark was made. Null while that
 * record is not loaded: then no Done or Failed row shows, since a stored mark can hide any of them, also one of a
 * computer that cannot be reached or whose session list was not read yet, so a removed one never flashes up.
 */
export function buildAttentionList(
  feeds: readonly MachineFeed[],
  removed: ReadonlySet<string> | null,
): AttentionInbox {
  const many = feeds.length > 1;
  const machineLabel = (feed: MachineFeed): string | null => (many ? feed.machineLabel : null);
  const inbox: AttentionInbox = { needsYou: [], failed: [], done: [], accounts: [] };

  const waits = longestWaitFirst(
    feeds.flatMap((feed) => {
      const summary = feed.summary;
      return summary === null
        ? []
        : summary.sessions.map((session) => ({ feed, session, capabilities: summary.capabilities }));
    }),
  );
  const unreadByFeed = new Map(feeds.map((feed) => [feed, unreadBySession(feed.rows)]));
  for (const { feed, session, capabilities } of waits) {
    const unread = unreadByFeed.get(feed)?.get(session.sessionId) ?? [];
    const kind = waitKind(session, capabilities);
    inbox.needsYou.push({
      key: sessionKey(feed.machineId, session.sessionId),
      id: session.sessionId,
      machineId: feed.machineId,
      sessionId: session.sessionId,
      projectId: session.projectId,
      section: 'needsYou',
      kind,
      label: NotificationsCopy.rowKind[kind],
      ...identity(sessionFacts(feed.summary, session.sessionId), unread[0], NotificationsCopy.rowState.needsInput),
      body: waitBody(kind, session, unread),
      at: session.attentionEnteredAt,
      read: false,
      account: false,
      ended: null,
      lastKnown: feed.offline,
      unreadIds: readOnOpen(unread),
      stateIds: [],
      machineLabel: machineLabel(feed),
    });
  }

  for (const feed of feeds) {
    const waiting = waitingIds(feed);
    const listed = new Set(feed.summary?.sessions.map((session) => session.sessionId) ?? []);
    const closed = new Map(feed.closed.map((session) => [session.sessionId, session]));
    for (const [sessionId, unread] of unreadByFeed.get(feed) ?? []) {
      if (waiting.has(sessionId)) continue;
      const state = stateOf(unread);
      if (state === null) continue;
      const key = sessionKey(feed.machineId, sessionId);
      if (removed === null || removed.has(key)) continue;
      const candidate = listsCurrently(feed) && !listed.has(sessionId);
      const ended = candidate ? (closed.get(sessionId) ?? null) : null;
      const newest = state.newest;
      const kind: ListKind = state.section === 'done' ? 'finished' : newest.kind === 'sendFailed' ? 'sendFailed' : 'failed';
      inbox[state.section].push({
        key,
        id: sessionId,
        machineId: feed.machineId,
        sessionId,
        projectId: newest.projectId,
        section: state.section,
        kind,
        label: ended !== null ? NotificationsCopy.rowKind.ended : NotificationsCopy.rowKind[kind],
        ...identity(
          sessionFacts(feed.summary, sessionId),
          newest,
          ended !== null ? NotificationsCopy.rowState.ended : NotificationsCopy.rowState[kind],
        ),
        body: newest.body ?? '',
        at: newest.createdAt,
        read: false,
        account: false,
        ended,
        lastKnown: feed.offline,
        unreadIds: readOnOpen(unread),
        stateIds: state.rows.map((row) => row.id),
        machineLabel: machineLabel(feed),
      });
    }

    for (const row of feed.rows) {
      if (!isAccountRow(row) || (row.kind !== 'resetExpiring' && row.kind !== 'resetRedeemed')) continue;
      inbox.accounts.push({
        key: `${feed.machineId}\n${row.id}`,
        id: row.id,
        machineId: feed.machineId,
        sessionId: row.sessionId,
        projectId: row.projectId,
        section: 'accounts',
        kind: row.kind,
        label: NotificationsCopy.rowKind[row.kind],
        who: row.subtitle,
        detail: row.title,
        title: row.title,
        body: row.body ?? '',
        footer:
          row.subtitle.length > 0
            ? `${row.subtitle} · ${NotificationsCopy.rowState[row.kind]}`
            : NotificationsCopy.rowState[row.kind],
        agentIconId: resolveAgentIconId(undefined, row.agentName),
        at: row.createdAt,
        read: row.read,
        account: true,
        ended: null,
        lastKnown: feed.offline,
        unreadIds: row.read ? [] : [row.id],
        stateIds: [],
        machineLabel: machineLabel(feed),
      });
    }
  }

  inbox.failed.sort(newestFirst);
  inbox.done.sort(newestFirst);
  inbox.accounts.sort(newestFirst);
  return inbox;
}
