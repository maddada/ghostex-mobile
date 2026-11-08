/**
 * The rows the Android persistent notification lists, built from each machine's mobile summary
 * (pure, so it can be tested without the native module; persistentNotification.ts feeds them to
 * GhostexForegroundService.kt, which also derives the "N need you · N working" summary line from them).
 *
 * CDXC:Notifications 2026-11-08 DECISION: User, on merging the iPhone bell (ghostex-mobile#29): "make android match
 * please, i dont want android and ios experience to diverge in terms of behavior". The notification states and orders
 * its sessions by the bell's inbox (`attentionRows.ts`): Needs you first (`attention`, the one waiting longest first,
 * the bell's `waitsForUser` rule), then Done (`done`, an unread finished turn) and Failed (`failed`, an unread failure),
 * newest first as the bell's sections, then the working ones, then the rest. A finished session the bell no longer
 * holds (opened, Clear Done, read on the computer) is no attention any more here either, so the notification and the
 * bell clear together, and its "need you" figure is the bell's number for the sessions the notification lists.
 */

import type { NotificationSessionRow } from '../../modules/ghostex-native/src/GhostexNative.types';
import { displayStatus, type GhostexMobileSummary, visibleSessions } from '../contract/mobileSummary';
import { sessionKey, type AttentionInbox } from '../notifications/attentionRows';

/**
 * CDXC:Coordinators 2026-11-02 DECISION: The phone's notification leaves out every coordinator thread; the coordinator itself still shows. User: "please in the android app notification we shouldn't show the sub threads of a coordinator listed there." A session is a thread when it carries its coordinator's ids, the same link the drawer nests it by (coordinatorTree.ts), and since the summary line counts these rows, threads drop out of "N working" too.
 */
function isCoordinatorThread(session: GhostexMobileSummary['sessions'][number]): boolean {
  return (session.coordinatorProjectId ?? '').length > 0 && (session.coordinatorSessionId ?? '').length > 0;
}

export function notificationRowsFromSummary(machineId: string, summary: GhostexMobileSummary): NotificationSessionRow[] {
  const projectNameById = new Map<string, string>();
  for (const project of summary.projects) {
    projectNameById.set(project.projectId, project.name ?? project.path ?? '');
  }
  // Side chats are reached from their main chat's Side chats pill, never listed (visibleSessions).
  return visibleSessions(summary.sessions)
    .filter((session) => (session.isLive || session.isSleeping) && !isCoordinatorThread(session))
    .map((session) => ({
      title: session.displayTitle.length > 0 ? session.displayTitle : session.sessionId,
      status: displayStatus(session),
      project: projectNameById.get(session.projectId) ?? '',
      machineId,
      sessionId: session.sessionId,
    }));
}

/** One computer's summary as the inventory store holds it. */
export type NotificationSource = { machineId: string; summary: GhostexMobileSummary };

/** A row's place in the notification: the bell's sections first, then working, then the rest. */
const STATUS_RANK: Record<string, number> = { attention: 0, done: 1, failed: 2, working: 3 };
const OTHER_RANK = 4;

/**
 * Every computer's rows, stated and ordered by the bell's inbox (see the decision at the top). Within the bell's
 * sections the inbox's order holds; working and the rest keep the computers' and their session lists' order.
 */
export function notificationRows(
  sources: readonly NotificationSource[],
  inbox: Pick<AttentionInbox, 'needsYou' | 'done' | 'failed'>,
): NotificationSessionRow[] {
  const bell = new Map<string, { status: 'attention' | 'done' | 'failed'; order: number }>();
  let order = 0;
  for (const row of inbox.needsYou) bell.set(row.key, { status: 'attention', order: order++ });
  for (const row of inbox.done) if (!bell.has(row.key)) bell.set(row.key, { status: 'done', order: order++ });
  for (const row of inbox.failed) if (!bell.has(row.key)) bell.set(row.key, { status: 'failed', order: order++ });
  const rows = sources.flatMap(({ machineId, summary }) => notificationRowsFromSummary(machineId, summary));
  return rows
    .map((row, index) => {
      const state = bell.get(sessionKey(row.machineId, row.sessionId));
      // An attention state the bell does not hold (a finish already opened or read) reads as idle.
      const status =
        state !== undefined ? state.status : row.status === 'attention' || row.status === 'done' ? 'idle' : row.status;
      const rank = STATUS_RANK[status] ?? OTHER_RANK;
      return { row: { ...row, status }, rank, order: state?.order ?? index };
    })
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.order - b.order))
    .map((entry) => entry.row);
}
