/**
 * Quiet View on the phone: a chat that reads as the conversation. The core names, by row, what
 * each quiet line holds (`document.quietView.stretches`, gx-chat-core `transcript/quiet_view.rs`,
 * where the user's decision is); this draws the line in the first row's place, nothing for the
 * other rows while it is shut, and, opened, every row as the full view draws it on a rail under
 * the line. What stays in view of the row that ends a line (its reply, pages, answers and messages
 * that were not sent) is drawn after it, open or shut. An answers card is its own shut line. Port of
 * desktop `native_chat/quiet_view.rs`; the lines are drawn as Agent work Reduced's quiet lines are
 * (`quietWork.tsx`).
 *
 * CDXC:SessionChat 2026-11-11 WHY:
 * The open state of a line lives in the chat's disclosure store under the line's key, so every
 * row of one line reads the same state and Find sees which lines are open, as it does for every
 * other fold.
 */

import { createContext, useContext, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import type { ProjectedMessage, QuietAnswers, QuietStretch, TranscriptItem } from '../../rust/document';
import { QuestionExchangeCards } from '../cards';
import { WorkCardStack } from '../cards/WorkCards';
import { SentAgentMessageCards } from './AgentMessageCards';
import { useNativeChatUi, useTranscriptEnv } from './context';
import { DisclosureBody, FoldPlaceProvider } from './Disclosure';
import { Glyph } from './icons';
import { MessageRow } from './MessageRow';
import { foldPart, keptParts, lineCards, type QuietLines } from './quietLines';
import { QuietLine, QuietStatusMark, type QuietSegment } from './quietWork';
import { useRowGap } from './messageSpacing';
import { useDisclosure } from './state';
import { BoxedToolCards } from './ToolCard';
import { TranscriptItemView } from './TranscriptItemRow';

/** The space between a shut line and the reply that ends it (desktop `LINE_TO_REPLY`). */
export const LINE_TO_REPLY = 8;
const HIDE_FILES = { inWorkFold: false, hideFileChanges: true };

/** The main transcript's lines; `null` outside Quiet View and in the subagent viewer. */
export const QuietLinesContext = createContext<QuietLines | null>(null);

/** Where row `index` stands among the lines, with each line's open state. */
export type QuietRowState = {
  line: QuietStretch | null;
  open: boolean;
  toggle(): void;
  after: QuietStretch | null;
  afterOpen: boolean;
  afterToggle(): void;
  /** A shut line draws nothing for this row. */
  hidden: boolean;
  /** The space the row ends with instead of the row gap, or `null` for the row gap. */
  bottom: number | null;
};

/** Row `index`'s place among the lines, or `null` for a row they leave alone. */
export function useQuietRow(index: number): QuietRowState | null {
  const lines = useContext(QuietLinesContext);
  const { disclosures } = useNativeChatUi();
  const line = lines?.rows.get(index) ?? null;
  const after = lines?.after.get(index) ?? null;
  const [open, toggle] = useDisclosure(disclosures, line?.key ?? '', line?.open === true);
  const [afterOpen, afterToggle] = useDisclosure(disclosures, after?.key ?? '', after?.open === true);
  if (line === null && after === null) return null;
  let hidden = false;
  let bottom: number | null = null;
  if (line !== null) {
    const tailRow = line.tail?.row;
    if (open) {
      // The rail runs on through the row gap to the next row of the line (`QuietRow`).
      if (tailRow !== index && index + 1 < line.end) bottom = 0;
    } else if (index !== line.start && tailRow !== index) {
      hidden = true;
    } else if (index === line.start && tailRow !== undefined && tailRow > index) {
      bottom = LINE_TO_REPLY;
    }
  }
  return { line, open, toggle, after, afterOpen, afterToggle, hidden, bottom };
}

/** A transcript item, with an answers card drawn shut as its own line under Quiet View. */
export function QuietItem({ item }: { item: TranscriptItem }) {
  const lines = useContext(QuietLinesContext);
  const message = item.kind === 'message' ? (item as { message: ProjectedMessage }).message : null;
  const card = message !== null ? lines?.answers.get(message.id) : undefined;
  if (message === null || card === undefined) return <TranscriptItemView item={item} />;
  return (
    <AnswersLine card={card}>
      <MessageRow message={message} />
    </AnswersLine>
  );
}

/** Row `index` under Quiet View: the line, the row on its rail when open, and what stays in view. */
export function QuietRow({
  item,
  index,
  state,
  rowGap,
}: {
  item: TranscriptItem;
  index: number;
  state: QuietRowState;
  rowGap: number;
}) {
  const lines = useContext(QuietLinesContext);
  const { dispatch } = useTranscriptEnv();
  const parts: { node: ReactNode; gap: number }[] = [];
  const { line, open } = state;
  if (line === null) {
    parts.push({ node: <QuietItem item={item} />, gap: 0 });
  } else {
    if (index === line.start) {
      parts.push({ node: <StretchLine line={line} open={open} onPress={state.toggle} />, gap: 0 });
    }
    const tail = line.tail !== undefined && line.tail.row === index ? line.tail : null;
    if (open) {
      const cards = index === line.start && lines !== null ? lineCards(lines, line) : [];
      const continues = tail === null && index + 1 < line.end;
      parts.push({
        node: (
          <DisclosureBody onCollapse={state.toggle} label="Collapse" rail="work">
            {cards.length > 0 ? <WorkCardStack cards={cards} dispatch={dispatch} /> : null}
            {/* Its tool calls are cards, as its "Message to …" cards are (`ToolCard.tsx`). */}
            <BoxedToolCards.Provider value>
              <QuietItem item={tail !== null ? foldPart(item, tail) : item} />
            </BoxedToolCards.Provider>
            {/* The rail runs on through the row gap to the line's next row. */}
            {continues ? <View style={{ height: Math.max(rowGap - 8, 0) }} /> : null}
          </DisclosureBody>
        ),
        gap: index === line.start ? 4 : 0,
      });
    }
    if (tail !== null) {
      const gap = parts.length === 0 ? 0 : open ? rowGap : LINE_TO_REPLY;
      parts.push({ node: <KeptTail item={item} tail={tail} />, gap });
    }
  }
  if (state.after !== null) {
    parts.push({
      node: <StretchLine line={state.after} open={state.afterOpen} onPress={state.afterToggle} />,
      gap: LINE_TO_REPLY,
    });
    const cards = lines !== null && state.afterOpen ? lineCards(lines, state.after) : [];
    if (cards.length > 0) {
      parts.push({
        node: (
          <DisclosureBody onCollapse={state.afterToggle} label="Collapse" rail="work">
            <WorkCardStack cards={cards} dispatch={dispatch} />
          </DisclosureBody>
        ),
        gap: 4,
      });
    }
  }
  return (
    <View style={styles.column}>
      {parts.map((part, at) => (
        <View key={at} style={part.gap > 0 ? { marginTop: part.gap } : null}>
          {part.node}
        </View>
      ))}
    </View>
  );
}

/** What of the row that ends a line stays in view after it (desktop `work_tail_parts`). */
function KeptTail({ item, tail }: { item: TranscriptItem; tail: NonNullable<QuietStretch['tail']> }) {
  const lines = useContext(QuietLinesContext);
  const rowGap = useRowGap();
  return (
    <View style={[styles.column, { gap: rowGap }]}>
      <FoldPlaceProvider value={HIDE_FILES}>
        {keptParts(item, tail).map((turn) => {
          const answers = turn.questions.length > 0 ? lines?.answers.get(`${turn.id}#questions`) : undefined;
          return (
            <View key={turn.id} style={[styles.column, { gap: rowGap }]}>
              {turn.artifacts.map((message) => (
                <MessageRow key={message.id} message={message} />
              ))}
              {answers !== undefined ? (
                <AnswersLine card={answers}>
                  <QuestionExchangeCards exchanges={turn.questions} />
                </AnswersLine>
              ) : (
                <QuestionExchangeCards exchanges={turn.questions} />
              )}
              <SentAgentMessageCards cards={turn.sent} />
              {turn.reply !== null ? <MessageRow message={turn.reply} /> : null}
            </View>
          );
        })}
      </FoldPlaceProvider>
    </View>
  );
}

/**
 * The quiet line itself: an icon (the messages icon on a line reports came in on, else the clock)
 * and the green check, its counts, then its time (desktop `quiet_view_line`). While the turn runs
 * the turning loader stands alone in their place.
 *
 * CDXC:SessionChat 2026-11-12 DECISION:
 * User, of "Working · 1 message sent · 3 tool calls so far" on the phone: "Show just the spinner
 * not spinner + icon." A running line shows the loader only; a finished one keeps its icon and
 * check. The desktop still draws the clock beside its loader.
 */
function StretchLine({ line, open, onPress }: { line: QuietStretch; open: boolean; onPress(): void }) {
  const time = line.time ?? '';
  const segments: QuietSegment[] = [{ text: line.text }];
  if (time.length > 0) segments.push({ text: ` ${time}` });
  return (
    <QuietLine
      icons={(tone) =>
        line.running === true ? (
          <QuietStatusMark mark="running" />
        ) : (
          <>
            <Glyph name={time.length > 0 ? 'messages' : 'clock'} size={13} color={tone} />
            <QuietStatusMark mark="done" />
          </>
        )
      }
      segments={segments}
      open={open}
      expandable
      onPress={onPress}
    />
  );
}

/** An answers card drawn shut as its own line, "You answered “…” · 7 answers"; opened, the card follows it. */
function AnswersLine({ card, children }: { card: QuietAnswers; children: ReactNode }) {
  const { disclosures } = useNativeChatUi();
  const [open, toggle] = useDisclosure(disclosures, card.key, card.open === true);
  const segments: QuietSegment[] = [{ text: card.text }];
  if ((card.count ?? '').length > 0) segments.push({ text: ` · ${card.count}` });
  return (
    <View style={[styles.column, { gap: 4 }]}>
      <QuietLine
        icons={(tone) => (
          <>
            <Glyph name="message-question" size={13} color={tone} />
            <QuietStatusMark mark="done" />
          </>
        )}
        segments={segments}
        open={open}
        expandable
        onPress={toggle}
      />
      {open ? children : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { minWidth: 0 },
});
