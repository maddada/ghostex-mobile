/**
 * Everything the chat stacks between the transcript and the composer, in desktop's order
 * (`render_composer` in apps/desktop/src/app/native_chat/composer.rs):
 *
 * 1. the composer-not-ready card, or a refused operation's error line,
 * 2. the terminal notice, then any secret requests,
 * 3. the async questions,
 * 4. the blocking question.
 *
 * An approval the agent waits on, the session's computer being offline, messages held behind a
 * failed model change and Ghostex Collab's held messages are rows of the dock above this stack
 * instead (gx-chat-core `extras/dock_approvals.rs`, `extras/dock_stack.rs`; `WorkCards.tsx`); who
 * is typing is a line inside the chat box (`composer/BoxNotes.tsx`), and a failed call the agent
 * keeps no record of is a row at the transcript's end (gx-chat-core `transcript/api_errors.rs`).
 *
 * The working card and its pills are not here: the screen draws them in their own row right above
 * this stack (`WorkingCard.tsx`), where desktop puts them first in the same stack.
 *
 * The incoming draft bar and the session note sit in the same stack on desktop but belong to the
 * composer. While a `question` prompt shows, desktop draws this stack instead of the composer; see
 * `questionReplacesComposer`.
 */

import { useRef } from 'react';
import { ScrollView, StyleSheet, type ScrollViewInstance } from 'react-native';

import type { ChatDocument } from '../../rust/document';
import { useChatViewSize } from '../chatPlacement';
import type { RustChat } from '../../rust/useRustChat';
import { AsyncQuestionsCard } from './AsyncQuestionsCard';
import { ComposerNotReadyCard } from './ComposerNotReadyCard';
import { arr, obj, str } from './json';
import { NoticeCard } from './NoticeCard';
import { CARD_BAND_SHARE, QuestionCard } from './QuestionCard';
import { SecretRequestCards } from './SecretRequestCard';
import type { CardHostAction } from './types';

/**
 * Whether a visible `terminalNotice` is an error/warning/wait issue banner (send failure, agent
 * error, terminal issue, usage limit, sign-in required, memory guard, etc.) rather than an
 * interactive dialog, picker, passthrough, side question, or approval prompt.
 *
 * Mirrors `is_error_terminal_notice` in `packages/gx-chat-core/src/questions/notice_tone.rs`.
 */
export function isErrorTerminalNotice(document: ChatDocument): boolean {
  if (document.noticeVisible !== true || document.approvalInDock === 'notice') return false;
  const notice = obj(document.terminalNotice);
  if (notice === null) return false;
  if (obj(notice.passthrough) !== null) return false;
  const presentation = obj(obj(notice.dialog)?.presentation);
  if (obj(presentation?.picker) !== null || obj(presentation?.sideQuestion) !== null) return false;
  const tone = str(notice, 'tone');
  if (tone === 'error' || tone === 'warning' || tone === 'wait') return true;
  if (tone === 'terminal' || tone === 'approval') return false;
  return obj(notice.dialog) === null;
}

/** Whether any error/issue banner shows above the Inbox dock (`NativeChatErrorCards`). */
export function chatErrorCardsShown(document: ChatDocument): boolean {
  return typeof document.operationError === 'string' || isErrorTerminalNotice(document);
}

/** Whether the non-error card stack below the dock/working card draws anything (`WorkingCard.tsx`). */
export function chatCardsShown(document: ChatDocument): boolean {
  const nonErrorNotice =
    obj(document.terminalNotice) !== null &&
    document.noticeVisible === true &&
    document.approvalInDock !== 'notice' &&
    !isErrorTerminalNotice(document);
  return (
    nonErrorNotice ||
    arr(document.secretRequests).length > 0 ||
    typeof document.asyncQuestions?.question?.key === 'string' ||
    (document.questionCard?.visible === true && document.approvalInDock !== 'prompt')
  );
}

export type NativeChatCardsProps = {
  chat: RustChat;
  /** The app-shell actions a card offers (Terminal View, Switch account, Pick model). Without it those buttons are not drawn. */
  onHostAction?: CardHostAction;
};

/**
 * Error and issue banners stacked ABOVE the coordinator Inbox dock: send/operation refusals first,
 * then error/warning/wait terminal notices (usage limits, agent errors, terminal issues).
 */
export function NativeChatErrorCards({
  chat,
  onHostAction,
  gapBelow = 0,
}: NativeChatCardsProps & { gapBelow?: number }) {
  const { height } = useChatViewSize();
  const band = useRef<ScrollViewInstance>(null);
  const revealMenu = useRef(false);
  const document = chat.state?.document ?? null;
  if (document === null || !chatErrorCardsShown(document)) return null;
  const errorNotice = isErrorTerminalNotice(document);
  /*
   * CDXC:AgentProviders 2026-11-28 WHY:
   * 12.5.0 smoke on the iPhone Duo: the out-of-usage card's "Choose what to do" showed 3 of its 7 rows. The band
   * shrinks to the room left above the chat box and the menu opened below what it showed, with nothing to say the rest
   * was there. Opening the menu now scrolls the band to its end, as the card band below already keeps its newest card
   * in view, so the rows come into view and the rest of the card scrolls back.
   */
  return (
    <ScrollView
      ref={band}
      onContentSizeChange={() => {
        if (!revealMenu.current) return;
        revealMenu.current = false;
        band.current?.scrollToEnd({ animated: true });
      }}
      style={[styles.band, { maxHeight: height * CARD_BAND_SHARE }]}
      contentContainerStyle={[styles.errorStack, { paddingBottom: gapBelow }]}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
    >
      <ComposerNotReadyCard chat={chat} document={document} onHostAction={onHostAction} />
      {errorNotice ? (
        <NoticeCard
          chat={chat}
          document={document}
          onHostAction={onHostAction}
          onActionMenuOpen={() => {
            revealMenu.current = true;
          }}
        />
      ) : null}
    </ScrollView>
  );
}

export function NativeChatCards({ chat, onHostAction }: NativeChatCardsProps) {
  const { height } = useChatViewSize();
  const band = useRef<ScrollViewInstance>(null);
  const document = chat.state?.document ?? null;
  if (document === null) return null;
  if (!chatCardsShown(document)) return null;
  const nonErrorNotice = document.approvalInDock !== 'notice' && !isErrorTerminalNotice(document);
  return (
    // A phone is short: several cards at once scroll inside a band so the transcript keeps its room.
    // When the band overflows, the newest card (the blocking question, nearest the composer) stays in view.
    <ScrollView
      ref={band}
      onContentSizeChange={() => band.current?.scrollToEnd({ animated: false })}
      style={[styles.band, { maxHeight: height * CARD_BAND_SHARE }]}
      contentContainerStyle={styles.stack}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
    >
      {/* Error/issue notices stack above the Inbox dock (`NativeChatErrorCards`); interactive
          dialogs, pickers and approvals not in the dock stay here. */}
      {nonErrorNotice ? <NoticeCard chat={chat} document={document} onHostAction={onHostAction} /> : null}
      <SecretRequestCards chat={chat} document={document} />
      <AsyncQuestionsCard chat={chat} document={document} />
      {document.approvalInDock === 'prompt' ? null : <QuestionCard chat={chat} document={document} />}
    </ScrollView>
  );
}

/**
 * CDXC:SessionChat 2026-10-23 DECISION:
 * User: "please make the gap at B match the gap at A (for all similar cases also for cards that appear above the chat view composer": every gap in the stack above the composer is the stack's 8px gap. The composer brings 6 of the gap under the band (`NativeComposer.tsx` `root.paddingTop`), the band the rest. Desktop: `WORKING_CARD_GAP` in apps/desktop/src/app/native_chat/working_card.rs.
 */
export const STACK_GAP = 8;
export const COMPOSER_TOP_PADDING = 6;

const styles = StyleSheet.create({
  band: {
    flexGrow: 0,
    width: '100%',
  },
  errorStack: {
    width: '100%',
    gap: STACK_GAP,
    paddingHorizontal: 12,
    paddingTop: STACK_GAP,
  },
  stack: {
    width: '100%',
    gap: STACK_GAP,
    paddingHorizontal: 12,
    paddingTop: STACK_GAP,
    paddingBottom: STACK_GAP - COMPOSER_TOP_PADDING,
  },
});
