/**
 * The relayed approval cards a coordinator's chat document carries (`relayedApprovals`, gx-chat-core
 * `extras/relayed_approvals.rs`), read without React so the transcript, the board and the pill
 * sheet agree on which card goes where. Drawn by `RelayedApprovalCard.tsx`.
 */

import type { ChatDocument } from '../../rust/document';
import { arr, isTrue, obj, str, type JsonRecord } from './json';

/** The relayed cards in the document, open ones first. */
export function relayedCards(document: ChatDocument | null): JsonRecord[] {
  return arr(document?.relayedApprovals)
    .map(obj)
    .filter((card): card is JsonRecord => card !== null && str(card, 'key').length > 0);
}

/** The open card of the thread `sessionId`, which its board row answers. */
export function openRelayedCardForThread(document: ChatDocument | null, sessionId: string): JsonRecord | null {
  if (sessionId.length === 0) return null;
  return relayedCards(document).find((card) => isTrue(card, 'open') && str(card, 'sessionId') === sessionId) ?? null;
}

/** Each card by the report row it is drawn under (`anchorId`), open or ended. */
export function relayedByReport(document: ChatDocument | null): { [messageId: string]: JsonRecord } {
  const byReport: { [messageId: string]: JsonRecord } = {};
  for (const card of relayedCards(document)) {
    const anchor = str(card, 'anchorId');
    if (anchor.length > 0 && byReport[anchor] === undefined) byReport[anchor] = card;
  }
  return byReport;
}

/**
 * The Approvals sheet's detail under its title: how many threads wait for the user, in the desktop
 * menu's words (`relayed_approval.rs`, "1 thread waiting for you").
 */
export function approvalsWaitingLine(document: ChatDocument | null): string {
  const count = relayedCards(document).filter((card) => isTrue(card, 'open')).length;
  return `${count} ${count === 1 ? 'thread' : 'threads'} waiting for you`;
}
