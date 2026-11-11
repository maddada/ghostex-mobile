/**
 * The Live Activity's content state, built from the mobile summaries the app already polls, never from the
 * notification feed. A row carries its leading name, the agent's artwork, the project, the state, when that state
 * began and the session's identifiers; no prompt or reply text. The leading name is the agent's, or the session's
 * name where Settings › Live Activity › "Show session names" is on and the session has one (`leadingName`).
 *
 * Which host data a row needs: `startedAt` of a working row is the top-level `workingStartedAt`, which means only the
 * current run; of a waiting row `attention.enteredAt`; of a finished row `attention.workingStartedAt`, when the stint
 * that ended began, so the row shows how long the agent worked (`attention.enteredAt` − `attention.workingStartedAt`,
 * as the design), while the 2-minute window runs from `attention.enteredAt`. Finished vs waiting is
 * `attention.kind` (`finished` or `needsInput`). A waiting row says "has a question" when the session has an open
 * question card (`awaitingAnswer`, read only from a computer whose summary announces it in `capabilities`) or a
 * counted pending question (`pendingQuestionCount`). The Live Activity runs only when every computer with agents
 * sends these start times and `attention.kind`; `computersNeedingUpdate` names the ones that do not. A waiting agent
 * without `attention.enteredAt` is counted but gets no row: no row without its time. Likewise a finished agent
 * without `attention.workingStartedAt`, which a current computer leaves out when the attention came from idle (also
 * after an acknowledgement): no row, since its duration is unknown, but its computer is current.
 *
 * The computer drops `attention` once a finished session is acknowledged on any device, so the app remembers every
 * finished event it has seen (`FinishedMemory`) and keeps it a row candidate for its 2 minutes. The memory lives
 * only as long as the app runs: after a restart, a finish acknowledged in the meantime is not shown.
 *
 * Kept free of React Native so the rules are testable under `bun test`.
 */

import type {
  GhostexAgentLauncher,
  GhostexMobileSummary,
  GhostexSession,
  GhostexSummaryCapabilities,
} from '../contract/mobileSummary';
import {
  agentIconTint,
  hasQuestion,
  resolveAgentArtId,
  sessionAgentName,
  type AgentArtId,
} from '../contract/mobileSummary';

export type LiveActivityAgentState = 'working' | 'waiting' | 'finished';

export type LiveActivityTarget = { machineId: string; sessionId: string };

export type LiveActivityRow = {
  target: LiveActivityTarget;
  /**
   * The name the row leads with (`leadingName`): the agent's, or the session's where session names are shown.
   *
   * CDXC:Notifications 2026-11-10 WHY: The session's name travels in this key instead of one of its own. The widget extension draws `agentName` as a row's leading text and tells the agent by `agentIcon`, and it is native code: a new key would be drawn only by a new app build, while this key reaches the apps already installed with an over-the-air update.
   */
  agentName: string;
  /** Artwork identity resolved exactly as the session row, including an explicit icon and the cloud artwork. */
  agentIcon: AgentArtId;
  /** RGB tint from the app's registry, packed as 0xRRGGBB for the native view. */
  agentTint: number;
  project: string;
  state: LiveActivityAgentState;
  /** Working: since the stint began; waiting: since the agent waits; finished: when its last stint began. */
  startedAt: string;
  finishedAt?: string;
  expiresAt?: string;
  /** Only on waiting rows with a pending question. */
  hasQuestion?: true;
  /**
   * The computer the session runs on, by its name, only while the content shows more than one computer. A
   * computer that pushes the banner while the phone is locked fills it the same way (gxserver's
   * server/src/live_activity/content.rs), so the open app and the pushed banner agree; a build that does not draw
   * it ignores it.
   */
  computer?: string;
};

export type LiveActivityContentState = {
  /** The data time (`dataTimeOf`): when the oldest summary with an agent to show was read from its computer. */
  updatedAt: string;
  counts: { working: number; waiting: number };
  agents: LiveActivityRow[];
  moreCount: number;
};

/** One computer's summary as the inventory store holds it. */
export type ActivitySource = {
  machineId: string;
  summary: GhostexMobileSummary;
  /** When the summary was read (epoch ms). */
  loadedAt: number;
};

/** Four rows plus "+N more". */
export const MAX_ACTIVITY_ROWS = 4;
/** A finished agent stays a row candidate this long. */
export const FINISHED_ROW_MS = 120_000;
/** `agentName`, the session's name and `project` are cut to this many characters. */
export const MAX_NAME_CHARACTERS = 64;

/** The pattern for `target.machineId` and `target.sessionId`: printable ASCII, 1 to 64 characters. */
const TARGET_ID = /^[\x21-\x7e]{1,64}$/;

const STATE_RANK: Record<LiveActivityAgentState, number> = { waiting: 0, working: 1, finished: 2 };

/**
 * A row under its agent's name, the time it sorts by (working, waiting: its start; finished: when it finished) and
 * the session's name as the Sessions list shows it ('' for a session without one).
 */
export type Shown = { row: LiveActivityRow; sortTime: number; sessionName: string };

/**
 * A working, waiting or recently finished agent; `shown` is null when it cannot have a row (see buildContentState).
 * A finished one carries when it finished (epoch ms), from which its 2 minutes run. The widgets classify the
 * sessions the same way (`widgetSnapshot.ts`), so both surfaces show the same agents.
 */
export type Candidate =
  | { state: 'working' | 'waiting'; shown: Shown | null }
  | { state: 'finished'; shown: Shown | null; finishedAt: number };

/** A finished event the app has seen: its computer and its candidate, with the names, start and finish seen then. */
type RememberedFinish = { machineId: string; candidate: Extract<Candidate, { state: 'finished' }> };

/**
 * The finished events the app has seen, one per computer and session. Each stays a row candidate until 2 minutes
 * after its finish, also once the computer no longer sends its `attention` (it drops it when the finish is
 * acknowledged on any device); it goes earlier when the session works again or enters a new attention. Held in
 * memory only: an app restart forgets it.
 */
export type FinishedMemory = Map<string, RememberedFinish>;

/** Cuts by code points, so a four-byte character is never split into half a surrogate pair. */
function truncateName(value: string): string {
  const characters = Array.from(value);
  return characters.length <= MAX_NAME_CHARACTERS ? value : characters.slice(0, MAX_NAME_CHARACTERS).join('');
}

/** Epoch ms of an ISO time from the host, or null when it is missing or unreadable. */
function hostTime(value: string): number | null {
  if (value.length === 0) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function isoTime(time: number): string {
  return new Date(time).toISOString();
}

/**
 * A session's agent name as the Sessions list shows it ("Claude"), from the summary's launchers (`agents`); '' for a
 * plain terminal, which is not an agent and never a row.
 */
function agentNameOf(session: GhostexSession, agents: readonly GhostexAgentLauncher[] = []): string {
  return truncateName(sessionAgentName(session, agents));
}

/**
 * The computers that do not send the start times and the attention kind yet: a working agent without
 * `workingStartedAt`, or an agent in attention without `attention.kind`. A finished agent without
 * `attention.workingStartedAt` does not count: a current computer leaves it out when the attention came from idle. A
 * summary without working or attention agents proves nothing and is not listed. While any computer is listed, no Live
 * Activity runs.
 */
export function computersNeedingUpdate(sources: readonly ActivitySource[]): string[] {
  return sources
    .filter((source) =>
      source.summary.sessions.some(
        (session) =>
          agentNameOf(session).length > 0 &&
          ((session.activity === 'working' && session.workingStartedAt.length === 0) ||
            (session.activity === 'attention' && session.attentionKind.length === 0)),
      ),
    )
    .map((source) => source.machineId);
}

export function candidateFor(
  machineId: string,
  session: GhostexSession,
  capabilities: GhostexSummaryCapabilities,
  now: number,
  agents: readonly GhostexAgentLauncher[] = [],
): Candidate | null {
  const agentName = agentNameOf(session, agents);
  // A row names its agent (never empty); a session without one is a plain terminal, not an agent.
  if (agentName.length === 0) return null;
  const attention = session.activity === 'attention';
  // An open question card counts only from a computer that announces the field; the counted questions always.
  const question = hasQuestion(session.pendingQuestionCount, capabilities.awaitingAnswer && session.awaitingAnswer);
  const waitsOnUser = session.awaitingApproval || question;
  const agentIcon = resolveAgentArtId(
    session.agentIcon,
    session.agentName.length > 0 ? session.agentName : session.agent,
  );
  const base = {
    target: { machineId, sessionId: session.sessionId },
    agentName,
    agentIcon,
    agentTint: Number.parseInt(agentIconTint(agentIcon).slice(1), 16),
    project: truncateName(session.projectName),
  };
  // The Sessions list's title of the row (`displayTitle`), without its "Ghostex Session" stand-in for an empty one.
  const sessionName = truncateName(session.displayTitle);
  const routable = TARGET_ID.test(machineId) && TARGET_ID.test(session.sessionId);

  if (attention && session.attentionKind === 'finished' && !waitsOnUser) {
    const finishedAt = hostTime(session.attentionEnteredAt);
    // Only agents that finished less than 2 minutes ago are candidates.
    if (finishedAt === null || now - finishedAt >= FINISHED_ROW_MS) return null;
    const workStart = hostTime(session.attentionWorkingStartedAt);
    if (!routable || workStart === null || workStart > finishedAt)
      return { state: 'finished', shown: null, finishedAt };
    const row: LiveActivityRow = {
      ...base,
      state: 'finished',
      startedAt: isoTime(workStart),
      finishedAt: isoTime(finishedAt),
      expiresAt: isoTime(finishedAt + FINISHED_ROW_MS),
    };
    return { state: 'finished', shown: { row, sortTime: finishedAt, sessionName }, finishedAt };
  }

  if (attention || session.awaitingApproval) {
    const since = hostTime(session.attentionEnteredAt);
    if (!routable || since === null) return { state: 'waiting', shown: null };
    const row: LiveActivityRow = { ...base, state: 'waiting', startedAt: isoTime(since) };
    if (question) row.hasQuestion = true;
    return { state: 'waiting', shown: { row, sortTime: since, sessionName } };
  }

  if (session.activity === 'working') {
    const since = hostTime(session.workingStartedAt);
    if (!routable || since === null) return { state: 'working', shown: null };
    return {
      state: 'working',
      shown: { row: { ...base, state: 'working', startedAt: isoTime(since) }, sortTime: since, sessionName },
    };
  }

  return null;
}

/**
 * Display priority waiting > working > finished; inside a class the oldest start first (finished: the newest
 * finish first); ties by session id, then machine id.
 */
export function compareShown(a: Shown, b: Shown): number {
  const rank = STATE_RANK[a.row.state] - STATE_RANK[b.row.state];
  if (rank !== 0) return rank;
  if (a.sortTime !== b.sortTime) {
    return a.row.state === 'finished' ? b.sortTime - a.sortTime : a.sortTime - b.sortTime;
  }
  if (a.row.target.sessionId !== b.row.target.sessionId)
    return a.row.target.sessionId < b.row.target.sessionId ? -1 : 1;
  if (a.row.target.machineId === b.row.target.machineId) return 0;
  return a.row.target.machineId < b.row.target.machineId ? -1 : 1;
}

/**
 * The name a row leads with: the session's name where session names are shown and the session has one, else its
 * agent's name, as before the names. The Live Activity's rows and the widgets' agents both take it from here.
 */
export function leadingName(shown: Shown, showSessionNames: boolean): string {
  return showSessionNames && shown.sessionName.length > 0 ? shown.sessionName : shown.row.agentName;
}

/**
 * The data time of what the activity or the widgets show (epoch ms): when the oldest summary that has an agent to
 * show was read; with no agent to show anywhere, when the newest summary was read; `now` only when none was read.
 * `readAt` holds each computer's read time, `shown` the computers with an agent to show.
 *
 * CDXC:Notifications 2026-11-11 FIX: User: "why does it always say Not current? pls fix both". The data time was
 * the oldest read of every enabled computer, and a computer that does not answer (asleep, off, out of reach) keeps
 * its last read time, so one such computer made the Live Activity "Not current" for good, also with Ghostex open and
 * every other computer read 5 s ago. A computer with nothing to show adds no row, so its age says nothing about
 * what is on screen; one that shows an agent still makes the content as old as its read, which is the truth.
 */
export function dataTimeOf(readAt: ReadonlyMap<string, number>, shown: ReadonlySet<string>, now: number): number {
  let oldestShown: number | null = null;
  let newest: number | null = null;
  for (const [machineId, time] of readAt) {
    newest = newest === null ? time : Math.max(newest, time);
    if (shown.has(machineId)) oldestShown = oldestShown === null ? time : Math.min(oldestShown, time);
  }
  return oldestShown ?? newest ?? now;
}

/**
 * The content state at `now` (epoch ms) for every working and waiting agent plus every agent that finished
 * less than 2 minutes ago, over all given computers. `counts` hold every working and waiting agent (finished
 * excluded); `moreCount` the candidates without a row, including a candidate whose identifiers cannot be
 * routed (outside the id pattern) or whose start the summary does not give, which is counted but
 * never given a row. The finished agents come from `memory`, which this call updates with what the summaries
 * show; without one, only the finishes the summaries still show count. `showSessionNames` is the Settings switch
 * (`liveActivitySessionNames`): off, every row leads with its agent's name.
 */
export function buildContentState(
  sources: readonly ActivitySource[],
  now: number,
  memory: FinishedMemory = new Map(),
  showSessionNames = false,
  computerName: (machineId: string) => string = () => '',
): LiveActivityContentState {
  const candidates: Candidate[] = [];
  const counts = { working: 0, waiting: 0 };
  /** When each computer's summary was read. */
  const machinesRead = new Map<string, number>();
  /** The computers with an agent to show (a working, waiting or recently finished candidate). */
  const machinesShown = new Set<string>();
  for (const source of sources) {
    machinesRead.set(source.machineId, source.loadedAt);
    for (const session of source.summary.sessions) {
      const candidate = candidateFor(
        source.machineId,
        session,
        source.summary.capabilities,
        now,
        source.summary.agents,
      );
      const key = `${source.machineId}\n${session.sessionId}`;
      if (candidate?.state === 'finished') {
        memory.set(key, { machineId: source.machineId, candidate });
        continue;
      }
      // Working, waiting or in another attention: a finish remembered for this session is over.
      if (candidate !== null || session.activity === 'attention') memory.delete(key);
      if (candidate === null) continue;
      if (candidate.state === 'working') counts.working += 1;
      if (candidate.state === 'waiting') counts.waiting += 1;
      candidates.push(candidate);
      machinesShown.add(source.machineId);
    }
  }
  for (const [key, { machineId, candidate }] of memory) {
    if (now - candidate.finishedAt >= FINISHED_ROW_MS) memory.delete(key);
    else if (machinesRead.has(machineId)) {
      candidates.push(candidate);
      machinesShown.add(machineId);
    }
  }
  const agents = candidates
    .flatMap((candidate) => (candidate.shown === null ? [] : [candidate.shown]))
    .sort(compareShown)
    .slice(0, MAX_ACTIVITY_ROWS)
    .map((shown): LiveActivityRow => {
      const row: LiveActivityRow = { ...shown.row, agentName: leadingName(shown, showSessionNames) };
      const name = machinesShown.size > 1 ? truncateName(computerName(shown.row.target.machineId)) : '';
      if (name.length > 0) row.computer = name;
      return row;
    });
  return {
    updatedAt: new Date(dataTimeOf(machinesRead, machinesShown, now)).toISOString(),
    counts,
    agents,
    moreCount: candidates.length - agents.length,
  };
}

/**
 * One key per working agent over all given computers: its computer, its session and the start of its current
 * stint (`workingStartedAt`). A key that was not there before is a working stint that began:
 * an agent that starts working, also the same session starting its next turn between two refreshes (a new
 * `workingStartedAt`), and also an agent without a row (behind four rows, in `moreCount`). Not part of the
 * content state: the activity never shows it.
 */
export function workingStints(sources: readonly ActivitySource[], now: number): string[] {
  const stints: string[] = [];
  for (const source of sources) {
    for (const session of source.summary.sessions) {
      if (
        candidateFor(source.machineId, session, source.summary.capabilities, now, source.summary.agents)?.state !==
        'working'
      )
        continue;
      stints.push(`${source.machineId}\n${session.sessionId}\n${session.workingStartedAt}`);
    }
  }
  return stints;
}
