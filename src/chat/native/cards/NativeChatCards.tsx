/**
 * Everything the chat stacks between the transcript and the composer, in desktop's order
 * (`render_composer` in apps/desktop/src/app/native_chat/composer.rs):
 *
 * 1. the working strip,
 * 2. the composer-not-ready card, or a refused operation's error line,
 * 3. the task plan and the Subagents strip,
 * 4. the terminal notice,
 * 5. the async questions,
 * 6. the blocking question or approval.
 *
 * The incoming draft bar and the session note sit in the same stack on desktop but belong to the
 * composer. While a `question` prompt shows, desktop draws this stack instead of the composer; see
 * `questionReplacesComposer`.
 */

import { useRef } from 'react';
import { ScrollView, StyleSheet, useWindowDimensions } from 'react-native';

import type { RustChat } from '../../rust/useRustChat';
import { AgentFleetStrip, AgentTasksPanel } from './AgentPanels';
import { AsyncQuestionsCard } from './AsyncQuestionsCard';
import { ComposerNotReadyCard } from './ComposerNotReadyCard';
import { obj } from './json';
import { NoticeCard } from './NoticeCard';
import { QuestionCard } from './QuestionCard';
import type { CardHostAction } from './types';
import { WorkingStrip } from './WorkingStrip';

export type NativeChatCardsProps = {
  chat: RustChat;
  /** The app-shell actions a card offers (Terminal View, Switch account). Without it those buttons are not drawn. */
  onHostAction?: CardHostAction;
};

export function NativeChatCards({ chat, onHostAction }: NativeChatCardsProps) {
  const { height } = useWindowDimensions();
  const band = useRef<ScrollView>(null);
  const document = chat.state?.document ?? null;
  if (document === null) return null;
  const hasAny =
    typeof document.workingStrip?.label === 'string' ||
    obj(document.workingStrip?.presentation) !== null ||
    typeof document.operationError === 'string' ||
    obj(document.agentTasksPanel) !== null ||
    obj(document.agentFleetStrip) !== null ||
    (obj(document.terminalNotice) !== null && document.noticeVisible === true) ||
    typeof document.asyncQuestions?.question?.key === 'string' ||
    document.questionCard?.visible === true;
  if (!hasAny) return null;
  return (
    // A phone is short: several cards at once scroll inside a band so the transcript keeps its room.
    // When the band overflows, the newest card (the blocking question, nearest the composer) stays in view.
    <ScrollView
      ref={band}
      onContentSizeChange={() => band.current?.scrollToEnd({ animated: false })}
      style={[styles.band, { maxHeight: height * 0.6 }]}
      contentContainerStyle={styles.stack}
      keyboardShouldPersistTaps="handled"
      nestedScrollEnabled
    >
      <WorkingStrip document={document} />
      <ComposerNotReadyCard chat={chat} document={document} onHostAction={onHostAction} />
      <AgentTasksPanel chat={chat} document={document} />
      <AgentFleetStrip chat={chat} document={document} />
      <NoticeCard chat={chat} document={document} onHostAction={onHostAction} />
      <AsyncQuestionsCard chat={chat} document={document} />
      <QuestionCard chat={chat} document={document} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  band: {
    flexGrow: 0,
    width: '100%',
  },
  stack: {
    width: '100%',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
});
