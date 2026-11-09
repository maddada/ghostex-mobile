/**
 * A finished turn's messages between agents and answers, folded into its "Worked for" row
 * (gx-chat-core `folded_cards.rs`, where the user's decision is; desktop `FoldedCards` and
 * `folded_cards` in `completed_work_row.rs`): the rows marked `foldedIntoWork`, then the answered
 * questions, then the messages the work sent, drawn as a stack of one-line cards at the top of the
 * opened row and never after it.
 */

import { View } from 'react-native';

import type { Json, ProjectedMessage } from '../../rust/document';
import { QuestionExchangeCards } from '../cards';
import { SentAgentMessageCards } from './AgentMessageCards';
import { gapAbove } from './cardSpacing';
import { obj } from './json';
import { MessageRow } from './MessageRow';
import { FoldPlaceProvider } from './Disclosure';
import { useRowGap } from './messageSpacing';

const OUT_OF_FOLD = { inWorkFold: false, hideFileChanges: true };

export type FoldedSplit = {
  /** Drawn at the top of the opened row. */
  rows: ProjectedMessage[];
  questions: Json[];
  sent: Json[];
  /** What stays in the tail after the row. */
  kept: ProjectedMessage[];
  tailQuestions: Json[];
  tailSent: Json[] | undefined;
};

/** A turn's tail lists split into what folds into its row and what stays after it. */
export function splitFolded(
  inFold: boolean | undefined,
  artifacts: ProjectedMessage[],
  questions: Json[],
  sent: Json[] | undefined,
): FoldedSplit {
  if (inFold !== true) {
    return { rows: [], questions: [], sent: [], kept: artifacts, tailQuestions: questions, tailSent: sent };
  }
  return {
    rows: artifacts.filter((row) => row.foldedIntoWork === true),
    questions: questions ?? [],
    sent: sent ?? [],
    kept: artifacts.filter((row) => row.foldedIntoWork !== true),
    tailQuestions: [],
    tailSent: undefined,
  };
}

/** Whether the split folds anything into the row. */
export function foldsCards(split: FoldedSplit): boolean {
  return (
    split.rows.length > 0 || split.questions.length > 0 || split.sent.some((sent) => obj(obj(sent)?.card) !== null)
  );
}

/** The folded cards, one stack, each a row gap under the one above. */
export function FoldedCards({ split, columnGap = 0 }: { split: FoldedSplit; columnGap?: number }) {
  const rowGap = useRowGap();
  if (!foldsCards(split)) return null;
  const cardGap = gapAbove(true, true, columnGap, rowGap);
  return (
    <FoldPlaceProvider value={OUT_OF_FOLD}>
      <View style={{ gap: cardGap, minWidth: 0 }}>
        {split.rows.map((message) => (
          <MessageRow key={message.id} message={message} />
        ))}
        {split.questions.length > 0 ? <QuestionExchangeCards exchanges={split.questions} /> : null}
        <SentAgentMessageCards cards={split.sent} />
      </View>
    </FoldPlaceProvider>
  );
}
