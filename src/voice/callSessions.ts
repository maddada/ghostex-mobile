/**
 * The sessions of the voice call: gxserver's `sessions` frame (server/src/voice_agent/conversation/sessions_context.rs)
 * and what the voice screen's Sessions sheet shows of it. Pure, so the rules are testable without
 * React Native.
 *
 * CDXC:VoiceMode 2026-11-26 DECISION: User: the phone's voice call screen lists the sessions of
 * the call, and tapping one makes the call about that session (the existing focus, `focusVoiceOn`).
 * The list is gxserver's, because only the computer knows which sessions the call reaches (its own
 * and its connected computers'); a computer that sends no `sessions` frame (an older Ghostex) gets no
 * list, and the screen stays as it was. Sub-threads are not rows: a coordinator's row counts them.
 */

import type { VoiceFocusTarget } from './focus';

/**
 * Whether the voice screen shows the all-sessions line with its Sessions button, and whether the
 * Sessions sheet may be open: in a running call about all sessions whose computer sent a list, and
 * not while a tap's move to one session waits for the computer's answer. A call about one session
 * (or one being started about one) keeps its "Only about …" banner, and a call with a GBot its own;
 * neither lists sessions.
 */
export function showsSessionsStrip(state: {
  active: boolean;
  callSessions: CallSessions | null;
  focus: unknown;
  requestedFocus: unknown;
  pendingFocus: unknown;
}): boolean {
  return (
    state.active &&
    state.callSessions !== null &&
    state.focus === null &&
    state.requestedFocus === null &&
    state.pendingFocus === null
  );
}

/** A session's state as gxserver names it in the frame. */
export type CallSessionState = 'working' | 'waitingOnQuestion' | 'waitingOnApproval' | 'idle' | 'sleeping';

/** One row of the `sessions` frame. */
export type CallSession = {
  ref: string;
  projectId: string;
  sessionId: string;
  title: string;
  project: string;
  agent: string;
  state: CallSessionState;
  /** A call can be about this session (one of the call's own computer). */
  focusable: boolean;
  /** The connected computer it runs on, when that is not the call's. */
  computer: string | null;
  /** Its open sub-threads, when it is a coordinator. */
  subThreads: number | null;
};

/**
 * The frame's list, with how many rows it left out (gxserver sends at most 40) and the connected
 * computers it could not read (their sessions are missing from the list, not closed).
 */
export type CallSessions = { sessions: CallSession[]; more: number; unavailable: string[] };

const STATES: readonly CallSessionState[] = ['working', 'waitingOnQuestion', 'waitingOnApproval', 'idle', 'sleeping'];

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

/** The frame's sessions, leaving out malformed rows; null when the frame has no list. */
export function parseCallSessions(frame: Record<string, unknown>): CallSessions | null {
  if (!Array.isArray(frame.sessions)) return null;
  const sessions: CallSession[] = [];
  for (const entry of frame.sessions) {
    if (typeof entry !== 'object' || entry === null) continue;
    const row = entry as Record<string, unknown>;
    const ref = text(row.ref);
    const projectId = text(row.projectId);
    const sessionId = text(row.sessionId);
    const title = text(row.title);
    const state = STATES.find((known) => known === row.state);
    if (ref === null || projectId === null || sessionId === null || title === null || state === undefined) continue;
    if (projectId.length === 0 || sessionId.length === 0) continue;
    sessions.push({
      ref,
      projectId,
      sessionId,
      title,
      project: text(row.project) ?? '',
      agent: text(row.agent) ?? '',
      state,
      focusable: row.focusable === true,
      computer: text(row.computer),
      subThreads: typeof row.subThreads === 'number' && row.subThreads > 0 ? row.subThreads : null,
    });
  }
  const more = typeof frame.more === 'number' && frame.more > 0 ? Math.floor(frame.more) : 0;
  // Optional: a computer from before it sends none.
  const unavailable = Array.isArray(frame.unavailable)
    ? frame.unavailable.filter((name): name is string => typeof name === 'string' && name.length > 0)
    : [];
  return { sessions, more, unavailable };
}

/** The state in the row's words. */
export function callSessionStateWords(state: CallSessionState): string {
  switch (state) {
    case 'working':
      return 'Working';
    case 'waitingOnQuestion':
      return 'Waiting on a question';
    case 'waitingOnApproval':
      return 'Waiting for approval';
    case 'idle':
      return 'Idle';
    case 'sleeping':
      return 'Sleeping';
  }
}

/** The row's second line: "Ghostex · Working · on Omarchy · 3 threads". */
export function callSessionDetail(session: CallSession): string {
  const parts = [session.project, callSessionStateWords(session.state)].filter((part) => part.length > 0);
  if (session.computer !== null) parts.push(`on ${session.computer}`);
  if (session.subThreads !== null) parts.push(session.subThreads === 1 ? '1 thread' : `${session.subThreads} threads`);
  return parts.join(' · ');
}

/**
 * The strip's summary of the rows it got: "2 waiting · 3 working", or how many sessions there are
 * when none waits or works. A list that is not the whole says so: "40 working · 40 of 41 listed",
 * "1 computer unreachable".
 */
export function callSessionsSummary(list: CallSessions): string {
  const waiting = list.sessions.filter((s) => s.state === 'waitingOnQuestion' || s.state === 'waitingOnApproval').length;
  const working = list.sessions.filter((s) => s.state === 'working').length;
  const shown = list.sessions.length;
  const total = shown + list.more;
  const parts: string[] = [];
  if (waiting > 0) parts.push(`${waiting} waiting`);
  if (working > 0) parts.push(`${working} working`);
  if (list.more > 0) parts.push(parts.length > 0 ? `${shown} of ${total} listed` : `${shown} of ${total} sessions listed`);
  else if (parts.length === 0) parts.push(total === 1 ? '1 session' : `${total} sessions`);
  const unreachable = list.unavailable.length;
  if (unreachable > 0) parts.push(unreachable === 1 ? '1 computer unreachable' : `${unreachable} computers unreachable`);
  return parts.join(' · ');
}

/**
 * Whether tapping the row moves the call to it. A call can be about one session of its own
 * computer only, so a row on a connected computer is drawn dimmed and does nothing.
 *
 * CDXC:VoiceMode 2026-11-26 WHY: a call stays on the computer it started on (the voice agent of
 * that computer reads the other computers' sessions, but a call about one session is that
 * session's computer's call). Showing those rows dimmed keeps the list the whole picture of what
 * the agent sees. To hide them instead, filter them out in `VoiceSessionsSheet`.
 */
export function callSessionCanFocus(session: CallSession): boolean {
  return session.focusable && session.computer === null;
}

/** What a tap on the row asks the call to be about, or null when the row can't be focused. */
export function callSessionFocusTarget(session: CallSession): VoiceFocusTarget | null {
  if (!callSessionCanFocus(session)) return null;
  return { projectId: session.projectId, sessionId: session.sessionId, title: session.title };
}
