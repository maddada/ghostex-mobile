/**
 * Keeping a one-click answer where the reader tapped it (desktop `answer_anchor.rs`).
 *
 * CDXC:SessionChat 2026-11-05 SEE-ALSO: The decision ("when i answer one of these the scroll jumps") is on desktop's `answer_anchor.rs`. The inverted list follows the newest row while the reader is within `autoscrollToTopThreshold` of the bottom, so the "You answered" card an answer adds slid the tapped pill up. A tap on a one-click answer, its Change or its own-answer Send turns that following off (`Transcript.tsx` keeps only `minIndexForVisible`, which holds the rows on screen still), until the reader drags the list, taps Scroll to bottom, or sends from the composer; a send goes back to the bottom when the list was there at the first tap, and a queued message leaves the hold alone.
 */

import { create } from 'zustand';
import { useTranscriptBottomStore } from './bottomStore';

/** `resume`: the list was at the bottom at the first tap of the hold (desktop `AnswerHold.resume`). */
type AnswerHold = { held: boolean; resume: boolean };

export const useAnswerHold = create<AnswerHold>(() => ({ held: false, resume: false }));

/** An answer was sent from inside the transcript: stop following the newest row. */
export function holdForAnswer(): void {
  if (useAnswerHold.getState().held) return;
  useAnswerHold.setState({ held: true, resume: !useTranscriptBottomStore.getState().awayFromBottom });
}

/** The reader moved the list: follow the newest row again near the bottom. */
export function releaseAnswerHold(): void {
  if (useAnswerHold.getState().held) useAnswerHold.setState({ held: false, resume: false });
}

/**
 * The chat box sent a message (not a queued one, which leaves the hold alone): the hold ends, and
 * the list goes back to the bottom when it was there at the first tap; a reader who had scrolled up
 * before answering keeps their place (desktop `follow_tail_for_send`). Returns whether a hold was
 * active, so the caller does not move the list again.
 */
export function endAnswerHoldForSend(): boolean {
  const { held, resume } = useAnswerHold.getState();
  if (!held) return false;
  releaseAnswerHold();
  if (resume) useTranscriptBottomStore.getState().jumpToBottom?.();
  return true;
}

/** The actions that answer a question in place in the transcript. */
export function holdsTranscript(type: string): boolean {
  return (
    type === 'inlineAnswer' ||
    type === 'inlineAnswerChange' ||
    type === 'inlineAnswerText' ||
    type === 'formSend' ||
    type === 'formSkipAll'
  );
}
