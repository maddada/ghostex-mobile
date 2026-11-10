/**
 * The app's one record of announced agent events and its one gate. Every route that makes an event seen or
 * heard asks `announce` first:
 *
 * - the computer's notification feed (`feedStore.ts`, `processHostEvents` in `notify.ts`): a row's id and
 *   host kind, as a notification with or without its sound;
 * - the Sessions list's attention sound (`src/app/alerts.ts`, `announceAttentionTransitions` in `notify.ts`):
 *   a session entering attention; the list names the attention (`attention.eventId`, else
 *   `attention.enteredAt`) and, from a computer that sends it, the feed row written for it
 *   (`attention.notificationId`, optional), never its kind;
 * - the push route (`feedStore.ts`): a push the app takes while it is in front, through `processHostEvents`
 *   like a feed row; and a push iOS showed itself (`shownBySystem`), which is no request but a fact: the event
 *   gets its notification, and its sound when the push carried one, whatever the switches, the session open on
 *   screen or the rate limit would say now, so that no later copy announces it again. It is an output the person
 *   got, so it counts like one: against its session's slot and the overall eight a minute (also past them), once.
 *
 * The record also keeps which computers confirmed that they accepted this phone's push registration
 * (`setPushAccepted`), so that while the app is out of front it leaves their events to their pushes (`feedStore.ts`)
 * from the first moment of a launch, before this launch's registration is answered. Only such a confirmation counts:
 * a registration without an answer, and acceptance lost with a stored record that could not be read or is missing,
 * leave the computer's events to the app's own notifications (a push of an older registration can then come too).
 *
 * An event is announced once any of these made it seen or heard: its notification or the attention sound.
 * A later copy then gets only what the event has not had yet (its notification, which carries the sound
 * when the sound is still due; or the attention sound), each once. The rate limit (`rateLimit.ts`) is one
 * limiter for all routes, owned by this record and stored with it, and it counts what the person actually
 * gets: every notification and every attention sound takes one of its grants. The one exception: a feed
 * row's notification that comes within `PER_SESSION_INTERVAL_MS` (20 s) after the attention sound of the
 * same event, which the row the computer named for the attention links to it (rule 2), is part of that sound
 * and takes no grant; so is a banner iOS showed of that event within those 20 s. Later than that, in the other
 * order (the sound after a notification that came without it) and without that link, every part takes a grant of
 * its own. A delivery that the switches or the rate limit hold back announces nothing and adds nothing here (an
 * event that already had one part keeps it); one that the session open on screen holds back announces nothing
 * either, and its event counts as seen ("Seen on screen" below).
 *
 * Invariants, within the host contract of rule 4 and the two exceptions below:
 *
 * - I1. An event gets at most one notification and at most one attention sound, whichever of its copies
 *   comes first (a feed read, the live channel, a push, the Sessions list), however late and in whatever
 *   order the others come, also across app restarts and while the stored record is still loading, as far as
 *   the identity contract below can tell its copies apart. An event seen on screen gets neither from a later
 *   copy while that is remembered ("Seen on screen" below).
 * - I2. A first delivery is never dropped: what it asks for and the event has not had yet is announced, or
 *   held back by an existing rule (the switches, the session open on screen, now or for an earlier copy of
 *   the event, the rate limit); never lost because the record is full or still loading. Every route hands its
 *   deliveries to `whenLoaded`: what arrives before the stored record is read waits for it and is then
 *   handled in the order it came.
 * - I3. The record stays bounded: it holds announced events only, at most `ANNOUNCED_WITHIN_WINDOW` plus, per
 *   computer, the pushes iOS showed that the computer could have sent in time to arrive within the window, the
 *   events of its feed's rows and one per session in attention (the bound below). It checks that after every
 *   change that adds; should it ever hold more, it keeps every event and reports it (`failed('bound')`), it never
 *   forgets one early. The ids of events seen on screen are kept apart, at most `SEEN_ON_SCREEN_IDS` per computer;
 *   past that the oldest go first.
 *
 * Two exceptions, which the phone alone cannot avoid:
 *
 * - iOS ends the app between showing and saving. A notification or sound is shown first and the record is
 *   written right after (`queueWrite`): when iOS ends the app in that moment, the next launch does not know
 *   the event was announced, so it can be announced a second time; it is never lost. The rate limit's grants
 *   of what was shown then are lost with it, so in the minute after that launch up to one more batch of other
 *   events can be announced than the limit allows; a copy held back for the session open on screen in that
 *   moment is not remembered as seen; and when a row's kind took the Sessions list's sound that named the row
 *   in that moment, the row's next kind (`needsInput` after `finished`) can take that sound instead and then
 *   comes without a sound of its own.
 * - The person changes the phone's clock by hand. Set back, the record moves all its times back by as much as
 *   the latest of them lies ahead of the clock (`normalizeClock`) and stores that: it forgets nothing early,
 *   and the rate limit counts its last grants as made just now, so it holds announcements back for at most one
 *   more minute (in that minute a notification can also count as part of its event's sound a little later
 *   than 20 s after it). Set forward, the record's times look older than they are: an event can be forgotten
 *   early and announced a second time, and the rate limit forgets its grants early, so in the minute after the
 *   change up to one more batch of notifications or sounds can come than the limit allows. That holds for a
 *   change of any size: the phone's clock alone cannot tell a clock set forward from time that passed.
 *
 * Identity contract (the part the push route depends on):
 *
 * 1. A feed row is the event: computer + session + row id + the host kind it entered. The host never reuses
 *    a row id (a new UUID per row); the same row with the same kind is the same event however often, in
 *    whichever order and whatever attention the session list shows by then, while it is remembered (rule 4).
 *    A row the computer turns from `finished` into `needsInput` in place is a second event of that row. A
 *    push carries the row id as `data.notificationId` (optional in the push message; the row has to
 *    exist before the push is sent) and its kind as `data.kind`.
 * 2. The Sessions list names no kind. From a computer that names the attention's feed row
 *    (`attention.notificationId`), the list's copy is that row's first event: the first of its kinds announced
 *    or seen, else the first that comes; exactly, like rule 1. From a computer that does not, the list's copy
 *    is an event of its own, its attention's: no row is matched to it and nothing is swallowed, so the
 *    attention sound and a row's notification are two announcements of the session, each within the rate
 *    limit (within 20 s of the sound, the one-per-session rule holds the row's notification back). A
 *    delivery without a row id (a push without `notificationId`) is matched only within the attention it
 *    provably came in (`provenAttention`), as that attention's event of the same kind, never to the Sessions
 *    list's copy; outside it, nothing tells it from the session's next event of that kind, so it is a new
 *    event. So the push route sends `notificationId`: only with it is a push matched exactly.
 * 3. A row belongs to an attention when that is established: the session list read after the row shows the
 *    session in attention since no later than the row was written (`provenAttention`); a later attention
 *    began after the row, so it never takes the row. An announced or seen row delivered again within its
 *    attention is linked to it then.
 * 4. What is remembered rests on the host's push contract: gxserver sends each alert push once, at the
 *    moment of the event, with a time-to-live of at most `PUSH_TIME_TO_LIVE_MS`, and never again; a feed row
 *    can be read again only while it is in the computer's feed. A copy of an event therefore arrives while
 *    its row is in the feed, or within an hour of the event and so of the event's first announcement, which
 *    came after the event. The record keeps each announced event:
 *    - while its row is in the computer's feed as last read (`retainFeed`);
 *    - until `ANNOUNCED_WINDOW_MS` (the push's hour and an hour of margin) after its first announcement, on
 *      the phone's clock, compared with when a copy ARRIVED, not when it is handled: while a copy waits (for
 *      the stored record, for the session list, while iOS pauses the app), the record forgets nothing that
 *      was kept when it arrived (`arrive`). A Sessions-list copy that the named row's kind took over later
 *      (rule 2) is kept that long from the takeover instead: the kind's event (a row the computer turned into
 *      `needsInput` in place, say) can come long after the sound, and its push is bound by its own hour. A
 *      list copy that names its row is kept like that row's events;
 *    - a session's current attention's first event (the Sessions list's copy with the row it named, else the
 *      first row event linked to the attention) until the session list shows the session out of attention or
 *      gone, or a later attention of the session replaces it: the Sessions list shows a session entering
 *      attention when it next reads the list, which can be late (its computer was hidden, or its list could
 *      not be read meanwhile), so this copy is not bound by the push's hour; the attention's other events are
 *      kept as above.
 *    Nothing is rejected for its age: a first delivery is always handled. An event that was never announced
 *    (held back by the switches or the rate limit) is not remembered: a later copy of it is its first
 *    announcement, never a second one; one held back for the session open on screen is remembered as seen
 *    (below). A copy sent outside the contract (pushed again, or arriving more than an hour after the event)
 *    can be announced a second time. A push iOS showed is kept from when the app learned of it, which is after
 *    iOS showed it, so every later copy of its event (within the push's hour, or while its row is in the feed)
 *    finds it, however many pushes arrive together.
 *
 * Seen on screen. A copy that the session open on screen holds back (`seenOnScreen`) makes its event seen:
 * the person was looking at that session, so no later copy announces it, by notification or sound, also
 * after the person left the session. Seeing takes no grant of the rate limit and adds no announced event, so
 * it leaves the bound below as it is. The record keeps the seen events apart, per computer, as ids under the
 * identity contract above: the row and kind (while the row is in the feed as last read, or for
 * `ANNOUNCED_WINDOW_MS` from when it was first seen, at the horizon, as rule 4 keeps an announced event), or
 * the row the Sessions list named, until a kind of it comes; in the attention the copy provably came in, that
 * attention's event of the kind (for the same window), for a delivery without a row id; and, one per session,
 * the attention whose Sessions-list copy was seen, with the row that copy named until a kind of it comes,
 * kept until the session list shows the session out of it or another attention of the session is seen. That
 * attention covers later Sessions-list copies of itself and the row its copy named, nothing else: a seen copy
 * never covers another row, and a row seen on screen does not cover a Sessions-list copy that named no row
 * (rule 2). At most `SEEN_ON_SCREEN_IDS` = 3 × 121 = 363 ids per computer: three ids (row, kind, attention)
 * for one event a minute over a window's 121 minutes, a session held on screen while its agent finishes a
 * turn every minute. Past that the oldest ids go first; the worst case is then one late notification or sound
 * for an event the person saw, never a second announcement of an announced event, which the record keeps
 * apart from these ids. Events held back by the switches or the rate limit are not remembered.
 *
 * The bound. Every event here was announced, and every announcement (but a notification that is part of its
 * event's sound, and a push iOS showed) took one grant of the rate limit, the first announcement of each event
 * among them; two records later found to be one event are merged, which only makes them fewer (the merged
 * event counts at the later of their grants, at the grant when only one of them took one, and is kept from the
 * later of their windows). The limiter grants at most `OVERALL_MAX` within any `OVERALL_WINDOW_MS`, also across
 * launches (its grants are stored and restored with the events, in one write), so the events first announced
 * within a stretch of `span` ms number at most `announcementsWithin(span)`. A push iOS showed starts an event
 * without a grant (`presented`), and the record keeps every one; they are counted apart, per computer, and
 * bounded by the computer's sending instead: it sends each alert push once, at most `OVERALL_MAX` within any
 * `OVERALL_WINDOW_MS`, and the push lives at most `PUSH_TIME_TO_LIVE_MS`; the record learns of it within
 * `PUSH_RECORDING_MS` after iOS showed it and keeps it from then (`at`). A push recorded at `at` was therefore
 * sent no earlier than `at - PUSH_TIME_TO_LIVE_MS - PUSH_RECORDING_MS`, so those recorded within a stretch of
 * `span` ms number at most `announcementsWithin(span + PUSH_TIME_TO_LIVE_MS + PUSH_RECORDING_MS)` per computer.
 * The bound holds within the host's contract and with iOS recording the push within its background run; a push
 * recorded later is still kept, only reported. An event outside its row's feed is kept for `ANNOUNCED_WINDOW_MS`
 * from its first announcement (or a takeover, below), measured at the horizon: now, or the arrival of the oldest
 * copy still waiting to be handled. With no copy waiting the record therefore holds at most
 * `ANNOUNCED_WITHIN_WINDOW` = 8 × 121 = 968 events from the window, and per computer at most 8 × 181 = 1448 of
 * pushes iOS showed, plus the events of rows kept only for their feed: at most `FEED_RETENTION_ROWS` rows per
 * computer, each with its `HOST_EVENT_KINDS.length` kinds (120 events). While a copy waits, the window reaches back
 * from its arrival, and `span` is `now - horizon + ANNOUNCED_WINDOW_MS`. Beyond these, each session's current
 * attention keeps its first event: at most one per session the phone sees in attention. And an event kept from a
 * takeover within the window whose first announcement came before it: the first event of the session's
 * current attention at the window's start (at most one per session), or the Sessions-list copy of a row that
 * was kept beyond its window only by the feed, so a row in the feed at the window's start (at most
 * `FEED_RETENTION_ROWS` per computer). A session's attention and the other entries hang off these events, so
 * the stored record has at most one entry per event plus the limiter's grants of the last minute. A clock set
 * back moves every time back alike (above), which keeps the spacing of the grants, so the bound holds on the
 * moved times.
 *
 * The record is kept in storage across launches (`load`) and holds ids, kinds, channels, times and whether a
 * push iOS showed started the event, never text, also for the events seen on screen, and the ids of the computers
 * that accepted this phone's push registration (never the token). It is written right after the task that
 * changed it (the first exception above). A computer that is hidden keeps its record; a removed one
 * (`keepComputers`) keeps its events and the rows and kinds it saw on screen until their window ends, because its
 * feed and session list are no longer read (added again, it is a new computer to the phone).
 * Deliveries that wait for the stored record are held in memory until the storage read settles.
 *
 * Kept free of React Native so it is testable under `bun test`.
 */

import { HOST_EVENT_KINDS, type HostEventKind } from './events';
import { FEED_RETENTION_ROWS } from './feedContract';
import {
  NotificationRateLimiter,
  OVERALL_MAX,
  OVERALL_WINDOW_MS,
  PER_SESSION_INTERVAL_MS,
  type RateGrant,
} from './rateLimit';

/** The longest an alert push of the computer lives on its way to the phone (rule 4). */
export const PUSH_TIME_TO_LIVE_MS = 60 * 60 * 1000;

/**
 * The longest from iOS showing a push to the record learning of it: the background run iOS starts for the push
 * records it, and iOS ends such a run after about 30 s (`backgroundPush.ts` completes within 25 s). An assumption
 * about iOS, used only to check the bound (I3): a later record is still kept, only reported.
 */
export const PUSH_RECORDING_MS = 30_000;

/** How long an announced event is kept outside its row's feed (rule 4): the push's hour and an hour of margin. */
export const ANNOUNCED_WINDOW_MS = 2 * PUSH_TIME_TO_LIVE_MS;

/** The most events the rate limit lets be announced within a stretch of `span` ms, both ends included. */
function announcementsWithin(span: number): number {
  return OVERALL_MAX * (Math.floor(Math.max(span, 0) / OVERALL_WINDOW_MS) + 1);
}

/** The most events announced within one window: a window's two hours, both ends included, touch 121 minutes. */
export const ANNOUNCED_WITHIN_WINDOW = announcementsWithin(ANNOUNCED_WINDOW_MS);

/**
 * The most ids of events seen on screen one computer keeps: three (the row, the attention's event of the kind,
 * the attention) for one event a minute over a window's 121 minutes. Past it the oldest go first.
 */
export const SEEN_ON_SCREEN_IDS = 3 * (Math.floor(ANNOUNCED_WINDOW_MS / OVERALL_WINDOW_MS) + 1);

export type EventIdentity = {
  machineId: string;
  sessionId: string;
  /** The host kind the session entered; null on the Sessions-list route, which does not name it. */
  kind: HostEventKind | null;
  /** The feed row id: a row's, or the one the Sessions list names for its attention ('' when none). */
  rowId: string;
  /** The session's attention the delivery provably came in (`provenAttention`); null when not established. */
  episode: string | null;
};

/** What an event can be announced with: a notification and the attention sound, each once. */
export type AnnounceChannel = 'notification' | 'sound';

const ANNOUNCE_CHANNELS: readonly AnnounceChannel[] = ['notification', 'sound'];

/**
 * What a route asks to announce: a notification (`sound`: with its sound, which it carries only together
 * with the notification), or the attention sound alone (`notification` false).
 */
export type AnnounceRequest = { notification: boolean; sound: boolean };

/** What the route announces now; nothing when the event had it all, or (`rateLimited`) the rate limit held it. */
export type Announcement = { notification: boolean; sound: boolean; rateLimited: boolean };

const NOTHING: Announcement = { notification: false, sound: false, rateLimited: false };

/**
 * A push iOS showed as the record learns of it: when the app learned of it (`at`, an arrival's time; now when
 * absent), and whether this is the same presentation recorded once more (`again`: the background run records its
 * push before and after it reads the session list), which counts nothing more.
 */
export type SystemPresentation = { at?: number; again?: boolean };

/** A copy as it arrived (`arrive`): until it is handled, the record forgets nothing that was kept then. */
export type Arrival = { readonly at: number };

/** Where the record is kept across launches: AsyncStorage in the app (`feedStore.ts`), a fake in tests. */
export type AnnouncedEventsStorage = {
  /** Settles, as AsyncStorage's reads do; the switches every route checks come from the same storage. */
  read(): Promise<string | null>;
  write(record: string): Promise<void>;
  /**
   * The stored record could not be read (or is not one) and is written anew at the next change; a write
   * failed; or (`bound`) the record holds more than its bound, keeping every event all the same.
   */
  failed(problem: 'read' | 'write' | 'bound'): void;
};

/** A session's attention as the session list names it: its event id, else when it began ('' from neither). */
export function attentionKey(attentionId: string, enteredAt: string): string {
  return attentionId.length > 0 ? attentionId : enteredAt;
}

/**
 * The session's current attention (as the session list shows it) when the event provably came in it: the
 * attention began no later than the event. Null when the session is not in attention or the list does not say
 * when the attention began. Valid when the session list was read after the event (the feed store reads it
 * after a new row).
 */
export function provenAttention(
  occurredAt: string,
  session: { attentionId: string; attentionEnteredAt: string } | undefined,
): string | null {
  if (session === undefined) return null;
  const entered = Date.parse(session.attentionEnteredAt);
  const occurred = Date.parse(occurredAt);
  if (!Number.isFinite(entered) || !Number.isFinite(occurred) || occurred < entered) return null;
  return attentionKey(session.attentionId, session.attentionEnteredAt);
}

/**
 * An announced event: what it was announced with, when first (`at`, its grant; ms, the phone's clock), from
 * when it is kept (`keptFrom`: `at`, or later when a kind took over the Sessions list's copy, rule 4), whether a
 * push iOS showed started it without a grant (`presented`, counted apart in the bound), and whether iOS's showing
 * of its push was counted (`pushShown`; in memory only, a stored `presented` event has it).
 */
type Announced = {
  channels: Set<AnnounceChannel>;
  at: number;
  keptFrom: number;
  presented: boolean;
  pushShown: boolean;
};

/**
 * Adds what `from` knows of the same event to `into`: the later window, and the later grant, or the grant when
 * only one of them took one (the other was a push iOS showed).
 */
function merge(into: Announced, from: Announced): void {
  for (const channel of from.channels) into.channels.add(channel);
  if (into.presented === from.presented) into.at = Math.max(into.at, from.at);
  else if (into.presented) into.at = from.at;
  into.presented &&= from.presented;
  into.pushShown ||= from.pushShown;
  into.keptFrom = Math.max(into.keptFrom, from.keptFrom);
}

/**
 * One feed row's announced events, by the kind each entered; `listCopy`: the Sessions list's copy that named
 * this row while no kind of it has come yet (rule 2).
 */
type Row = { sessionId: string; rowId: string; kinds: Map<HostEventKind, Announced>; listCopy: Announced | null };

/** A session's current attention and the events kept with it. */
type Attention = {
  key: string;
  /** Its event of each kind and that event's row ('' while only deliveries without one came), rule 2. */
  kinds: Map<HostEventKind, { rowId: string; event: Announced }>;
  /**
   * Its first event, kept while the attention lasts (rule 4): the Sessions list's copy, else the first row
   * event linked to it; null when none.
   */
  first: Announced | null;
  /** `first` is the Sessions list's copy that no kind of the row it named has taken (always, when it named none). */
  kindless: boolean;
  /** The row of `first`: the one the Sessions list named, or the row event's own ('' none). */
  rowId: string;
};

type MachineEvents = {
  /** By `sessionId\nrowId`. */
  rows: Map<string, Row>;
  /** The rows of the computer's feed as last read, as `sessionId\nrowId`. */
  feed: Set<string>;
  /** Whether `feed` was read in this launch (else it is the stored one). */
  feedRead: boolean;
  /** Each session's current attention, by session id. */
  attentions: Map<string, Attention>;
  /** The ids of the events seen on screen (`seenKey`), oldest first, at most `SEEN_ON_SCREEN_IDS`. */
  seen: Map<string, Seen>;
};

/**
 * An id under which a copy of an event seen on screen is known (rules 1 to 3): the row's event of `kind`
 * (`attention` null; `kind` null: the row the Sessions list named, until a kind of it comes); the attention's
 * event of `kind` (`rowId` the row that came with it, '' none yet); or (`kind` null) the session's attention
 * whose Sessions-list copy was seen, `rowId` the row that copy named ('' none, or once a kind of it came).
 * `at`: when first seen (ms, the phone's clock).
 */
type Seen = {
  sessionId: string;
  rowId: string;
  kind: HostEventKind | null;
  attention: string | null;
  at: number;
};

/** The key a seen id is kept under; a current attention's id is one per session, as the record keeps one. */
function seenKey(id: Pick<Seen, 'sessionId' | 'rowId' | 'kind' | 'attention'>): string {
  if (id.attention === null) return `row\n${id.sessionId}\n${id.rowId}\n${id.kind}`;
  if (id.kind === null) return `attention\n${id.sessionId}`;
  return `kind\n${id.sessionId}\n${id.attention}\n${id.kind}`;
}

/** The key of the session's attention seen on screen. */
const seenAttentionKey = (sessionId: string): string => seenKey({ sessionId, rowId: '', kind: null, attention: '' });

/** The key of a row's event of `kind` seen on screen (`kind` null: the row the Sessions list named). */
const seenRowKey = (sessionId: string, rowId: string, kind: HostEventKind | null): string =>
  seenKey({ sessionId, rowId, kind, attention: null });

/** A seen id of the row's event of `kind` (null: the row the Sessions list named), first seen `at`. */
function rowSeenId(sessionId: string, rowId: string, kind: HostEventKind | null, at: number): Seen {
  return { sessionId, rowId, kind, attention: null, at };
}

/** Lets the oldest seen ids go until at most `SEEN_ON_SCREEN_IDS` are left. */
function trimSeen(seen: Map<string, Seen>): void {
  for (const key of seen.keys()) {
    if (seen.size <= SEEN_ON_SCREEN_IDS) return;
    seen.delete(key);
  }
}

/**
 * One stored event: its session, its row and kind (rowId '' without a row; kind null for a Sessions-list copy
 * no kind has taken over), the session's attention it belongs to (null when none) and whether it is that
 * attention's first event (a Sessions-list copy without a row always is), whether its row is in the feed as
 * last read, when it was first announced, from when it is kept, with what, and (`presented`, written only when
 * true) whether a push iOS showed started it. Ids, kinds, channels and times only, never text.
 */
type StoredEvent = {
  sessionId: string;
  rowId: string;
  kind: HostEventKind | null;
  attention: string | null;
  first: boolean;
  inFeed: boolean;
  at: number;
  keptFrom: number;
  channels: AnnounceChannel[];
  presented?: true;
};

/** One stored id of an event seen on screen, and whether its row is in the feed as last read. */
type StoredSeen = Seen & { inFeed: boolean };

/**
 * The stored record, version 1: the rate limit's grants of the last minute, each computer's events and seen ids, and
 * (`pushComputers`, absent in a record written before they were kept) the ids of the computers that accepted this
 * phone's push registration.
 */
type StoredRecord = {
  version: 1;
  grants: RateGrant[];
  computers: Record<string, { events: StoredEvent[]; seen: StoredSeen[] }>;
  pushComputers?: string[];
};

const rowKey = (sessionId: string, rowId: string): string => `${sessionId}\n${rowId}`;

/** `value`'s fields when it is a JSON object, else null; the parsers below check each field they take. */
function jsonFields(value: unknown): Readonly<Record<string, unknown>> | null {
  // The cast holds: the value is a non-null object that is no array (any key may be absent).
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

function parseChannels(value: unknown): AnnounceChannel[] | null {
  if (!Array.isArray(value)) return null;
  const channels: AnnounceChannel[] = [];
  for (const stored of value) {
    const channel = ANNOUNCE_CHANNELS.find((known) => known === stored);
    if (channel === undefined) return null;
    channels.push(channel);
  }
  return channels;
}

function parseGrant(value: unknown): RateGrant | null {
  const fields = jsonFields(value);
  if (fields === null || typeof fields.session !== 'string' || !isTime(fields.at)) return null;
  return { session: fields.session, at: fields.at };
}

function parseEvent(value: unknown): StoredEvent | null {
  const fields = jsonFields(value);
  if (fields === null) return null;
  const { sessionId, rowId, attention, first, inFeed, at, presented } = fields;
  // A record written before events were kept from a takeover keeps each from its first announcement.
  const keptFrom = fields.keptFrom === undefined ? at : fields.keptFrom;
  const kind = fields.kind === null ? null : HOST_EVENT_KINDS.find((known) => known === fields.kind);
  const channels = parseChannels(fields.channels);
  if (typeof sessionId !== 'string' || typeof rowId !== 'string' || kind === undefined || channels === null) {
    return null;
  }
  if ((attention !== null && typeof attention !== 'string') || typeof first !== 'boolean') return null;
  if (typeof inFeed !== 'boolean' || !isTime(at) || !isTime(keptFrom) || channels.length === 0) return null;
  // Absent in a record written before pushes iOS showed were kept, and for every other event.
  if (presented !== undefined && presented !== true) return null;
  // An entry is a row's event or an attention's: one without a row has an attention, and as the Sessions list's
  // copy it is that attention's first event.
  if (rowId.length === 0 && (attention === null || (kind === null && !first))) return null;
  return {
    sessionId,
    rowId,
    kind,
    attention,
    first,
    inFeed,
    at,
    keptFrom,
    channels,
    ...(presented === true ? { presented } : {}),
  };
}

function parseSeen(value: unknown): StoredSeen | null {
  const fields = jsonFields(value);
  if (fields === null) return null;
  const { sessionId, rowId, attention, inFeed, at } = fields;
  const kind = fields.kind === null ? null : HOST_EVENT_KINDS.find((known) => known === fields.kind);
  if (typeof sessionId !== 'string' || typeof rowId !== 'string' || kind === undefined) return null;
  if ((attention !== null && typeof attention !== 'string') || typeof inFeed !== 'boolean' || !isTime(at)) {
    return null;
  }
  // A row's id has its row.
  if (attention === null && rowId.length === 0) return null;
  return { sessionId, rowId, kind, attention, inFeed, at };
}

/** The entries of a stored list that are ones; `complete` false when it is no list or an entry was left out. */
function parseEntries<T>(value: unknown, parse: (entry: unknown) => T | null): { entries: T[]; complete: boolean } {
  if (!Array.isArray(value)) return { entries: [], complete: false };
  const parsed = value.map(parse);
  return { entries: parsed.filter((entry): entry is T => entry !== null), complete: !parsed.includes(null) };
}

/**
 * The stored record, checked at its trust boundary (storage can hold anything an older or broken launch
 * wrote): null when it is no version-1 record; an entry that is not one is left out (`complete` false).
 */
function parseRecord(serialized: string): { record: StoredRecord; complete: boolean } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return null;
  }
  const fields = jsonFields(parsed);
  const computers = jsonFields(fields?.computers);
  if (fields === null || fields.version !== 1 || computers === null || !Array.isArray(fields.grants)) return null;
  const grants = fields.grants.map(parseGrant);
  let complete = !grants.includes(null);
  const record: StoredRecord = {
    version: 1,
    grants: grants.filter((grant): grant is RateGrant => grant !== null),
    computers: {},
  };
  for (const [machineId, value] of Object.entries(computers)) {
    const computer = jsonFields(value);
    const events = parseEntries(computer?.events, parseEvent);
    const seen = parseEntries(computer?.seen, parseSeen);
    complete &&= events.complete && seen.complete;
    record.computers[machineId] = { events: events.entries, seen: seen.entries };
  }
  if (fields.pushComputers !== undefined) {
    const pushComputers = parseEntries(fields.pushComputers, (id) => (typeof id === 'string' ? id : null));
    complete &&= pushComputers.complete;
    record.pushComputers = pushComputers.entries;
  }
  return { record, complete };
}

/** Every announced event of one computer, once each. */
function machineAnnounced(machine: MachineEvents): Set<Announced> {
  const events = new Set<Announced>();
  for (const row of machine.rows.values()) {
    for (const announced of row.kinds.values()) events.add(announced);
    if (row.listCopy !== null) events.add(row.listCopy);
  }
  for (const attention of machine.attentions.values()) {
    for (const slot of attention.kinds.values()) events.add(slot.event);
    if (attention.first !== null) events.add(attention.first);
  }
  return events;
}

export class AnnouncedEvents {
  private readonly machines = new Map<string, MachineEvents>();
  /** The app's one rate limit for every route; its grants are stored with the record. */
  private readonly limiter = new NotificationRateLimiter();
  private storage: AnnouncedEventsStorage | null = null;
  /** Changed since the last write. */
  private unsaved = false;
  private writeQueued = false;
  /** The record held more than its bound at the last check (reported once per crossing). */
  private overBound = false;
  /** The stored record was read (`load`); until then deliveries wait in `waiting`, in the order they came. */
  private loaded = false;
  private readonly waiting: (() => void)[] = [];
  /** Copies that arrived and are not handled yet: the oldest holds back what the record forgets. */
  private readonly arrivals = new Set<{ at: number }>();
  /** The computers that accepted this phone's push registration, by id; kept with the record across launches. */
  private readonly pushComputers = new Set<string>();

  constructor(private readonly now: () => number = Date.now) {}

  /**
   * A copy of an event arrived now. Until it is handled (`whenLoaded`, which takes the arrival), the record
   * forgets nothing it kept at this moment, however long the copy waits.
   */
  arrive(): Arrival {
    const arrival = { at: this.now() };
    this.arrivals.add(arrival);
    return arrival;
  }

  /**
   * Runs `deliver` once the stored record is loaded: at once when it is, else when `load` has read it, after
   * the deliveries that came before (invariants I1 and I2). Every route calls `announce` only from here.
   * `arrival` is when the delivery's copy came (`arrive`, taken before any wait); it is let go after `deliver`.
   */
  whenLoaded(deliver: () => void, arrival: Arrival = this.arrive()): void {
    const run = (): void => {
      try {
        deliver();
      } finally {
        this.arrivals.delete(arrival);
      }
    };
    if (this.loaded) run();
    else this.waiting.push(run);
  }

  /**
   * The gate every route announces through: what `ask` asks for that the event has not had yet, which the
   * caller then has to announce (post its notification, play the sound); nothing when it had it all or was
   * seen on screen. Each announcement needs a grant of the rate limit (`rateLimited` when there is none, and
   * nothing new is remembered), except a row's notification within 20 s after its event's attention sound.
   */
  announce(event: EventIdentity, ask: AnnounceRequest): Announcement {
    const now = this.now();
    if (this.prune(now)) this.changed();
    const machine = this.machineEvents(event.machineId);
    let announced = this.find(machine, event, now);
    // The person saw this event on screen: no copy announces it, also after the person left the session.
    if (this.seenAlready(machine, event, now)) return NOTHING;
    const notification = ask.notification && announced?.channels.has('notification') !== true;
    // The notification's sound comes only with the notification; the attention sound may come on its own.
    const sound = ask.sound && (notification || !ask.notification) && announced?.channels.has('sound') !== true;
    if (!notification && !sound) return NOTHING;
    // A row's notification within 20 s after the attention sound of its event (the Sessions list named this row,
    // rule 2) is part of that sound. Anything else is a notification or sound the person gets, which the rate
    // limit counts: also the sound after a notification that came without it.
    const partOfSound =
      notification &&
      event.rowId.length > 0 &&
      announced !== null &&
      announced.channels.has('sound') &&
      now - announced.at < PER_SESSION_INTERVAL_MS;
    if (!partOfSound && !this.limiter.tryAcquire(`${event.machineId}\n${event.sessionId}`, now)) {
      // Linking the copy to its event (above) is kept; nothing is announced.
      this.checkBound(now);
      return { notification: false, sound: false, rateLimited: true };
    }
    announced ??= this.attach(machine, event, now, false);
    if (notification) announced.channels.add('notification');
    if (sound) announced.channels.add('sound');
    this.changed();
    this.checkBound(now);
    return { notification, sound, rateLimited: false };
  }

  /**
   * iOS showed this push itself: no request, a fact. Its event gets its notification, and its sound when the push
   * carried one, whatever the switches, the session open on screen or the rate limit say now, so no later copy
   * announces it again; that holds for an event seen on screen too. What iOS showed is an output the person got: the
   * first time the record learns of it, it counts against its session's slot and the overall limit, also past them
   * (`NotificationRateLimiter.count`), unless it is a banner within `PER_SESSION_INTERVAL_MS` after its event's
   * sound, which the row the Sessions list named links to it (rule 2): that banner is part of the sound. The same
   * presentation recorded again (`again`, or an event whose push was counted already) counts nothing more. Every
   * such push is kept, however they bunch: its computer sends each once and within its rate, which bounds them
   * (I3, the bound below).
   */
  shownBySystem(event: EventIdentity, sound: boolean, presentation: SystemPresentation = {}): void {
    const now = this.now();
    if (this.prune(now)) this.changed();
    // When the app learned of it; a clock set back meanwhile moved the arrival with the record's other times.
    const at = Math.min(presentation.at ?? now, now);
    const machine = this.machineEvents(event.machineId);
    let announced = this.find(machine, event, now);
    if (presentation.again !== true && announced?.pushShown !== true) {
      const partOfSound =
        event.rowId.length > 0 &&
        announced !== null &&
        !announced.channels.has('notification') &&
        announced.channels.has('sound') &&
        at - announced.at < PER_SESSION_INTERVAL_MS;
      if (!partOfSound) this.limiter.count(`${event.machineId}\n${event.sessionId}`, now);
    }
    announced ??= this.attach(machine, event, at, true);
    announced.pushShown = true;
    announced.channels.add('notification');
    if (sound) announced.channels.add('sound');
    this.changed();
    this.checkBound(now);
  }

  /**
   * A computer confirmed that it holds this phone's push token (`accepted`), or that it holds none (it removed the
   * token, or has no push route). Kept across launches with the record, ids only.
   */
  setPushAccepted(machineId: string, accepted: boolean): void {
    if (this.pushComputers.has(machineId) === accepted) return;
    if (accepted) this.pushComputers.add(machineId);
    else this.pushComputers.delete(machineId);
    this.changed();
  }

  /** Whether the computer accepted this phone's push registration, as far as the record knows. */
  acceptsPush(machineId: string): boolean {
    return this.pushComputers.has(machineId);
  }

  /** The computers that accepted this phone's push registration, as far as the record knows. */
  pushAcceptedBy(): string[] {
    return [...this.pushComputers];
  }

  /**
   * The session open on screen held this copy back: its event counts as seen, so no later copy announces it
   * while the record keeps that ("Seen on screen"). Takes no grant and adds no announced event.
   */
  seenOnScreen(event: EventIdentity): void {
    const now = this.now();
    if (this.prune(now)) this.changed();
    const machine = this.machineEvents(event.machineId);
    // A copy like any other: it links its row and its attention as rules 2 and 3 say.
    this.find(machine, event, now);
    const { sessionId, kind, rowId, episode } = event;
    if (kind !== null) {
      if (rowId.length > 0) {
        // The row's first kind takes the Sessions list's copy that named it.
        this.takeSeenListCopy(machine, event);
        this.addSeen(machine, rowSeenId(sessionId, rowId, kind, now));
      }
      if (episode !== null) this.seeKind(machine, sessionId, rowId, kind, episode, now);
    } else {
      // The Sessions list's copy is the named row's first event (its first kind once it has one) and its
      // attention's; it covers no other row.
      let named = '';
      if (rowId.length > 0 && !this.rowSeen(machine, sessionId, rowId)) {
        const row = machine.rows.get(rowKey(sessionId, rowId));
        const firstKind = row?.listCopy === null ? row.kinds.keys().next().value : undefined;
        this.addSeen(machine, rowSeenId(sessionId, rowId, firstKind ?? null, now));
        if (firstKind === undefined) named = rowId;
      }
      if (episode !== null) this.seeListCopy(machine, sessionId, episode, named, now);
    }
    this.changed();
  }

  /** The rows of a computer's feed as it was just read; the events of rows that left it stay for the window. */
  retainFeed(machineId: string, rows: readonly { sessionId: string; id: string }[]): void {
    const machine = this.machineEvents(machineId);
    const feed = new Set(rows.map((row) => rowKey(row.sessionId, row.id)));
    let moved = false;
    for (const key of machine.rows.keys()) moved ||= machine.feed.has(key) !== feed.has(key);
    for (const id of machine.seen.values()) {
      if (id.attention !== null) continue;
      const key = rowKey(id.sessionId, id.rowId);
      moved ||= machine.feed.has(key) !== feed.has(key);
    }
    machine.feed = feed;
    machine.feedRead = true;
    const now = this.now();
    if (this.prune(now) || moved) this.changed();
    this.checkBound(now);
  }

  /** The session list shows the session out of attention (or no longer lists it): its attention is over. */
  sessionLeftAttention(machineId: string, sessionId: string): void {
    const machine = this.machines.get(machineId);
    if (machine === undefined) return;
    const ended = machine.attentions.delete(sessionId);
    const unseen = machine.seen.delete(seenAttentionKey(sessionId));
    if (ended || unseen) this.changed();
  }

  /**
   * The computers on the phone (hidden ones included): a removed one's feed and session list are read no
   * more, so only the window keeps its events and what it saw on screen (rule 4). Its push acceptance goes: added
   * again, it is a new computer with a new id, so nothing asks for the old one.
   */
  keepComputers(machineIds: ReadonlySet<string>): void {
    let changed = false;
    for (const machineId of this.pushComputers) {
      if (machineIds.has(machineId)) continue;
      this.pushComputers.delete(machineId);
      changed = true;
    }
    for (const [machineId, machine] of this.machines) {
      if (machineIds.has(machineId)) continue;
      changed ||= machine.feed.size > 0 || machine.attentions.size > 0;
      machine.feed = new Set();
      machine.feedRead = true;
      machine.attentions.clear();
      for (const [key, id] of machine.seen) {
        if (id.attention === null || id.kind !== null) continue;
        machine.seen.delete(key);
        changed = true;
      }
    }
    if (this.prune(this.now()) || changed) this.changed();
    for (const [machineId, machine] of this.machines) {
      if (!machineIds.has(machineId) && machine.rows.size === 0 && machine.seen.size === 0) {
        this.machines.delete(machineId);
      }
    }
  }

  /** How many announced events the record holds now (each once, however many entries share it). */
  size(): number {
    if (this.prune(this.now())) this.changed();
    return this.events().size;
  }

  /** How many ids of events seen on screen the record keeps now for the computer `machineId`. */
  seenOnScreenIds(machineId: string): number {
    if (this.prune(this.now())) this.changed();
    return this.machines.get(machineId)?.seen.size ?? 0;
  }

  /**
   * Reads the record the last launch kept into this one, keeps it in `storage` from then on and then hands
   * over the deliveries that waited (`whenLoaded`). A stored record that cannot be read is reported and
   * written anew at the next change; the deliveries are handled all the same. Rejects with the first error a
   * delivery threw, after every other delivery ran.
   */
  async load(storage: AnnouncedEventsStorage): Promise<void> {
    let readable = true;
    try {
      const stored = await storage.read();
      if (stored !== null && !this.restore(stored)) readable = false;
    } catch {
      readable = false;
    }
    if (!readable) storage.failed('read');
    this.storage = storage;
    const now = this.now();
    // A clock set back since the stored record was written is noticed and stored here (`normalizeClock`).
    if (this.prune(now)) this.unsaved = true;
    this.queueWrite();
    this.checkBound(now);
    this.loaded = true;
    let failure: { error: unknown } | null = null;
    for (const deliver of this.waiting.splice(0)) {
      try {
        deliver();
      } catch (error) {
        failure ??= { error };
      }
    }
    if (failure !== null) throw failure.error;
  }

  /**
   * The announced event `event` is a copy of, or null. A row the Sessions list named takes that copy's event;
   * a copy that provably came in an attention links the attention's event of its kind to its row, and an
   * announced row to its attention (rules 2 and 3). The Sessions list's copy that named no row is matched to
   * no row.
   */
  private find(machine: MachineEvents, event: EventIdentity, now: number): Announced | null {
    const current = machine.attentions.get(event.sessionId);
    const attention = event.episode !== null && current?.key === event.episode ? current : undefined;
    if (event.kind === null) {
      // The Sessions list: the first event of the row it names; without a name, its own copy of the attention.
      if (event.rowId.length === 0)
        return attention?.kindless === true && attention.rowId === '' ? attention.first : null;
      const named = machine.rows.get(rowKey(event.sessionId, event.rowId));
      const rowFirst = named === undefined ? null : (named.listCopy ?? named.kinds.values().next().value ?? null);
      return rowFirst ?? (attention?.rowId === event.rowId ? attention.first : null);
    }
    // Without a row id: only the attention's event of its kind, in the attention it provably came in (rule 2).
    if (event.rowId.length === 0) return attention?.kinds.get(event.kind)?.event ?? null;
    const row = machine.rows.get(rowKey(event.sessionId, event.rowId));
    const own = row?.kinds.get(event.kind) ?? this.takeListCopy(machine, event, row, current, now);
    if (event.episode === null) return own;
    // The row came in this attention (rule 3); an announced row starts the attention's record when it has none.
    const into = attention ?? (own === null ? undefined : this.attentionFor(machine, event.sessionId, event.episode));
    if (into === undefined) return own;
    const slot = into.kinds.get(event.kind);
    if (slot === undefined) {
      if (own !== null) this.link(into, event.kind, event.rowId, own);
      return own;
    }
    // Another row's event of this kind in the same attention: this row is an event of its own.
    if (slot.rowId !== event.rowId && slot.rowId.length > 0) return own;
    const shared = slot.event;
    if (own !== null && own !== shared) merge(shared, own);
    this.rowEvent(machine, event.sessionId, event.rowId).kinds.set(event.kind, shared);
    this.link(into, event.kind, event.rowId, shared);
    return shared;
  }

  /**
   * The Sessions-list copy that named this row, which the row's first kind takes (rule 2): kept with the row,
   * or, for a row that provably came in the attention (rule 3), with that attention while it lasts. The row then
   * owns the copy's event, which is kept from now (rule 4). Null when there is none.
   */
  private takeListCopy(
    machine: MachineEvents,
    event: EventIdentity,
    row: Row | undefined,
    current: Attention | undefined,
    now: number,
  ): Announced | null {
    const kind = event.kind;
    if (kind === null) return null;
    const named = row?.listCopy ?? null;
    if (row !== undefined && named !== null) {
      row.listCopy = null;
      row.kinds.set(kind, named);
      if (current?.first === named && current.kindless) this.link(current, kind, event.rowId, named);
      else this.takenOver(named, now);
      return named;
    }
    // A row the record knows in another kind: its first event is that one, this kind is a second event.
    if (row !== undefined || this.rowSeen(machine, event.sessionId, event.rowId)) return null;
    const first = current?.first ?? null;
    if (current === undefined || first === null || !current.kindless || current.rowId !== event.rowId) return null;
    if (current.key !== event.episode) return null;
    this.rowEvent(machine, event.sessionId, event.rowId).kinds.set(kind, first);
    this.link(current, kind, event.rowId, first);
    return first;
  }

  /** A kind takes over the Sessions list's copy; its event can be much later, so it is kept from now (rule 4). */
  private takenOver(announced: Announced, now: number): void {
    announced.keptFrom = Math.max(announced.keptFrom, now);
    this.changed();
  }

  /**
   * Makes `announced` the attention's event of `kind`, owned by `rowId` ('' none); the attention's first event
   * when it has none and the event has a row.
   */
  private link(attention: Attention, kind: HostEventKind, rowId: string, announced: Announced): void {
    attention.kinds.set(kind, { rowId, event: announced });
    if (attention.first === announced && attention.kindless) {
      this.takenOver(announced, this.now());
      attention.kindless = false;
    }
    if (attention.first === null && rowId.length > 0) {
      attention.first = announced;
      attention.rowId = rowId;
    }
    this.changed();
  }

  /**
   * Records `event`'s first announcement at `at` (it was granted, or `presented`: a push iOS showed); `find` found
   * no event for it. A delivery without a row id outside any established attention is a new event every time
   * (rule 2): nothing is kept for it.
   */
  private attach(machine: MachineEvents, event: EventIdentity, at: number, presented: boolean): Announced {
    const announced: Announced = { channels: new Set(), at, keptFrom: at, presented, pushShown: false };
    const attention = event.episode === null ? undefined : this.attentionFor(machine, event.sessionId, event.episode);
    if (event.kind === null) {
      // The Sessions list's copy: the named row's first event, else the attention's own; its attention's first.
      if (event.rowId.length > 0) this.rowEvent(machine, event.sessionId, event.rowId).listCopy = announced;
      if (attention !== undefined) {
        attention.first = announced;
        attention.kindless = true;
        attention.rowId = event.rowId;
      }
      return announced;
    }
    if (event.rowId.length > 0) {
      this.rowEvent(machine, event.sessionId, event.rowId).kinds.set(event.kind, announced);
    }
    if (attention !== undefined && !attention.kinds.has(event.kind)) {
      this.link(attention, event.kind, event.rowId, announced);
    }
    return announced;
  }

  /** Whether any event of the row was seen on screen (the row the Sessions list named, or a kind of it). */
  private rowSeen(machine: MachineEvents, sessionId: string, rowId: string): boolean {
    return [null, ...HOST_EVENT_KINDS].some((kind) => machine.seen.has(seenRowKey(sessionId, rowId, kind)));
  }

  /**
   * The row's first kind takes the Sessions-list copy seen on screen that named the row (rule 2): true when there
   * was one, kept under the row's id, or with the session's attention seen for a row that provably came in it
   * (rule 3). Any first kind of the row ends the attention's hold on it.
   */
  private takeSeenListCopy(machine: MachineEvents, event: EventIdentity): boolean {
    const { sessionId, rowId, episode } = event;
    const named = machine.seen.delete(seenRowKey(sessionId, rowId, null));
    const attention = machine.seen.get(seenAttentionKey(sessionId));
    if (attention === undefined || attention.rowId !== rowId) return named;
    attention.rowId = '';
    return named || attention.attention === episode;
  }

  /** A copy of `kind` came provably in `episode` and was seen on screen: so is that attention's event of the kind. */
  private seeKind(
    machine: MachineEvents,
    sessionId: string,
    rowId: string,
    kind: HostEventKind,
    episode: string,
    now: number,
  ): void {
    const slot = machine.seen.get(seenKey({ sessionId, rowId, kind, attention: episode }));
    if (slot === undefined) this.addSeen(machine, { sessionId, rowId, kind, attention: episode, at: now });
    else if (slot.rowId.length === 0) slot.rowId = rowId;
  }

  /**
   * The Sessions list's copy of `episode` was seen on screen: that attention is seen, with the row the copy
   * named while no kind of it has come (`rowId`, '' none). A later attention of the session replaces its earlier
   * one.
   */
  private seeListCopy(machine: MachineEvents, sessionId: string, episode: string, rowId: string, now: number): void {
    const key = seenAttentionKey(sessionId);
    if (machine.seen.get(key)?.attention === episode) return;
    machine.seen.delete(key);
    this.addSeen(machine, { sessionId, rowId, kind: null, attention: episode, at: now });
  }

  /**
   * Whether `event` was seen on screen: its row and kind, or the row a seen Sessions-list copy named (as that
   * row's first kind); in the attention it provably came in, the attention's event of its kind (another row's
   * event of that kind is an event of its own, rule 3); for the Sessions list, its attention seen, or the row it
   * names. Nothing else: a seen copy never covers another row (rule 2). A copy found so is linked to what it is
   * the copy of.
   */
  private seenAlready(machine: MachineEvents, event: EventIdentity, now: number): boolean {
    const { sessionId, kind, rowId, episode } = event;
    if (kind === null) {
      const attention = machine.seen.get(seenAttentionKey(sessionId));
      if (episode !== null && attention?.attention === episode) return true;
      return rowId.length > 0 && this.rowSeen(machine, sessionId, rowId);
    }
    if (rowId.length > 0) {
      const exact = machine.seen.has(seenRowKey(sessionId, rowId, kind));
      if (exact || this.takeSeenListCopy(machine, event)) {
        this.seenRow(machine, event, now);
        // Seen again in an attention it now provably came in: its event of the kind there is seen too.
        if (episode !== null) this.seeKind(machine, sessionId, rowId, kind, episode, now);
        return true;
      }
    }
    if (episode === null) return false;
    const slot = machine.seen.get(seenKey({ sessionId, rowId, kind, attention: episode }));
    if (slot === undefined) return false;
    // Another row's event of this kind in the same attention: this row is an event of its own (rule 3).
    if (rowId.length > 0 && slot.rowId.length > 0 && slot.rowId !== rowId) return false;
    if (slot.rowId.length === 0) slot.rowId = rowId;
    this.seenRow(machine, event, now);
    return true;
  }

  /** Keeps the row's event of the copy's kind as seen (when the copy has a row) and notes the change. */
  private seenRow(machine: MachineEvents, event: EventIdentity, now: number): void {
    if (event.rowId.length > 0) this.addSeen(machine, rowSeenId(event.sessionId, event.rowId, event.kind, now));
    this.changed();
  }

  /** Keeps a new seen id as the newest; past `SEEN_ON_SCREEN_IDS` the oldest go first. */
  private addSeen(machine: MachineEvents, id: Seen): void {
    const key = seenKey(id);
    if (machine.seen.has(key)) return;
    machine.seen.set(key, id);
    trimSeen(machine.seen);
  }

  private machineEvents(machineId: string): MachineEvents {
    let machine = this.machines.get(machineId);
    if (machine === undefined) {
      machine = { rows: new Map(), feed: new Set(), feedRead: false, attentions: new Map(), seen: new Map() };
      this.machines.set(machineId, machine);
    }
    return machine;
  }

  /** The session's attention `key`; a different key is the session's next attention, which replaces it. */
  private attentionFor(machine: MachineEvents, sessionId: string, key: string): Attention {
    let attention = machine.attentions.get(sessionId);
    if (attention?.key !== key) {
      attention = { key, kinds: new Map(), first: null, kindless: false, rowId: '' };
      machine.attentions.set(sessionId, attention);
    }
    return attention;
  }

  private rowEvent(machine: MachineEvents, sessionId: string, rowId: string): Row {
    const key = rowKey(sessionId, rowId);
    let row = machine.rows.get(key);
    if (row === undefined) {
      row = { sessionId, rowId, kinds: new Map(), listCopy: null };
      machine.rows.set(key, row);
    }
    return row;
  }

  /** Now, or the arrival of the oldest copy still waiting to be handled, whichever is earlier (rule 4). */
  private horizon(now: number): number {
    let horizon = now;
    for (const arrival of this.arrivals) horizon = Math.min(horizon, arrival.at);
    return horizon;
  }

  /** Every time the record keeps (ms, the phone's clock), each passed to `visit`, which may change it. */
  private everyTime(visit: (time: number) => number): void {
    for (const announced of this.events()) {
      announced.at = visit(announced.at);
      announced.keptFrom = visit(announced.keptFrom);
    }
    for (const machine of this.machines.values()) for (const id of machine.seen.values()) id.at = visit(id.at);
    for (const arrival of this.arrivals) arrival.at = visit(arrival.at);
  }

  /**
   * The phone's clock was set back when a time the record keeps lies after now: every time it keeps (its
   * events, seen ids, waiting copies and the rate limit's grants) moves back by the latest one's lead, so their
   * order and spacing stay and the latest is now; nothing is forgotten early, and the change is stored with
   * the next write, so a later launch does not start the same minute over. True when it moved them.
   */
  private normalizeClock(now: number): boolean {
    let latest = this.limiter.latest();
    this.everyTime((time) => {
      latest = Math.max(latest, time);
      return time;
    });
    if (latest <= now) return false;
    const lead = latest - now;
    this.everyTime((time) => time - lead);
    this.limiter.moveBack(lead);
    return true;
  }

  /**
   * Rule 4: forgets each event neither in its row's feed nor within its window at the horizon, except a
   * session's current attention's first event, which stays with the attention; true if it forgot any or moved
   * the record's times (a clock set back, `normalizeClock`).
   */
  private prune(now: number): boolean {
    let changed = this.normalizeClock(now);
    const horizon = this.horizon(now);
    const kept = (announced: Announced, inFeed: boolean): boolean =>
      inFeed || horizon - announced.keptFrom <= ANNOUNCED_WINDOW_MS;
    for (const machine of this.machines.values()) {
      for (const [key, row] of machine.rows) {
        const inFeed = machine.feed.has(key);
        for (const [kind, announced] of row.kinds) {
          if (kept(announced, inFeed)) continue;
          row.kinds.delete(kind);
          changed = true;
        }
        if (row.listCopy !== null && !kept(row.listCopy, inFeed)) {
          row.listCopy = null;
          changed = true;
        }
        if (row.kinds.size === 0 && row.listCopy === null) machine.rows.delete(key);
      }
      for (const [sessionId, attention] of machine.attentions) {
        // The first event stays, with its kind and row, while the attention does: the Sessions list may see the
        // session enter it late.
        for (const [kind, slot] of attention.kinds) {
          if (slot.event === attention.first) continue;
          if (kept(slot.event, slot.rowId.length > 0 && machine.feed.has(rowKey(sessionId, slot.rowId)))) continue;
          attention.kinds.delete(kind);
          changed = true;
        }
        if (attention.first === null && attention.kinds.size === 0) machine.attentions.delete(sessionId);
      }
      for (const [key, id] of machine.seen) {
        // A current attention's id stays while the session is in it: the Sessions list may see it enter late.
        if (id.kind === null && id.attention !== null) continue;
        const inFeed = id.attention === null && machine.feed.has(rowKey(id.sessionId, id.rowId));
        if (inFeed || horizon - id.at <= ANNOUNCED_WINDOW_MS) continue;
        machine.seen.delete(key);
        changed = true;
      }
    }
    return changed;
  }

  /** Every announced event, once each. */
  private events(): Set<Announced> {
    const events = new Set<Announced>();
    for (const machine of this.machines.values())
      for (const announced of machineAnnounced(machine)) events.add(announced);
    return events;
  }

  /**
   * Invariant I3: the events within the window at the horizon that took a grant are at most what the rate limit
   * lets out from the window's start to now; per computer, those a push iOS showed started are at most what the
   * computer can send from `PUSH_TIME_TO_LIVE_MS + PUSH_RECORDING_MS` before the window's start to now; per
   * computer at most `FEED_RETENTION_ROWS` rows are kept only for their feed; and the events kept from a takeover
   * within the window whose first announcement came before it are at most one per session plus
   * `FEED_RETENTION_ROWS`. Past the bound nothing is forgotten; it is reported once, when the record passes it.
   */
  private checkBound(now: number): void {
    const windowStart = this.horizon(now) - ANNOUNCED_WINDOW_MS;
    let over = false;
    const allowed = announcementsWithin(now - windowStart);
    const sent = announcementsWithin(now - windowStart + PUSH_TIME_TO_LIVE_MS + PUSH_RECORDING_MS);
    let granted = 0;
    for (const machine of this.machines.values()) {
      let presented = 0;
      for (const announced of machineAnnounced(machine)) {
        if (announced.at < windowStart) continue;
        if (announced.presented) presented += 1;
        else granted += 1;
      }
      over ||= presented > sent;
      let keptForFeed = 0;
      for (const row of machine.rows.values()) {
        const events = row.listCopy === null ? [...row.kinds.values()] : [...row.kinds.values(), row.listCopy];
        if (events.some((announced) => announced.keptFrom < windowStart)) keptForFeed += 1;
      }
      over ||= keptForFeed > FEED_RETENTION_ROWS;
      const takenOver = new Map<Announced, string>();
      const note = (sessionId: string, announced: Announced): void => {
        if (announced.at < windowStart && announced.keptFrom >= windowStart) takenOver.set(announced, sessionId);
      };
      for (const row of machine.rows.values())
        for (const announced of row.kinds.values()) note(row.sessionId, announced);
      for (const [sessionId, attention] of machine.attentions) {
        for (const slot of attention.kinds.values()) note(sessionId, slot.event);
        if (attention.first !== null) note(sessionId, attention.first);
      }
      over ||= takenOver.size > new Set(takenOver.values()).size + FEED_RETENTION_ROWS;
    }
    over ||= granted > allowed;
    if (over && !this.overBound) this.storage?.failed('bound');
    this.overBound = over;
  }

  private changed(): void {
    this.unsaved = true;
    this.queueWrite();
  }

  /** Writes once after the current task, so the announcements of one batch of events cost one write. */
  private queueWrite(): void {
    const storage = this.storage;
    if (storage === null || !this.unsaved || this.writeQueued) return;
    this.writeQueued = true;
    void Promise.resolve()
      .then(() => {
        this.writeQueued = false;
        this.unsaved = false;
        return storage.write(this.serialize());
      })
      .catch(() => {
        this.unsaved = true;
        storage.failed('write');
      });
  }

  private serialize(): string {
    const now = this.now();
    this.prune(now);
    const record: StoredRecord = {
      version: 1,
      grants: [...this.limiter.saved(now)],
      computers: {},
      // Written only while there are any: absent reads as none, as in a record written before they were kept.
      ...(this.pushComputers.size > 0 ? { pushComputers: [...this.pushComputers] } : {}),
    };
    for (const [machineId, machine] of this.machines) {
      const entries = new Map<Announced, StoredEvent>();
      const entry = (sessionId: string, rowId: string, kind: HostEventKind | null, announced: Announced) => {
        let stored = entries.get(announced);
        if (stored === undefined) {
          stored = {
            sessionId,
            rowId,
            kind,
            attention: null,
            first: false,
            inFeed: rowId.length > 0 && machine.feed.has(rowKey(sessionId, rowId)),
            at: announced.at,
            keptFrom: announced.keptFrom,
            channels: [...announced.channels],
            ...(announced.presented ? { presented: true as const } : {}),
          };
          entries.set(announced, stored);
        }
        return stored;
      };
      for (const row of machine.rows.values()) {
        for (const [kind, announced] of row.kinds) entry(row.sessionId, row.rowId, kind, announced);
        if (row.listCopy !== null) entry(row.sessionId, row.rowId, null, row.listCopy);
      }
      for (const [sessionId, attention] of machine.attentions) {
        for (const [kind, slot] of attention.kinds)
          entry(sessionId, slot.rowId, kind, slot.event).attention = attention.key;
        if (attention.first === null) continue;
        // A first event no row keeps any more (a list copy past its row's window) keeps the row it named.
        const first = entry(sessionId, attention.rowId, null, attention.first);
        first.attention = attention.key;
        first.first = true;
      }
      const seen = [...machine.seen.values()].map((id) => ({
        ...id,
        inFeed: id.attention === null && machine.feed.has(rowKey(id.sessionId, id.rowId)),
      }));
      if (entries.size > 0 || seen.length > 0) {
        record.computers[machineId] = { events: [...entries.values()], seen };
      }
    }
    return JSON.stringify(record);
  }

  /** Merges a stored record into this one; what this launch announced or read already wins. False when unreadable. */
  private restore(serialized: string): boolean {
    const parsed = parseRecord(serialized);
    if (parsed === null) return false;
    this.limiter.restore(parsed.record.grants);
    for (const machineId of parsed.record.pushComputers ?? []) this.pushComputers.add(machineId);
    for (const [machineId, computer] of Object.entries(parsed.record.computers)) {
      const machine = this.machineEvents(machineId);
      for (const stored of computer.events) this.restoreEvent(machine, stored);
      this.restoreSeen(machine, computer.seen);
    }
    return parsed.complete;
  }

  private restoreEvent(machine: MachineEvents, stored: StoredEvent): void {
    let announced: Announced = {
      channels: new Set(stored.channels),
      at: stored.at,
      keptFrom: stored.keptFrom,
      presented: stored.presented === true,
      // The same push is not presented twice; a stored event a push started had its presentation counted.
      pushShown: stored.presented === true,
    };
    if (stored.rowId.length > 0) {
      const row = this.rowEvent(machine, stored.sessionId, stored.rowId);
      const current =
        stored.kind === null ? (row.listCopy ?? row.kinds.values().next().value) : row.kinds.get(stored.kind);
      if (current !== undefined && current !== null) {
        merge(current, announced);
        announced = current;
      } else if (stored.kind === null) row.listCopy = announced;
      else row.kinds.set(stored.kind, announced);
      if (!machine.feedRead && stored.inFeed) machine.feed.add(rowKey(stored.sessionId, stored.rowId));
    }
    if (stored.attention === null) return;
    const current = machine.attentions.get(stored.sessionId);
    // This launch already saw the session in a later attention: the stored one is over.
    if (current !== undefined && current.key !== stored.attention) return;
    const attention = current ?? this.attentionFor(machine, stored.sessionId, stored.attention);
    if (stored.kind !== null && !attention.kinds.has(stored.kind)) {
      attention.kinds.set(stored.kind, { rowId: stored.rowId, event: announced });
    }
    if (stored.first && attention.first === null) {
      attention.first = announced;
      attention.kindless = stored.kind === null;
      attention.rowId = stored.rowId;
    }
  }

  /**
   * The stored seen ids go before this launch's, which are newer; for the same id of a row or a kind the earlier
   * time and what either knows of it count, and this launch's attention of a session wins over a stored one.
   */
  private restoreSeen(machine: MachineEvents, stored: readonly StoredSeen[]): void {
    const seen = new Map<string, Seen>();
    for (const { inFeed, ...id } of stored) {
      seen.set(seenKey(id), id);
      if (!machine.feedRead && inFeed) machine.feed.add(rowKey(id.sessionId, id.rowId));
    }
    for (const [key, id] of machine.seen) {
      const old = seen.get(key);
      if (old === undefined || (old.attention !== null && old.kind === null)) {
        seen.delete(key);
        seen.set(key, id);
        continue;
      }
      old.at = Math.min(old.at, id.at);
      if (old.rowId.length === 0) old.rowId = id.rowId;
    }
    trimSeen(seen);
    machine.seen = seen;
  }
}

/** The app's one record, shared by the feed's notifications, the Sessions list's sound and the push route. */
export const announcedEvents = new AnnouncedEvents();
