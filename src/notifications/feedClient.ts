/**
 * Reading and changing one computer's notification feed through gxserver's HTTP API over the warm link
 * (`POST /api/readNotificationFeed`, `POST /api/updateNotificationFeed`).
 * Read state is the computer's, so the list and the desktop bell share it; `markRead`
 * also acknowledges the session's attention on every client. The request function is passed in
 * (`FeedRpc`), so the client is testable under `bun test` with a fake transport.
 */

import { parseFeedState, type FeedSnapshot } from './feedContract';

export const READ_FEED_METHOD = 'readNotificationFeed';
export const UPDATE_FEED_METHOD = 'updateNotificationFeed';

/** gxserver's answer in the chat link's terms (`RpcAnswer`). */
export type FeedRpcAnswer = { result: unknown; error: null } | { result?: undefined; error: { message: string } };

/** One request to gxserver. */
export type FeedRpc = (method: string, params: Record<string, unknown>) => Promise<FeedRpcAnswer>;

export type FeedUpdate = { action: 'markRead' | 'markUnread' | 'dismiss'; notificationId: string };

/** Why a request gave no feed: the computer answered with an error, or with something the phone cannot read. */
export type FeedRequestFailure = 'refused' | 'unreadable';

/**
 * A failed request. It keeps only its category: the computer's own error text can carry paths or agent
 * output, and an error ends up in the app log, which can be exported.
 */
export class FeedRequestError extends Error {
  constructor(readonly category: FeedRequestFailure) {
    super(`notification feed request ${category}`);
  }
}

function snapshotOf(answer: FeedRpcAnswer): FeedSnapshot {
  if (answer.error !== null) throw new FeedRequestError('refused');
  const snapshot = parseFeedState(answer.result);
  if (snapshot === null) throw new FeedRequestError('unreadable');
  return snapshot;
}

export async function readFeed(rpc: FeedRpc): Promise<FeedSnapshot> {
  return snapshotOf(await rpc(READ_FEED_METHOD, {}));
}

/** Sends one change; the computer answers with the whole feed after it. */
export async function updateFeed(rpc: FeedRpc, update: FeedUpdate): Promise<FeedSnapshot> {
  return snapshotOf(await rpc(UPDATE_FEED_METHOD, { ...update }));
}

/**
 * Mark all read or Clear all on one computer (the desktop panel's header actions); the computer keeps an open
 * approval's row unread and in the list. Answers with the whole feed after it.
 */
export async function updateWholeFeed(rpc: FeedRpc, action: 'markAllRead' | 'clearAll'): Promise<FeedSnapshot> {
  return snapshotOf(await rpc(UPDATE_FEED_METHOD, { action }));
}

/**
 * Marks each of `notificationIds` read, one `markRead` per row (the computer's update takes one row), in order; the
 * feed after the last, or null when there was none to mark. The first refusal stops the rest and throws.
 */
export async function markRowsRead(rpc: FeedRpc, notificationIds: readonly string[]): Promise<FeedSnapshot | null> {
  let snapshot: FeedSnapshot | null = null;
  for (const notificationId of notificationIds) {
    snapshot = await updateFeed(rpc, { action: 'markRead', notificationId });
  }
  return snapshot;
}
