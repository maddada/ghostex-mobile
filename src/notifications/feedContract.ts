/**
 * The computer's notification feed as the phone reads it: `POST /api/readNotificationFeed` and the
 * `updateNotificationFeed` answer (both return the whole feed state). Wire inventory:
 * `server/src/notification_feed/store.rs` (`item_from_row`) and
 * `packages/shared/notification-feed/notification-feed-contract.ts` in the Ghostex repo.
 *
 * The parser is the phone's trust boundary for this data. It keeps only what the attention list and
 * the event mapper use. The row's message text (`body`) is kept for the attention list's rows only, which show it as
 * the desktop's bell does; no notification, Live Activity, persistent notification or log may show it.
 *
 * CDXC:Notifications 2026-11-08 DECISION: User, on the phone's bell: "make notification look like the one on desktop
 * please". The desktop's card shows the row's body ("2 questions are waiting for your answers: …"), so the phone's
 * list rows do too; this supersedes the 2026-10-30 rule that kept the body off the phone entirely. It stays off
 * every surface outside the app's own list.
 * A row of a kind the phone does not know is skipped, never shown or notified.
 * Kept free of React Native so it is testable under `bun test`.
 */

export const FEED_KINDS = [
  'finished',
  'needsInput',
  'bell',
  'custom',
  'resetExpiring',
  'resetRedeemed',
  // The computer's kind for an agent that ended with an error: after its five quick retries of a transient error, at
  // once for a permanent one or a program error (the session's state stays), never on a user abort. A computer that
  // predates it never sends it.
  'failed',
  // A chat message the computer could not send for good ("Not sent" on the desktop's bell, drawn red). A row in the
  // list only: no notification, as on the desktop, and the computer pushes none. An unread one stays beside the
  // session's newer rows and goes read when the failure is dealt with. A computer that predates it never sends it.
  'sendFailed',
] as const;

export type FeedKind = (typeof FEED_KINDS)[number];

/**
 * The most rows a computer's feed holds: the host keeps its 40 newest rows and deletes older ones, read or
 * unread (`NOTIFICATION_FEED_RETENTION_LIMIT`, `server/src/notification_feed/store.rs`); it also deletes a
 * session's unread row when it writes the session's next one, and every row on Clear All.
 */
export const FEED_RETENTION_ROWS = 40;

/** Account rows (banked usage resets) belong to no session: their `sessionId` is this prefix plus the account id. */
export const ACCOUNT_SESSION_PREFIX = 'account:';

export type FeedRow = {
  /**
   * The row id, never reused (the host writes a new UUID per row). A session's new attention gets a new row
   * (the host drops its older unread one); the host also changes an unread row's `kind` in place (`finished`
   * to `needsInput`, see `eventSource.ts`).
   */
  id: string;
  projectId: string;
  sessionId: string;
  kind: FeedKind;
  /** The session title when the row was written; for an account row the host's own one-line notice. */
  title: string;
  /** The project name when the row was written; for an account row the account. */
  subtitle: string;
  /** The row's message text (the desktop card's body); '' when it has none. Shown only in the attention list. */
  body?: string;
  /** The agent icon slug the host overlays (claude, codex, ...); '' when unknown. */
  agentName: string;
  /** ISO time the row was written. */
  createdAt: string;
  read: boolean;
  /** Present on account rows only. */
  accountId?: string;
};

export type FeedSnapshot = { readonly rows: readonly FeedRow[] };

function text(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key];
  return typeof value === 'string' ? value : undefined;
}

/** One wire row, or null when it lacks an identity, a time or a known kind. */
export function parseFeedRow(value: unknown): FeedRow | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  // The cast holds: `value` is a non-null object that is no array; every field taken from it is checked below.
  const raw = value as Record<string, unknown>;
  const id = text(raw, 'id');
  const projectId = text(raw, 'projectId');
  const sessionId = text(raw, 'sessionId');
  const sentKind = text(raw, 'kind');
  const kind = FEED_KINDS.find((known) => known === sentKind);
  const createdAt = text(raw, 'createdAt');
  if (!id || projectId === undefined || !sessionId || !createdAt || Number.isNaN(Date.parse(createdAt))) return null;
  if (kind === undefined) return null;
  const accountId = text(raw, 'accountId');
  return {
    id,
    projectId,
    sessionId,
    kind,
    title: text(raw, 'title') ?? '',
    subtitle: text(raw, 'subtitle') ?? '',
    body: text(raw, 'body')?.trim() ?? '',
    agentName: text(raw, 'agentName')?.trim() ?? '',
    createdAt,
    read: raw.read === true,
    ...(accountId !== undefined && accountId.length > 0 ? { accountId } : {}),
  };
}

/** The feed state's rows (newest first, as the host sends them), or null when `value` is no feed state. */
export function parseFeedState(value: unknown): FeedSnapshot | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  // The cast holds: `value` is a non-null object that is no array; `items` is checked to be an array next.
  const items = (value as Record<string, unknown>).items;
  if (!Array.isArray(items)) return null;
  const rows: FeedRow[] = [];
  for (const item of items) {
    const row = parseFeedRow(item);
    if (row !== null) rows.push(row);
  }
  return { rows };
}

/** An account row: no session behind it, never an OS notification, a tap only marks it read. */
export function isAccountRow(row: FeedRow): boolean {
  return row.accountId !== undefined || row.sessionId.startsWith(ACCOUNT_SESSION_PREFIX);
}
