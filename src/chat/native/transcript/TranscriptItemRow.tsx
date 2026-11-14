/**
 * One transcript item (desktop `transcript.rs` `transcript_item_row`): a message, a summary-mode
 * turn, or a finished turn folded behind its "Worked for 2m 5s" summary (`completed_work_row.rs`,
 * `deferred_work.rs`). A kind this build does not know draws nothing.
 */

import { memo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type {
  CompletedWorkItem,
  GroupedWorkItem,
  ProjectedMessage,
  QuietTurnLook,
  SummaryItem,
  TranscriptItem,
  WorkStat,
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
import { DeferredNotice } from './DeferredNotice';
import { DisclosureBody, DisclosureHeading, FoldPlaceProvider } from './Disclosure';
import { cardEdge, ReadImageStrip } from './Images';
import { CompletedFilesFold } from './FileChanges';
import { gapAbove } from './cardSpacing';
import { useCardStackGap, useInnerGap } from './messageSpacing';
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
import { SummaryQuietRun } from './quietView';
import { QuietTurnMark, useQuietTurn } from './quietTurn';
import { StatPills, statGlyph } from './statPills';
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
  const hasFinal = obj(item.final) !== null;
  // A running turn's "Active work" fold starts open and has a key of its own, so closing it holds
  // for that turn without closing the reply fold that replaces it (gx-chat-core `summary_mode_turns`).
  const [open, toggle] = useDisclosure(
    disclosures,
    hasFinal ? `summary:${item.id}` : `active-work:${item.id}`,
    item.latestReply === true || item.workOpen === true,
  );
  const [earlierOpen, toggleEarlier] = useDisclosure(disclosures, `summary-earlier:${item.id}`, false);
  // The turn's pages and charts, and the questions still waiting on the reader, drawn in full and
  // never folded; the folds below leave them out (gx-chat-core `summary_cards`, where the user's
  // decision lives; desktop `transcript.rs`).
  const cards = item.cards ?? [];
  const content = new Set(cards.map((card) => card.id));
  const earlier = (item.earlierReplies ?? []).filter((message) => !content.has(message.id));
  // The newest reply, or a running turn's work, keeps the earlier replies and the reports between
  // them behind one closed line ("2 earlier replies · 1 report", gx-chat-core `turns::earlier_label`).
  const label = item.earlierLabel ?? '';
  const earlierLine =
    label.length > 0 && earlier.length > 0 ? (
      <>
        <DisclosureHeading label={label} open={earlierOpen} onToggle={toggleEarlier} />
        {earlierOpen ? (
          <View style={styles.column}>
            {earlier.map((message) => (
              <MessageRow key={message.id} message={message} />
            ))}
          </View>
        ) : null}
      </>
    ) : null;
  const final = hasFinal && !content.has(item.final!.id) ? [item.final!] : [];
  const foldRows = hasFinal
    ? earlierLine !== null
      ? final
      : [...earlier, ...final]
    : item.work.filter((message) => !content.has(message.id));
  const lines = item.workLines ?? [];
  // The partGap between the turn's parts shrinks at Message spacing Compact (`messageSpacing.ts`).
  const partGap = useInnerGap(SUMMARY_PART_GAP);
  const column = [styles.column, partGap !== SUMMARY_PART_GAP && { gap: partGap }];
  // The running work as Quiet View draws it (gx-chat-core `quiet_view::summary_work_lines`): what
  // the reader reads in full, each run of the rest as one counted line.
  const workParts = (): ReactNode[] => {
    const parts: ReactNode[] = [];
    let at = 0;
    while (at < item.work.length) {
      const line = lines.find((candidate) => candidate.start === at);
      if (line !== undefined) {
        const end = Math.min(Math.max(line.end, at + 1), item.work.length);
        const rows = item.work.slice(at, end).filter((message) => !content.has(message.id));
        parts.push(<SummaryQuietRun key={line.key} line={line} rows={rows} />);
        at = end;
      } else {
        const message = item.work[at];
        if (!content.has(message.id)) parts.push(<MessageRow key={message.id} message={message} />);
        at += 1;
      }
    }
    return parts;
  };
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
      {!hasFinal ? earlierLine : null}
      {(hasFinal || item.active) && (foldRows.length > 0 || (hasFinal && earlierLine !== null)) ? (
        <>
          <DisclosureHeading label={hasFinal ? 'Agent reply' : 'Active work'} open={open} onToggle={toggle} />
          {/* The closed fold keeps the pictures its rows read in view (gx-chat-core `read_images.rs`). */}
          {!open ? <ReadImageStrip images={item.readImages} inset={4} /> : null}
          {open ? (
            <View style={column}>
              {hasFinal ? earlierLine : null}
              {hasFinal || lines.length === 0
                ? foldRows.map((message) => <MessageRow key={message.id} message={message} />)
                : workParts()}
            </View>
          ) : null}
        </>
      ) : null}
      </SummaryTurnProvider>
      {/* Work item cards stay out of the Summary view (gx-chat-core `summary_cards`). */}
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
  const rowGap = useCardStackGap(); // The rail's gap on an opened Quiet View line.
  const partGap = useInnerGap(COMPLETED_PART_GAP);
  // Inside an opened Quiet View line (gx-chat-core `QuietTurnLook`, where the user's decision is):
  // its calls straight on that line's rail with no card, or its card titled by its calls.
  const look = useQuietTurn();
  const flat = look?.flat === true;
  const shown = open || flat;
  const log = item.work.map((message, index) => {
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
  });
  const notice =
    deferredState !== undefined ? (
      <DeferredNotice id={item.id} deferred={item.deferred} error={deferredState.error ?? ''} />
    ) : null;
  return (
    <View style={[styles.completedColumn, partGap !== COMPLETED_PART_GAP && { gap: partGap }]}>
      {flat ? (
        (look?.marks ?? []).map((mark) => (
          <View key={`mark:${mark.at}`} style={styles.flatMark}>
            <QuietTurnMark text={mark.text} />
          </View>
        ))
      ) : (
        <WorkSummary item={item} open={open} onToggle={toggle} look={look} />
      )}
      {shown && foldsCards(folded) ? <FoldedCards split={folded} columnGap={partGap} /> : null}
      {/* The turn's files fold shows only while its card is open, collapsed, right under the card
          (gx-chat-core `turn_files_fold`, where the user's decision is; desktop `completed_work_row.rs`).
          A closed card leaves the files to its "N files" pill. */}
      {shown ? (
        <CompletedFilesFold
          itemId={item.id}
          files={item.files}
          card={item.filesCard}
          label={simple ? item.simpleFilesLabel : item.filesLabel}
          deferred={item.deferred}
          notice={notice}
        />
      ) : null}
      {/* On an opened Quiet View line's rail the log has no rail of its own: that line's rail is it. */}
      {flat ? (
        <FoldPlaceProvider value={IN_WORK_FOLD}>
          <View style={styles.flatLog}>
            {notice}
            {log}
          </View>
        </FoldPlaceProvider>
      ) : open ? (
        <FoldPlaceProvider value={IN_WORK_FOLD}>
          <DisclosureBody onCollapse={toggle} label="Collapse completed work" rail="work">
            {notice}
            {log}
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
function WorkSummary({
  item,
  open,
  onToggle,
  look,
}: {
  item: CompletedWorkItem;
  open: boolean;
  onToggle(): void;
  /** Inside an opened Quiet View line, titled by its calls: that count's icon and words lead, and
   *  it leaves the pills (`quietTurn.tsx`). */
  look: QuietTurnLook | null;
}) {
  const { theme } = useTranscriptEnv();
  const titled = look !== null && (look.title ?? '').length > 0 ? look : null;
  const label = titled !== null ? (titled.title as string) : item.label;
  const stats = (item.stats ?? []).filter((stat) => titled === null || stat.kind !== titled.titleKind);
  const spoken = [label, ...stats.map((stat) => stat.label)].join(', ');
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
        <SingleLineTile glyph={titled !== null ? statGlyph((titled.titleKind ?? 'tools') as WorkStat['kind']) : 'clock'} badge="check" />
        <Text style={[SINGLE_LINE_TITLE, { color: theme.foreground }]}>{label}</Text>
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
  // A "Then · 22s" mark sits 4pt over the turn's first row (desktop `FLAT_MARK_GAP`).
  flatMark: { marginBottom: 4 - COMPLETED_PART_GAP },
  flatLog: { gap: 8, minWidth: 0 },
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
