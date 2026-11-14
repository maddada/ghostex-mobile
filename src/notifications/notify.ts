/**
 * The routes that announce agent events, both through the one gate of the record of announced events
 * (`eventIdentity.ts`), which also holds the app's one rate limit:
 *
 * - `processHostEvents`: from host events (feed rows, and pushes the app takes in front or while inactive; a push
 *   iOS showed itself goes to the record as a fact, `shownBySystem` in `eventIdentity.ts`) to
 *   notification requests: the settings gate, none for the session open on screen (whose event then counts
 *   as seen, so no later copy announces it), one notification and one sound per event, the rate limit, and
 *   the request's text, which is the event and the session only: "agent · project" as the title and the event
 *   wording as the line under it. Nothing the agent wrote, not even the session title (often the first
 *   prompt), goes into a request.
 * - `announceAttentionTransitions`: the Sessions list's attention sound (`src/app/alerts.ts`), one sound per
 *   pass of the list for the sessions that entered attention, none for the session open on screen (counted as
 *   seen there too), none for an event that already sounded or was seen on screen, and only within the same
 *   rate limit.
 *
 * A feed row is one event in whichever order and however often it comes again while the record keeps it.
 * The Sessions list's copy is the event of the feed row the computer names for the attention; from a computer
 * that names none it is an event of its own, so its sound and a row's notification both come, each within the
 * rate limit. A push without `notificationId` is matched only within its attention. Deliveries that arrive
 * before the record has read what the last launch stored wait for it and are then handled in the order they
 * came, each judged against what the record kept when it arrived. The record's invariants, the identity
 * contract the push route depends on and the record's bound are in `eventIdentity.ts`. The request's `data`
 * carries the push message's keys (`kind`, `machineId`, `sessionId`) and the feed row id (`notificationId`),
 * so a tap is handled the same way for both. The notification centre and the sound are passed in, so the
 * rules are testable under `bun test`.
 */

import { sessionDeepLink } from '../app/deepLinkHandler';
import { NotificationsCopy } from '../copy';
import {
  mapEvent,
  type AttentionEvent,
  type AttentionKind,
  type HostEvent,
  type HostEventKind,
  type SessionFacts,
} from './events';
import { provenAttention, type AnnouncedEvents, type Arrival, type EventIdentity } from './eventIdentity';
import { alertChoiceFor, type NotificationSettings } from './settings';

/** What a notification carries for its tap; never shown. */
export type NotificationData = {
  kind: HostEventKind;
  machineId: string;
  sessionId: string;
  /** The `ghostex://session` link the tap opens. */
  url: string;
  /** The feed row the tap marks read ('' when the event came without one). */
  notificationId: string;
};

export type NotificationRequest = {
  identifier: string;
  /** Notifications of one session of one computer stack together (iOS `threadIdentifier`). */
  threadId?: string;
  title: string;
  /** The event in words, shown under the title (the system notification's body). */
  line: string;
  /** Plays the system's notification sound. */
  sound: boolean;
  data: NotificationData;
};

/** The system's notification centre (expo-notifications on iOS, a fake in tests). */
export type NotificationCentre = { post(request: NotificationRequest): Promise<void> };

export type NotifyDeps = {
  centre: NotificationCentre;
  /** The app's record of announced events and its rate limit, shared by every route. */
  announced: AnnouncedEvents;
  settings(): NotificationSettings;
  /** Whether the attention sound is on (Settings › Notifications, `doneNotificationSound`). */
  soundOn(): boolean;
  /** Alert me for is Needs you only: a finished turn notifies only when its session's `finishedNeedsYou`. */
  needsYouOnly?(): boolean;
  /** Whether the session is open on screen now: no banner and no sound for it, and its event counts as seen. */
  onScreen(machineId: string, sessionId: string): boolean;
  /** The "Show session names" switch (`liveActivitySessionNames`): on, a notification leads with the session's title. */
  sessionNames?(): boolean;
  log(message: string): void;
};

/** What the Sessions list's attention sound needs (`src/app/alerts.ts`). */
export type AttentionSoundDeps = Pick<NotifyDeps, 'announced' | 'soundOn' | 'onScreen' | 'log'> & {
  /** Plays the attention sound once, for the events it announces. */
  play(events: readonly EventIdentity[]): void;
};

/**
 * The choice for an event: a worker's own news (its finished turn, question or error) follows Workers
 * (CDXC:Notifications 2026-11-14 in server/src/worker_alerts.rs), anything else its kind's choice.
 */
function eventChoice(event: Pick<AttentionEvent, 'kind' | 'worker'>, settings: NotificationSettings) {
  return alertChoiceFor(event.worker === true ? 'threadReport' : event.kind, settings);
}

/** Whether the choices let an event of `kind` notify (not Off); nothing does before the first ask was answered. */
export function notificationAllowed(
  kind: AttentionKind,
  settings: NotificationSettings,
  worker = false,
): boolean {
  if (settings.askedAt === undefined || !settings.enabled) return false;
  // Waiting and "has a question": one choice, Needs you (only the wording differs).
  return eventChoice({ kind, worker }, settings) !== 'off';
}

/*
CDXC:Notifications 2026-11-11 DECISION: User (push follow-ups, fault 4): the notification the app posts while it runs
follows the push's names rule (CDXC:Notifications 2026-11-11 in server/src/push/message.rs), so a notice reads the same
whether the app is open or closed: with "Show session names" on (the default since 2026-11-12) it leads with the session's title (the agent's
name when the session has none), off with the agent's name.
*/
export function notificationRequestFor(
  event: AttentionEvent,
  sound: boolean,
  sessionNames = false,
): NotificationRequest {
  const sessionTitle = event.sessionTitle.split(/\s+/u).filter(Boolean).join(' ');
  const agent =
    sessionNames && sessionTitle.length > 0
      ? sessionTitle
      : event.agentName.length > 0
        ? event.agentName
        : NotificationsCopy.unknownAgent;
  return {
    // One stack per session of a computer, as the computer's pushes are (`threadId`, CDXC:Notifications 2026-11-11 in
    // server/src/push/message.rs).
    threadId: `${event.machineId}:${event.sessionId}`,
    identifier:
      event.eventId.length > 0
        ? `ghostex-attention:${event.machineId}:${event.eventId}`
        : `ghostex-attention:${event.machineId}:${event.sessionId}:${event.occurredAt}`,
    title: event.projectName.length > 0 ? `${agent} · ${event.projectName}` : agent,
    line: NotificationsCopy.event[event.kind],
    sound,
    data: {
      kind: event.hostKind,
      machineId: event.machineId,
      sessionId: event.sessionId,
      url: sessionDeepLink({
        machineId: event.machineId,
        sessionId: event.sessionId,
        ...(event.kind === 'question' ? { view: 'question' as const } : {}),
      }),
      notificationId: event.eventId,
    },
  };
}

/**
 * Posts the notification of one mapped event when the switches let it, its session is not open on screen
 * and the gate lets it: the event had no notification yet (from any route) and was not seen on screen, and
 * the rate limit grants it, or it is the notification of a row whose event's sound (the Sessions list named
 * the row) came within the last 20 s; true when posted. Its sound comes with it when the sound is on and the
 * event has not sounded yet. Held back for the session open on screen, the event counts as seen. Called once
 * the record of announced events is loaded (`processHostEvents`).
 */
export function postNotification(event: AttentionEvent, identity: EventIdentity, deps: NotifyDeps): boolean {
  if (!notificationAllowed(event.kind, deps.settings(), event.worker === true)) return false;
  // The user is looking at this session: nothing is announced, its row stays in the attention list, and the
  // event counts as seen, so a copy that comes after the user left announces nothing either.
  if (deps.onScreen(event.machineId, event.sessionId)) {
    deps.announced.seenOnScreen(identity);
    return false;
  }
  // Silent: shown without the sound; Sound: with it while the attention sound is on.
  const sound = deps.soundOn() && eventChoice(event, deps.settings()) === 'sound';
  const announcement = deps.announced.announce(identity, { notification: true, sound });
  if (announcement.rateLimited) {
    deps.log(`Notification held back by the rate limit (${event.kind}); it is in the attention list.`);
  }
  if (!announcement.notification) return false;
  void deps.centre.post(notificationRequestFor(event, announcement.sound, deps.sessionNames?.() ?? false)).catch(() => {
    // iOS's own error text stays out of the app log, which can be exported.
    deps.log(`Notification not shown (${event.kind}): iOS did not take it.`);
  });
  return true;
}

/**
 * Maps and posts every event in order, once the record of announced events is loaded (`whenLoaded`).
 * `arrival` is when the events came (`AnnouncedEvents.arrive`), taken before any wait.
 */
export function processHostEvents(
  events: readonly HostEvent[],
  facts: (machineId: string, sessionId: string) => SessionFacts | undefined,
  deps: NotifyDeps,
  arrival: Arrival = deps.announced.arrive(),
): void {
  deps.announced.whenLoaded(() => {
    for (const event of events) {
      const sessionFacts = facts(event.machineId, event.sessionId);
      const mapped = mapEvent(event, sessionFacts);
      if (mapped === null) continue;
      if (mapped.kind === 'finished' && deps.needsYouOnly?.() && sessionFacts?.finishedNeedsYou === false) continue;
      const identity: EventIdentity = {
        machineId: event.machineId,
        sessionId: event.sessionId,
        kind: mapped.hostKind,
        rowId: event.eventId,
        // Only the attention the event came in, never one the session entered after it.
        episode: provenAttention(event.occurredAt, sessionFacts),
      };
      postNotification(mapped, identity, deps);
    }
  }, arrival);
}

/**
 * One pass of the Sessions list (`src/app/alerts.ts`): ends the attentions of the sessions in `left`, then
 * plays one sound for the sessions in `entered` (each the session's new attention, which names no kind),
 * unless the sound is off, the session is open on screen (its event then counts as seen), the event already
 * sounded (its notification played it, from any route) or was seen on screen, or the rate limit holds it back.
 * Waits like every route for the record of announced events (`whenLoaded`).
 */
export function announceAttentionTransitions(
  left: readonly { machineId: string; sessionId: string }[],
  entered: readonly EventIdentity[],
  deps: AttentionSoundDeps,
  arrival: Arrival = deps.announced.arrive(),
): void {
  deps.announced.whenLoaded(() => {
    for (const { machineId, sessionId } of left) deps.announced.sessionLeftAttention(machineId, sessionId);
    if (entered.length === 0 || !deps.soundOn()) return;
    const sounded: EventIdentity[] = [];
    for (const event of entered) {
      if (deps.onScreen(event.machineId, event.sessionId)) {
        deps.announced.seenOnScreen(event);
        continue;
      }
      const announcement = deps.announced.announce(event, { notification: false, sound: true });
      if (announcement.rateLimited)
        deps.log('Attention sound held back by the rate limit; the session is in the list.');
      if (announcement.sound) sounded.push(event);
    }
    // One sound per pass, even when several sessions entered attention together.
    if (sounded.length > 0) deps.play(sounded);
  }, arrival);
}
