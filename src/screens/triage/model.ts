/**
 * The folded triage's rules (the triage design): on the iPhone Duo's outer display the Sessions list starts with
 * the sessions that wait for the user, each with the quick answer that fits it. Free of React Native.
 *
 * - Waiting is what the list's dots say, less the finished turns: the blue attention dot of a wait for the
 *   user (a finished turn stays in the normal list only; an attention whose kind the computer does not send still
 *   counts, since it cannot tell the two apart), the red approval dot, and a pending question (an open question card
 *   from a computer that announces `awaitingAnswer`, or a counted question, the "has a question" rule of
 *   notifications and the Live Activity). A finished turn that still holds an approval or a question waits. The one
 *   waiting longest comes first.
 * - Which sessions: the list's own. The classic list shows one computer (its workspace and Space); the Unified list
 *   shows every computer the phone holds, narrowed by its filter and search, so there the triage spans them too, each
 *   session read by its own computer's rules and answered on it.
 * - What an entry offers comes from the session's chat: a stored approval card gets Allow and Deny; a permission
 *   notice gets its folded rows, labels and answers from the core. A question with options a single choice can answer
 *   gets its options. Questions buttons cannot answer completely (several choices, several questions, a written
 *   answer) and questions without a card offer to open the session. Approvals with neither a stored card nor folded
 *   rows are answered in the session. Every other waiting session gets the short replies.
 */

import { arr, asJson, isTrue, obj, str } from '../../chat/native/cards/json';
import {
  APPROVAL_ASK_FALLBACK,
  APPROVAL_TITLE_FALLBACK,
  approvalAnswer,
  foldedNoticeChoices,
} from '../../chat/native/cards/answers';
import type { UserAction } from '../../chat/rust/actions';
import type { ChatDocument } from '../../chat/rust/document';
import { TriageCopy } from '../../copy';
import type { HeaderPlacement } from '../../components/common/verticalBar/layout';
import {
  hasQuestion,
  type GhostexMobileSummary,
  type GhostexSession,
  type GhostexSummaryCapabilities,
} from '../../contract/mobileSummary';
import type { UnifiedView } from '../../contract/unified/build';

/** The blocking prompt and the stored card or notice the session's chat draws. */
export type TriageDocument = Pick<ChatDocument, 'prompt' | 'questionCard' | 'terminalNotice' | 'noticeVisible'>;

export type TriageEntry =
  | {
      kind: 'approval';
      title: string;
      detail: string;
      /** The command the approval runs; empty when the chat shows the question `ask` instead. */
      command: string;
      ask: string;
      tool: string;
      busy: boolean;
      reconnecting: boolean;
      approve: { label: string; action: UserAction };
      deny: { label: string; action: UserAction };
    }
  | { kind: 'approvalInSession' }
  | { kind: 'question'; header: string; text: string; options: string[]; busy: boolean; reconnecting: boolean }
  | {
      kind: 'openQuestion';
      /** Why buttons cannot answer it; null when the chat shows no card for it. */
      reason: 'multiSelect' | 'steps' | 'text' | null;
      header: string;
      text: string;
      /** How many questions the card asks in a row. */
      steps: number;
    }
  | { kind: 'reply' };

/**
 * Waits for the user: an approval, a question, or an attention that is not a finished turn. An attention
 * without a kind (a computer that does not send it) cannot be told from a finished turn and keeps counting.
 */
export function waitsForUser(session: GhostexSession, capabilities: GhostexSummaryCapabilities): boolean {
  return (
    session.awaitingApproval ||
    hasQuestion(session.pendingQuestionCount, capabilities.awaitingAnswer && session.awaitingAnswer) ||
    (session.activity === 'attention' && session.attentionKind !== 'finished')
  );
}

/**
 * The iPhone Duo folded: the header stands in the status band (or a side bar), which only the Duo's displays report,
 * and the window has no fold divisions, which the inner display always reports (flat or bent). Every other iPhone and
 * Android keep the header on top. Folded in the landscape that puts the camera at the bottom the system reports the
 * header on top as well, so that pose shows no triage.
 */
export function foldedOuterDisplay(
  placement: HeaderPlacement['kind'],
  divisions: readonly unknown[] | undefined,
): boolean {
  return placement !== 'top' && (divisions?.length ?? 0) === 0;
}

/** A waiting session with the computer it is on, read by that computer's capabilities. */
export type TriageWait<M> = { machine: M; session: GhostexSession; capabilities: GhostexSummaryCapabilities };

/**
 * The waiting ones of `candidates`, the one waiting longest first; a wait without a known start after them. The
 * attention list's Needs you section orders by it as well.
 */
export function longestWaitFirst<T extends { session: GhostexSession; capabilities: GhostexSummaryCapabilities }>(
  candidates: readonly T[],
): T[] {
  return candidates
    .filter(({ session, capabilities }) => waitsForUser(session, capabilities))
    .map((candidate, index) => {
      const since = Date.parse(candidate.session.attentionEnteredAt);
      return { candidate, index, since: Number.isNaN(since) ? Number.POSITIVE_INFINITY : since };
    })
    .sort((a, b) => (a.since === b.since ? a.index - b.index : a.since - b.since))
    .map(({ candidate }) => candidate);
}

/** The summary's waiting sessions (the classic list's), the one waiting longest first. */
export function triageSessions(summary: GhostexMobileSummary): GhostexSession[] {
  return longestWaitFirst(summary.sessions.map((session) => ({ session, capabilities: summary.capabilities }))).map(
    ({ session }) => session,
  );
}

/**
 * The Unified list's waiting sessions: every row its `view` holds (on any shelf, open or folded, as its filter and
 * search leave them), each by its own computer's capabilities, the one waiting longest first across computers.
 */
export function unifiedTriageWaits<M extends { id: string }>(
  view: UnifiedView<GhostexSession>,
  machines: readonly M[],
  summaryOf: (machineId: string) => GhostexMobileSummary | null,
): TriageWait<M>[] {
  const candidates: TriageWait<M>[] = [];
  for (const row of [
    ...view.drafts,
    ...view.pinned,
    ...view.active,
    ...view.working,
    ...view.snoozed,
    ...view.parked,
  ]) {
    const machine = machines.find((entry) => entry.id === row.machine);
    const summary = summaryOf(row.machine);
    if (machine === undefined || summary === null || row.session.source === undefined) continue;
    candidates.push({ machine, session: row.session.source, capabilities: summary.capabilities });
  }
  return longestWaitFirst(candidates);
}

export function triageEntry(
  session: GhostexSession,
  capabilities: GhostexSummaryCapabilities,
  document: TriageDocument | null,
): TriageEntry {
  const card = document?.questionCard;
  const prompt = obj(document?.prompt);
  // While the card restores an answer it draws no question (`QuestionCard`'s loading state).
  if (card?.visible === true && card.loading !== true) {
    const kind = str(prompt, 'kind');
    if (kind === 'approval') {
      const command = str(prompt, 'summary');
      return {
        kind: 'approval',
        title: card.approvalTitle || APPROVAL_TITLE_FALLBACK,
        detail: card.approvalDetail ?? '',
        command,
        ask: command.length > 0 ? '' : card.approvalAsk || APPROVAL_ASK_FALLBACK,
        tool: str(prompt, 'tool'),
        busy: card.busy,
        reconnecting: card.reconnecting === true,
        approve: { label: TriageCopy.allow, action: approvalAnswer(true) },
        deny: { label: TriageCopy.deny, action: approvalAnswer(false) },
      };
    }
    if (kind === 'question') {
      const questions = arr(prompt?.questions);
      const question = questions[card.questionIndex ?? 0];
      const header = str(question, 'header');
      const text = str(question, 'question');
      const options = arr(obj(question)?.options).map((option) => str(option, 'label'));
      // A single-select option with optional free text answers the question; the card's free text stays in the chat.
      const reason =
        questions.length > 1
          ? 'steps'
          : isTrue(question, 'multiSelect')
            ? 'multiSelect'
            : options.length === 0
              ? 'text'
              : null;
      if (reason !== null) return { kind: 'openQuestion', reason, header, text, steps: questions.length };
      return { kind: 'question', header, text, options, busy: card.busy, reconnecting: card.reconnecting === true };
    }
  }
  const notice = obj(document?.terminalNotice);
  if (document?.noticeVisible === true && notice !== null && str(notice, 'kind') === 'permissionPrompt') {
    const rows = foldedNoticeChoices(notice);
    const approve = obj(rows?.[0]);
    const deny = obj(rows?.[1]);
    if (rows?.length === 2 && approve !== null && deny !== null) {
      const approval = obj(notice.approval);
      const command = str(approval, 'codePreview') || str(approval, 'code') || str(notice, 'collapsedDetail');
      return {
        kind: 'approval',
        title: str(approval, 'title') || str(notice, 'title'),
        detail: str(approval, 'source'),
        command,
        ask: command.length > 0 ? '' : str(notice, 'detail'),
        tool: '',
        busy: card?.busy === true,
        reconnecting: card?.reconnecting === true,
        approve: { label: str(approve, 'collapsedLabel'), action: { type: 'answer', answer: asJson(approve.answer) } },
        deny: { label: str(deny, 'collapsedLabel'), action: { type: 'answer', answer: asJson(deny.answer) } },
      };
    }
  }
  if (session.awaitingApproval) return { kind: 'approvalInSession' };
  if (hasQuestion(session.pendingQuestionCount, capabilities.awaitingAnswer && session.awaitingAnswer)) {
    return { kind: 'openQuestion', reason: null, header: '', text: '', steps: 1 };
  }
  return { kind: 'reply' };
}

/**
 * What the computer says about a session's wait. An entry answered from the triage stays away while this is
 * unchanged (the computer's list follows the answer only on its next read) and its chat shows no new card; a
 * short-reply card reads its screen lines once per signature. The attention's kind is part of it: the computer keeps
 * the attention's id when a wait for the user turns into a finished turn (its question answered, the turn done); a
 * finished turn alone leaves the triage, one that still holds an approval or a question stays as a new wait.
 */
export function waitSignature(session: GhostexSession, capabilities: GhostexSummaryCapabilities): string {
  return [
    session.attentionEventId || session.attentionEnteredAt,
    session.attentionKind,
    session.activity,
    session.awaitingApproval,
    hasQuestion(session.pendingQuestionCount, capabilities.awaitingAnswer && session.awaitingAnswer),
  ].join('|');
}
