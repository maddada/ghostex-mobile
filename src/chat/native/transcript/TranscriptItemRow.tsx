/**
 * One transcript item (desktop `transcript.rs` `transcript_item_row`): a message, a summary-mode
 * turn, or a finished turn folded behind its "Worked for 2m 5s" summary (`completed_work_row.rs`,
 * `deferred_work.rs`). A kind this build does not know draws nothing.
 */

import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type {
  CompletedWorkItem,
  GroupedWorkItem,
  ProjectedMessage,
  SummaryItem,
  TranscriptItem,
} from '../../rust/document';
import { QuestionExchangeCards } from '../cards';
import {
  hiddenWork,
  SummaryTurnProvider,
  useChatLook,
  useNativeChatUi,
  useTranscriptEnv,
  useTranscriptFlags,
} from './context';
import { WorkCardStack } from '../cards/WorkCards';
import { DeferredNotice } from './DeferredNotice';
import { DisclosureBody, DisclosureHeading, FoldPlaceProvider } from './Disclosure';
import { cardEdge, ReadImageStrip } from './Images';
import { CompletedFilesFold } from './FileChanges';
import { gapAbove } from './cardSpacing';
import { useInnerGap, useRowGap } from './messageSpacing';
import { arr, obj } from './json';
import { MessageRow } from './MessageRow';
import { SentAgentMessageCards } from './AgentMessageCards';
import { WorkflowCards } from './WorkflowCard';
import { GbotCards } from './GbotCard';
import { FoldedCards, foldsCards, splitFolded } from './foldedCards';
import { useDisclosure } from './state';
import {
  SINGLE_LINE_CARD,
  SINGLE_LINE_HEADER_HEIGHT,
  SINGLE_LINE_TITLE,
  SingleLinePill,
  SingleLineTile,
  singleLinePressed,
  singleLineShell,
} from './singleLineCard';
import { GroupedWorkRow } from './quietWorkRows';
import { StatPills } from './statPills';
import { HiddenGroupedWorkRow } from './hiddenWork';

/** The space between the parts of a finished turn at Message spacing Default (desktop `PART_GAP` in completed_work_row.rs); Compact shrinks it (`innerGapOf`). */
const COMPLETED_PART_GAP = 10;
/** The space between a summary turn's parts at Message spacing Default (desktop `transcript.rs`). */
const SUMMARY_PART_GAP = 8;
const IN_WORK_FOLD = { inWorkFold: true, hideFileChanges: true };
const HIDE_FILES = { inWorkFold: false, hideFileChanges: true };

export const TranscriptItemView = memo(function TranscriptItemView({ item }: { item: TranscriptItem }) {
  const chatLook = useChatLook();
  switch (item.kind) {
    case 'message':
      return <MessageRow message={(item as { message: ProjectedMessage }).message} />;
    case 'summary':
      return <SummaryRow item={item as SummaryItem} />;
    case 'completed-work':
      return <CompletedWorkRow item={item as CompletedWorkItem} />;
    case 'grouped-work':
      // Agent work Quiet: no line, the work in the reply's time row (`hiddenWork.tsx`).
      return hiddenWork(chatLook) ? (
        <HiddenGroupedWorkRow item={item as GroupedWorkItem} />
      ) : (
        <GroupedWorkRow item={item as GroupedWorkItem} />
      );
    default:
      return null;
  }
});

function SummaryRow({ item }: { item: SummaryItem }) {
  const { disclosures } = useNativeChatUi();
  const { dispatch } = useTranscriptEnv();
  const { workCards } = useTranscriptFlags();
  const hasFinal = obj(item.final) !== null;
  // A running turn's "Active work" fold starts open and has a key of its own, so closing it holds
  // for that turn without closing the reply fold that replaces it (gx-chat-core `summary_mode_turns`).
  const [open, toggle] = useDisclosure(
    disclosures,
    hasFinal ? `summary:${item.id}` : `active-work:${item.id}`,
    item.latestReply === true || item.workOpen === true,
  );
  // The turn's messages holding a page card, a question form or a chart, drawn in full and never
  // folded; the folds below leave them out (gx-chat-core `content_rows`, where the user's decision
  // lives; desktop `transcript.rs`).
  const cards = item.cards ?? [];
  const content = new Set(cards.map((card) => card.id));
  const foldRows = (hasFinal ? [...(item.earlierReplies ?? []), item.final!] : item.work).filter(
    (message) => !content.has(message.id),
  );
  // The gap between the turn's parts shrinks at Message spacing Compact (`messageSpacing.ts`).
  const partGap = useInnerGap(SUMMARY_PART_GAP);
  const column = [styles.column, partGap !== SUMMARY_PART_GAP && { gap: partGap }];
  return (
    <View style={column}>
      <SummaryTurnProvider value={true}>
        <MessageRow message={item.user} />
      {(item.outcome ?? []).map((message) => (
        <MessageRow key={message.id} message={message} />
      ))}
      {cards.map((card) => (
        <MessageRow key={card.id} message={card} />
      ))}
      {(hasFinal || item.active) && foldRows.length > 0 ? (
        <>
          <DisclosureHeading label={hasFinal ? 'Agent reply' : 'Active work'} open={open} onToggle={toggle} />
          {/* The closed "Active work" fold keeps the pictures its rows read in view (gx-chat-core `read_images.rs`). */}
          {!open ? <ReadImageStrip images={item.readImages} inset={4} /> : null}
          {open ? (
            <View style={column}>
              {foldRows.map((message) => (
                <MessageRow key={message.id} message={message} />
              ))}
            </View>
          ) : null}
        </>
      ) : null}
      </SummaryTurnProvider>
      {/* The turn's work item cards, under the whole turn and outside its folds (`cards/WorkCards.tsx`). */}
      <WorkCardStack cards={workCards.byTurn[item.id] ?? []} dispatch={dispatch} />
    </View>
  );
}

function CompletedWorkRow({ item }: { item: CompletedWorkItem }) {
  const { workOpen, simple, dispatch } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const flags = useTranscriptFlags();
  const key = `work:${item.id}`;
  const [open, toggleRaw] = useDisclosure(disclosures, key, workOpen);
  const deferred = obj(item.deferred);
  const toggle = () => {
    // Opening a turn whose work is not in the document reads it on demand.
    if (!open && deferred !== null) dispatch({ type: 'loadWork', id: item.id, work: deferred as never });
    toggleRaw();
  };
  const deferredState = flags.deferredWork[item.id];
  // The turn's messages between agents and answers fold into the row (gx-chat-core
  // `folded_cards.rs`, where the user's decision is): drawn at the top of the opened row, never after it.
  const folded = splitFolded(item.cardsInFold, item.artifacts, item.questions, item.sentMessages);
  // Two one-line cards in a row are a row gap apart (`cardSpacing.ts`): the answered-question and
  // sent-message stacks sit that far under the "Worked for" fold, or under each other, when nothing
  // else comes between.
  const foldAbove = !open && (item.readImages ?? []).length === 0 && folded.kept.length === 0;
  const hasQuestions = arr(folded.tailQuestions).length > 0;
  const hasSent = arr(folded.tailSent).some((sent) => obj(obj(sent)?.card) !== null);
  const rowGap = useRowGap();
  const partGap = useInnerGap(COMPLETED_PART_GAP);
  return (
    <View style={[styles.completedColumn, partGap !== COMPLETED_PART_GAP && { gap: partGap }]}>
      <WorkSummary item={item} open={open} onToggle={toggle} />
      {open && foldsCards(folded) ? <FoldedCards split={folded} columnGap={partGap} /> : null}
      {/* The turn's files fold shows only while its card is open, collapsed, right under the card
          (gx-chat-core `turn_files_fold`, where the user's decision is; desktop `completed_work_row.rs`).
          A closed card leaves the files to its "N files" pill. */}
      {open ? (
        <CompletedFilesFold
          itemId={item.id}
          files={item.files}
          card={item.filesCard}
          label={simple ? item.simpleFilesLabel : item.filesLabel}
          deferred={item.deferred}
          notice={
            deferredState !== undefined ? (
              <DeferredNotice id={item.id} deferred={item.deferred} error={deferredState.error ?? ''} />
            ) : null
          }
        />
      ) : null}
      {open ? (
        <FoldPlaceProvider value={IN_WORK_FOLD}>
          <DisclosureBody onCollapse={toggle} label="Collapse completed work" rail="work">
            {deferredState !== undefined ? (
              <DeferredNotice id={item.id} deferred={item.deferred} error={deferredState.error ?? ''} />
            ) : null}
            {item.work.map((message, index) => {
              // A row that opens on its tool card right under one that closes on its own is a row
              // gap away from it, like any two one-line cards (`cardSpacing.ts`); the log's own gap
              // is 8 (`DisclosureBody`). Desktop `completed_work_row.rs` does the same.
              const above = index > 0 ? item.work[index - 1] : undefined;
              const cardFirst =
                obj(message.toolCard) !== null && (typeof message.text === 'string' ? message.text.trim() : '') === '';
              const margin = gapAbove(above !== undefined && obj(above.toolCard) !== null, cardFirst, 8, rowGap) - 8;
              return margin > 0 ? (
                <View key={message.id} style={{ marginTop: margin }}>
                  <MessageRow message={message} />
                </View>
              ) : (
                <MessageRow key={message.id} message={message} />
              );
            })}
          </DisclosureBody>
        </FoldPlaceProvider>
      ) : null}
      <FoldPlaceProvider value={HIDE_FILES}>
        {folded.kept.map((message) => (
          <MessageRow key={message.id} message={message} />
        ))}
        <QuestionExchangeCards exchanges={folded.tailQuestions} aboveIsCard={foldAbove} columnGap={partGap} />
        <SentAgentMessageCards cards={folded.tailSent} aboveIsCard={foldAbove || hasQuestions} columnGap={partGap} />
        {/* A stack of one-line cards too: a row gap under the card above it (desktop `spaced_tail`). */}
        <GbotCards cards={item.gbotCards} aboveIsCard={foldAbove || hasQuestions || hasSent} columnGap={partGap} />
        <WorkflowCards ids={item.workflows} />
        {item.final !== undefined && item.final !== null ? <MessageRow message={item.final} /> : null}
      </FoldPlaceProvider>
    </View>
  );
}

/**
 * The bar a finished turn folds behind (desktop `work_summary` in `completed_work_row.rs`): a clock
 * tile with a green check badge, "Worked for 2m 5s" and the turn's counts as pills (gx-chat-core `work_summary.rs`), so the closed
 * fold still says what happened; the whole bar opens and closes it, with no chevron.
 */
function WorkSummary({ item, open, onToggle }: { item: CompletedWorkItem; open: boolean; onToggle(): void }) {
  const { theme } = useTranscriptEnv();
  const stats = item.stats ?? [];
  const spoken = [item.label, ...stats.map((stat) => stat.label)].join(', ');
  // The closed card keeps the pictures its rows read in view, under its header past a hairline
  // (gx-chat-core `read_images.rs`, where the user's decision is); opened, each row shows its own.
  const pictures = !open && (item.readImages ?? []).length > 0;
  return (
    <View style={singleLineShell(theme)}>
      <Pressable
        disabled={!item.expandable}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={spoken}
        accessibilityState={{ expanded: open }}
        style={({ pressed }) => [styles.summary, pressed && singleLinePressed(theme)]}
      >
        <SingleLineTile glyph="clock" badge="check" />
        <Text style={[SINGLE_LINE_TITLE, { color: theme.foreground }]}>{item.label}</Text>
        {/* The count pills sit at the row's right end on one line (`statPills.tsx`). */}
        <StatPills stats={stats} />
      </Pressable>
      {pictures ? (
        <View style={[styles.cardPictures, { borderTopColor: theme.ink(SINGLE_LINE_CARD.borderAlpha) }]}>
          <ReadImageStrip images={item.readImages} inset={0} edge={cardEdge(theme)} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { gap: SUMMARY_PART_GAP, minWidth: 0 },
  completedColumn: { gap: COMPLETED_PART_GAP, minWidth: 0 },
  // Every one-line card's height and padding (`singleLineCard.ts`).
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: SINGLE_LINE_HEADER_HEIGHT,
    paddingHorizontal: SINGLE_LINE_CARD.paddingX,
  },
  cardPictures: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: SINGLE_LINE_CARD.paddingX,
    paddingVertical: 8,
  },
});
