/**
 * The scope of a voice call: all sessions, or one session (a "focused" call). The rules here are
 * pure; `conversation.ts` keeps the state and talks to
 * the native socket. The wire is the voice agent contract's "Focused calls" section
 * (docs/2026-10-20/voice-mode/voice-agent-client-contract.md).
 *
 * CDXC:VoiceMode 2026-10-23 DECISION: User, asked "Which way should we build it?", picked "The voice agent you have, limited to one session for the call", and asked "Which sessions can you start a call about?", picked "Any session: a thread, an orchestrator, or a plain session". A call about one session is the same call with a `focus`; the phone offers it on every session it lists.
 * CDXC:VoiceMode 2026-10-23 DECISION: User, asked "Can a call switch between one session and all sessions without hanging up?", picked "Yes, both ways". While a call is open, starting a call about a session on the same computer refocuses it (no second call), and All sessions widens it.
 * CDXC:VoiceMode 2026-10-23 SEE-ALSO: server/src/voice_agent/ (the focus query, `ready.focus`, the `focus` frames) and apps/desktop/src/app/voice_agent/ (the desktop's split headset button and focus strip).
 */

/** The session a focused call is about, as gxserver names it in `ready.focus` and `focus` frames. */
export type VoiceFocus = {
  projectId: string;
  sessionId: string;
  title: string;
  /** The project's name. */
  project: string;
  /** The orchestrator's title when the session is one of its threads, else null. */
  orchestrator: string | null;
  /** The session was closed during the call (the call keeps going). */
  closed: boolean;
  /** Set in a call with a GBot: the GBot it talks as, the session being one of its chats. */
  gbot?: VoiceFocusGbot;
};

/** The GBot of a call with a GBot (`focus.gbot`), what the voice screen's banner draws. */
export type VoiceFocusGbot = { botId: string; name: string; icon: string; colorHex: string };

/**
 * A session the phone asks a call to be about (a menu row knows these before gxserver answers). With
 * `gbot` it is a call with that GBot: about one of its chats, or with empty ids its standing chat
 * with you (gxserver opens it if needed), `title` then being the GBot's name.
 */
export type VoiceFocusTarget = {
  projectId: string;
  sessionId: string;
  title: string;
  gbot?: { botId: string; name: string };
};

/** `<projectId>:<sessionId>`, the `focus` query value and the `focus` frame's `session`. */
export function focusRef(target: { projectId: string; sessionId: string }): string {
  return `${target.projectId}:${target.sessionId}`;
}

/**
 * The `focus` value of a call with a GBot: `gbot:<botId>` for your standing chat with it, or
 * `gbot:<botId>:<projectId>:<sessionId>` for one of its chats (server/src/voice_agent/gbot_call/).
 */
export function gbotFocusRef(botId: string, chat: { projectId: string; sessionId: string } | null): string {
  return chat !== null && chat.projectId.length > 0 && chat.sessionId.length > 0
    ? `gbot:${botId}:${focusRef(chat)}`
    : `gbot:${botId}`;
}

/** The `focus` query value a call about `target` opens with. */
export function focusQuery(target: VoiceFocusTarget): string {
  return target.gbot !== undefined ? gbotFocusRef(target.gbot.botId, target) : focusRef(target);
}

/** The GBot a call is with (the one gxserver named, or the one being called), or null. */
export function callGbotId(focus: VoiceFocus | null, requested: VoiceFocusTarget | null): string | null {
  return focus?.gbot?.botId ?? requested?.gbot?.botId ?? null;
}

function parseFocusGbot(value: unknown): VoiceFocusGbot | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const text = (key: string): string => (typeof record[key] === 'string' ? (record[key] as string) : '');
  const botId = text('botId');
  if (botId.length === 0) return null;
  return { botId, name: text('name') || 'GBot', icon: text('icon'), colorHex: text('colorHex') };
}

/** A focus object from gxserver, or null for all sessions or anything malformed. */
export function parseFocus(value: unknown): VoiceFocus | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  const text = (key: string): string => (typeof record[key] === 'string' ? (record[key] as string) : '');
  const projectId = text('projectId');
  const sessionId = text('sessionId');
  if (projectId.length === 0 || sessionId.length === 0) return null;
  const orchestrator = text('orchestrator');
  const gbot = parseFocusGbot(record.gbot);
  return {
    projectId,
    sessionId,
    title: text('title') || sessionId,
    project: text('project'),
    orchestrator: orchestrator.length > 0 ? orchestrator : null,
    closed: record.closed === true,
    ...(gbot !== null ? { gbot } : {}),
  };
}

/**
 * What a `ready` frame says about the scope: `missing` when it has no `focus` key at all, which is
 * how an older gxserver (one without focused calls) answers.
 */
export type ReadyFocus = { kind: 'missing' } | { kind: 'focus'; focus: VoiceFocus | null };

export function readyFocus(frame: Record<string, unknown>): ReadyFocus {
  if (!Object.prototype.hasOwnProperty.call(frame, 'focus')) return { kind: 'missing' };
  return { kind: 'focus', focus: parseFocus(frame.focus) };
}

/**
 * A call that asked for a focus and got a `ready` without the `focus` key is talking to an older
 * gxserver: the phone hangs up and says to update Ghostex on that computer.
 */
export function readyFromOlderServer(askedForFocus: boolean, frame: Record<string, unknown>): boolean {
  return askedForFocus && readyFocus(frame).kind === 'missing';
}

/** The line for a computer whose Ghostex has no focused calls (the same words on every client). */
export function outdatedFocusMessage(computer: string): string {
  return `Update Ghostex on ${computer} to have a voice call about one session.`;
}

/** The line for a computer whose Ghostex can't call a GBot. */
export function outdatedGbotCallMessage(computer: string): string {
  return `Update Ghostex on ${computer} to call a GBot.`;
}

/** The two sessions are the same one. */
export function sameSession(
  a: { projectId: string; sessionId: string } | null,
  b: { projectId: string; sessionId: string } | null,
): boolean {
  return a !== null && b !== null && a.projectId === b.projectId && a.sessionId === b.sessionId;
}

/**
 * What "Voice call about this chat" / "Voice Call" / "Call <GBot>" does, given the call that is open:
 * - `start`: no call is open; start one about the session.
 * - `refocus`: a call is open on the same computer about something else; move it to this session.
 * - `already`: the open call is already about this session (or with this GBot); just show it.
 * - `otherComputer`: a call is open on another computer; a call can't move computers.
 * - `replace`: a call with a GBot is open, or a GBot is called while another call is open, on the
 *   same computer; a call with a GBot can't be refocused, so it is hang up and call.
 */
export type VoiceCallAboutAction = 'start' | 'refocus' | 'already' | 'otherComputer' | 'replace';

export function voiceCallAboutAction(
  /** `gbotId`: the GBot the open call is with (`callGbotId`), null or absent for a Voice agent call. */
  open: { active: boolean; machineId: string | null; focus: VoiceFocus | null; gbotId?: string | null },
  target: { machineId: string; projectId: string; sessionId: string; gbotId?: string | null },
): VoiceCallAboutAction {
  if (!open.active) return 'start';
  if (open.machineId !== target.machineId) return 'otherComputer';
  const openGbot = open.gbotId ?? null;
  const wantedGbot = target.gbotId ?? null;
  if (openGbot !== null || wantedGbot !== null) {
    const sameChat = target.sessionId.length === 0 || sameSession(open.focus, target);
    return openGbot === wantedGbot && sameChat ? 'already' : 'replace';
  }
  return sameSession(open.focus, target) && open.focus?.closed !== true ? 'already' : 'refocus';
}

/**
 * The note the captions get when the scope changes mid-call, or null when nothing worth saying
 * changed (the same scope again, a rename, or a closed session, which gxserver's `sessionClosed`
 * announcement already says and the banner shows).
 */
export function focusChangeNotice(previous: VoiceFocus | null, next: VoiceFocus | null): string | null {
  if (next === null) return previous === null ? null : 'Now about all sessions.';
  if (next.closed || sameSession(previous, next)) return null;
  return `Now only about ${next.title}.`;
}

/** The banner's second part, "(<project>)", or empty when gxserver named no project. */
export function focusBannerDetail(focus: VoiceFocus): string {
  return focus.project.length > 0 ? `(${focus.project})` : '';
}
