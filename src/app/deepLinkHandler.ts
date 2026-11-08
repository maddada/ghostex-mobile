/**
 * What a ghostex:// or pairing link does, with the app's stores and navigation passed in
 * (`DeepLinkDeps`, wired in `deepLinks.ts`), so the rules are testable under `bun test`.
 *
 * - `ghostex://voice` opens the voice screen (the "Voice mode on" notification).
 * - A pairing link (`https://ghostex.dev/pair#…`) opens the scanner with it.
 * - `ghostex://session?machineId=…&sessionId=…[&title=…][&view=question]` opens the session as a tap in
 *   the Sessions list does: in its Chat View when it opens there, else its terminal (attached first).
 *   The Android persistent notification's rows, the agent notifications and the Live Activity's rows send it.
 *   A row of the Android persistent notification adds `source=notification`: its tap also marks the session's rows
 *   read, as opening it from the bell's list does (`markOpened`), so a Done session leaves the list on both.
 *   `view=question` (a "has a question" notification or Live Activity row) opens the Chat View, where the
 *   question card stands in place of the composer; a session without a Chat View opens its terminal.
 *   At a cold start the link waits until the stores that decide or overwrite the session's view are
 *   loaded (`storesReady`); the computer's session list may still be missing then: the session is
 *   attached, and once the list shows it (during the attach, or read anew right after it) a question link
 *   switches to its Chat View when it has one. An ordinary link forces no view: the Terminal screen picks it
 *   with the rule a tap in the Sessions list uses (`chatModeArmed`) as soon as the list is there.
 *   A link that opens a tapped notification carries its opening's check (`current`): once a later tap came
 *   or the person left, no step of the opening selects, switches the view or navigates any more.
 */

import { readPairingCode } from '../machines/pairingCodes';

const SESSION_LINK = 'ghostex://session';

export type SessionLinkView = 'question';

export type SessionLink = {
  machineId: string;
  sessionId: string;
  title: string;
  view: SessionLinkView | null;
  /** `notification`: a row of the Android persistent notification, which opens the session as the bell's row does. */
  source: 'notification' | null;
};

/** The link that opens a session (and, for `view: 'question'`, its question card). */
export function sessionDeepLink(link: {
  machineId: string;
  sessionId: string;
  title?: string;
  view?: SessionLinkView;
}): string {
  const query = [
    `machineId=${encodeURIComponent(link.machineId)}`,
    `sessionId=${encodeURIComponent(link.sessionId)}`,
    ...(link.title !== undefined && link.title.length > 0 ? [`title=${encodeURIComponent(link.title)}`] : []),
    ...(link.view !== undefined ? [`view=${link.view}`] : []),
  ];
  return `${SESSION_LINK}?${query.join('&')}`;
}

function queryParam(url: string, name: string): string | null {
  const match = new RegExp(`[?&]${name}=([^&#]*)`).exec(url);
  if (match === null) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** The session a `ghostex://session` link names, or null for any other link or one without both ids. */
export function parseSessionLink(url: string): SessionLink | null {
  if (!url.startsWith(SESSION_LINK)) return null;
  const machineId = queryParam(url, 'machineId') ?? '';
  const sessionId = queryParam(url, 'sessionId') ?? '';
  if (machineId.length === 0 || sessionId.length === 0) return null;
  return {
    machineId,
    sessionId,
    title: queryParam(url, 'title') ?? '',
    view: queryParam(url, 'view') === 'question' ? 'question' : null,
    source: queryParam(url, 'source') === 'notification' ? 'notification' : null,
  };
}

/** A computer as the terminal store connects to it. */
export type DeepLinkMachine = {
  id: string;
  host: string;
  username: string;
  port: number;
  transport?: 'ssh' | 'tailcat';
};

/** The session as the computer's session list has it. */
export type DeepLinkSession = {
  projectId: string;
  /** Its freshest title ('' when it has none). */
  title: string;
  hasChatView: boolean;
  /** A tap in the Sessions list opens its Chat View (Default Agent View or this tab's last choice). */
  opensInChatView: boolean;
};

export type TerminalRoute = { sessionKey: string; machineId: string; title?: string };

export type DeepLinkDeps = {
  /**
   * False until the saved computers and the saved view choices are loaded (a cold start); the link waits for
   * them, so the loading does not overwrite the view the link chose.
   */
  storesReady(): boolean;
  machine(machineId: string): DeepLinkMachine | undefined;
  session(machineId: string, sessionId: string): DeepLinkSession | undefined;
  /** Reads the computer's session list anew (a read that starts now) and gives the session as it then lists it. */
  loadSession(machineId: string, sessionId: string): Promise<DeepLinkSession | undefined>;
  /** Back from the Terminal lands on the list of the workspace this session is in. */
  revealWorkspace(machineId: string, sessionId: string): void;
  /** Opens (or selects) the session's tab for its Chat View, without attaching its terminal. */
  openChatTab(machine: DeepLinkMachine, session: { sessionId: string; projectId?: string; title?: string }): string;
  /**
   * Shows this tab's Chat View from now on, as the Terminal screen's own toggle does, for a question's link: full
   * screen, the panes waiting until the person brings them back (`usePaneStore`'s `questionHold`).
   */
  showChatView(sessionKey: string): void;
  /**
   * Attaches the session's terminal and selects its tab. `current`, when the link opens a tapped notification, is
   * that opening's check: an attach that waited for an opening under way selects nothing once it fails.
   */
  attachSession(
    machine: DeepLinkMachine,
    session: { sessionId: string; title?: string },
    current?: () => boolean,
  ): Promise<string>;
  /**
   * `current`, when the link opens a tapped notification, is that opening's check; a navigation that waits until
   * the screens are ready checks it again before it runs.
   */
  navigate(
    route: { name: 'Terminal'; params: TerminalRoute } | { name: 'Voice' } | { name: 'ScanCode'; url: string },
    current?: () => boolean,
  ): void;
  /** Runs `retry` again shortly (stores hydrate within moments of launch). */
  later(retry: () => void): void;
  /**
   * Marks read on the computer the session's rows that opening it from the bell's list marks read (`readOnOpen`),
   * once its feed is read: the tap of an Android persistent notification row.
   */
  markOpened(machineId: string, sessionId: string): void;
};

/**
 * `current` is the check of a tapped notification's opening: false once a later tap came or the person left (the
 * caller decides). It is checked at the start, at every retry while the stores load, inside the attach once an
 * opening of the same tab under way finished (before it selects), once the attach is done and once the session list
 * is read, so a superseded opening never selects, switches the view or navigates.
 */
function openSession(link: SessionLink, deps: DeepLinkDeps, current: (() => boolean) | undefined): void {
  if (current?.() === false) return;
  if (!deps.storesReady()) {
    deps.later(() => openSession(link, deps, current));
    return;
  }
  const machine = deps.machine(link.machineId);
  if (machine === undefined) return;
  deps.revealWorkspace(link.machineId, link.sessionId);
  const session = deps.session(link.machineId, link.sessionId);
  const title =
    session !== undefined && session.title.length > 0 ? session.title : link.title.length > 0 ? link.title : undefined;
  const chat = session !== undefined && (link.view === 'question' ? session.hasChatView : session.opensInChatView);
  if (chat) {
    const sessionKey = deps.openChatTab(machine, {
      sessionId: link.sessionId,
      projectId: session.projectId.length > 0 ? session.projectId : undefined,
      title,
    });
    if (link.view === 'question') deps.showChatView(sessionKey);
    deps.navigate({ name: 'Terminal', params: { sessionKey, machineId: machine.id, title } }, current);
    return;
  }
  void deps
    .attachSession(machine, { sessionId: link.sessionId, title }, current)
    .then(async (sessionKey) => {
      // The attach can take long: a later tap or the person may have moved on meanwhile.
      if (current?.() === false) return;
      // On a cold start the summary may only have arrived during the attach.
      deps.revealWorkspace(link.machineId, link.sessionId);
      const question = link.view === 'question' && session === undefined;
      const arrived = question ? deps.session(link.machineId, link.sessionId) : undefined;
      if (arrived?.hasChatView === true) deps.showChatView(sessionKey);
      deps.navigate({ name: 'Terminal', params: { sessionKey, machineId: machine.id, title } }, current);
      if (!question || arrived !== undefined) return;
      // Not there yet: read it, then show the question card when the session has a Chat View.
      const loaded = await deps.loadSession(link.machineId, link.sessionId);
      if (loaded?.hasChatView === true && current?.() !== false) deps.showChatView(sessionKey);
    })
    .catch(() => {
      // Connection failures surface on the Sessions screen as usual.
    });
}

/**
 * Handles one incoming link (cold start or while running); links the app does not own are ignored. `current`: see
 * `openSession` (a tapped notification's opening); links from outside the app and attention-list rows have none.
 */
export function handleDeepLink(url: string | null, deps: DeepLinkDeps, current?: () => boolean): void {
  if (url === null) return;
  if (url.startsWith('ghostex://voice')) {
    deps.navigate({ name: 'Voice' });
    return;
  }
  const pairing = readPairingCode(url);
  if (pairing !== null && pairing.kind !== 'legacyAddress') {
    deps.navigate({ name: 'ScanCode', url });
    return;
  }
  const link = parseSessionLink(url);
  if (link === null) return;
  if (link.source === 'notification') deps.markOpened(link.machineId, link.sessionId);
  openSession(link, deps, current);
}
