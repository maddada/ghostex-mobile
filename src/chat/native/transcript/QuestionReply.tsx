/**
 * A one-click question's Reply sheet: the reader's own words go as its answer (`inlineAnswerText`;
 * desktop `reply_popover.rs`, CDXC:SessionChat 2026-11-05 DECISION on `open_question_reply`). The
 * pill's ✎ segment (`InlineAnswers.tsx`) and the question's own Q-tag pill (`Markdown.tsx`) open it;
 * one sheet per transcript draws it (`Transcript.tsx`). `form` is null when the Q-tag opened it,
 * and the core finds the question by its tag.
 */

import { create } from 'zustand';

import { useTranscriptEnv } from './context';
import { ReplySheet } from './ReplySheet';

/** `item` and `key` when it answers a coordinator's work item ask (the dock's Reply). */
export type QuestionReplyTarget = { form: string | null; tag: string; item?: string; key?: string };

const useQuestionReply = create<{ target: QuestionReplyTarget | null }>(() => ({ target: null }));

export function openQuestionReply(target: QuestionReplyTarget): void {
  if (target.tag.length > 0) useQuestionReply.setState({ target });
}

function closeQuestionReply(): void {
  useQuestionReply.setState({ target: null });
}

export function QuestionReplyHost() {
  const { dispatch } = useTranscriptEnv();
  const target = useQuestionReply((store) => store.target);
  return (
    <ReplySheet
      quote={target !== null ? '' : null}
      question={target?.tag ?? ''}
      onClose={closeQuestionReply}
      onReply={(_, reply) => {
        closeQuestionReply();
        const text = reply.trim();
        if (target === null || text.length === 0) return;
        // A work item ask: the words are its answer, recorded once and sent as "W7 Q12: words".
        if (target.item !== undefined && target.item.length > 0) {
          dispatch({
            type: 'coordinatorBoardAnswer',
            op: 'reply',
            key: target.key ?? '',
            item: target.item,
            ask: target.tag,
            label: text,
            text: `${target.item} ${target.tag}: ${text}`,
          } as never);
          return;
        }
        dispatch({
          type: 'inlineAnswerText',
          ...(target.form !== null ? { form: target.form } : {}),
          tag: target.tag,
          text,
        });
      }}
    />
  );
}
