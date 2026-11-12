/**
 * The Notifications list as the desktop's Notifications panel draws it (`titlebar_notifications_panel.rs` in the
 * Ghostex repo): every reachable computer's feed rows merged newest first, in two groups, Unread then Read; each row's
 * card words; and the one dimmed line for a computer that is offline.
 *
 * CDXC:Notifications 2026-11-12 DECISION: User, on the phone's Notifications screen: "Please make this notifications
 * area match the one on desktop so I can mark a single notification as done ... It has to match desktop exactly in
 * all aspects". The list is the computer's notification feed, as on the desktop, no longer the phone's own one row per
 * session inbox (Needs you, Done, Failed): Unread and Read, a check that marks a row read (and clears a read one),
 * Mark all read and Clear all (Next unread was removed on 2026-11-12). Every change goes to the computer that owns the row, so it is the same on
 * every device. A phone has no "This computer", so it draws no All / This computer / Remote tabs: it shows what the
 * desktop's All tab shows, and like its Remote tab it names an offline computer in one dimmed line.
 *
 * SEE-ALSO: packages/gx-core/src/notification_feeds.rs (`merged_notification_feed_message`: the merge order and the
 * offline line; the phone runs no gx-core, so this follows it), apps/desktop/src/notification_feed/mod.rs
 * (the kind labels, the urgent kinds, `notification_feed_relative_time`), server/src/notification_feed/store.rs (the
 * rows, read state and `awaitingApproval`).
 *
 * Kept free of React Native so it is testable under `bun test`.
 */

import { NotificationsCopy } from '../copy';
import { isAccountRow, isSecurityRow, type FeedKind, type FeedRow } from './feedContract';

/** One computer's feed as the store holds it. */
export type PanelMachineFeed = {
  machineId: string;
  machineLabel: string;
  /** The computer answered its last read; an offline one's rows leave the list until it is back. */
  online: boolean;
  rows: readonly FeedRow[];
};

export type PanelRow = FeedRow & {
  /** Unique across computers. */
  key: string;
  machineId: string;
  /** The computer's name for the row's chip, only while more than one computer feeds the list. */
  machineLabel: string | null;
};

export type FeedPanel = {
  unread: PanelRow[];
  read: PanelRow[];
  /** Unread rows of every online computer (an open approval counts as unread), the bell's number. */
  unreadCount: number;
  /** "<Computer> is offline. ..." while an offline computer has rows waiting to come back. */
  offlineNotice: string | null;
};

export function panelRowKey(machineId: string, rowId: string): string {
  return `${machineId}\n${rowId}`;
}

/** The desktop's merge: every online computer's rows, newest first; Unread then Read. */
export function buildFeedPanel(feeds: readonly PanelMachineFeed[]): FeedPanel {
  const several = feeds.length > 1;
  const rows: PanelRow[] = [];
  const offline: string[] = [];
  for (const feed of feeds) {
    if (!feed.online) {
      if (feed.rows.length > 0) offline.push(feed.machineLabel);
      continue;
    }
    for (const row of feed.rows) {
      const panelRow: PanelRow = {
        ...row,
        key: panelRowKey(feed.machineId, row.id),
        machineId: feed.machineId,
        machineLabel: several ? feed.machineLabel : null,
      };
      rows.push(panelRow);
    }
  }
  rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const unread = rows.filter((row) => !row.read);
  return {
    unread,
    read: rows.filter((row) => row.read),
    unreadCount: unread.length,
    offlineNotice: offlineNotice(offline),
  };
}

function offlineNotice(names: readonly string[]): string | null {
  if (names.length === 0) return null;
  if (names.length === 1) return NotificationsCopy.feed.offlineOne(names[0]);
  return NotificationsCopy.feed.offlineMany(names.slice(0, -1).join(', '), names[names.length - 1]);
}

/** Red rows: an expiring reset, a message not sent and a failed run, and a session's open approval. */
export function feedRowUrgent(row: FeedRow): boolean {
  return (
    row.awaitingApproval === true ||
    row.kind === 'resetExpiring' ||
    row.kind === 'sendFailed' ||
    row.kind === 'failed'
  );
}

/** The kind's word in the card's footer, as the desktop's (`GpuiNotificationFeedKind::label`). */
export function feedKindLabel(kind: FeedKind): string {
  return NotificationsCopy.feed.kind[kind];
}

/** "Project · Finished" as the card's footer; the kind alone when the project name is unknown. */
export function feedRowMeta(row: FeedRow): string {
  const label = feedKindLabel(row.kind);
  return row.subtitle.length === 0 ? label : `${row.subtitle} · ${label}`;
}

/** The card's title: the session's title, "Session" without one. */
export function feedRowTitle(row: FeedRow): string {
  return row.title.length === 0 ? NotificationsCopy.untitledSession : row.title;
}

/** A row with no session to open (an account or a security row): a tap only marks it read, as on a remote computer. */
export function feedRowOpensNothing(row: FeedRow): boolean {
  return isAccountRow(row) || isSecurityRow(row);
}

/**
 * Whether the card's check (and Mark as Read, Clear) applies: not while the session's approval is open, which the
 * computer keeps unread until it is answered.
 */
export function feedRowCanBeDone(row: FeedRow): boolean {
  return row.awaitingApproval !== true;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** The desktop card's time: "just now", "5m", "2h", "yesterday", "3d", then "Nov 5" (UTC day, as the desktop's). */
export function feedRelativeTime(createdAt: string, now: number): string {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return '';
  const elapsed = Math.max(0, Math.floor((now - created) / 1000));
  if (elapsed < 60) return NotificationsCopy.feed.justNow;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m`;
  if (elapsed < 86_400) return `${Math.floor(elapsed / 3600)}h`;
  if (elapsed < 2 * 86_400) return NotificationsCopy.feed.yesterday;
  if (elapsed < 7 * 86_400) return `${Math.floor(elapsed / 86_400)}d`;
  const day = new Date(created);
  return `${MONTHS[day.getUTCMonth()]} ${day.getUTCDate()}`;
}
