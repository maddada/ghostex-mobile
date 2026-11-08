/**
 * One transcript item (desktop `transcript.rs` `transcript_item_row`): a message, a summary-mode
 * turn, or a finished turn folded behind its "Worked for 2m 5s" summary (`completed_work_row.rs`,
 * `deferred_work.rs`). A kind this build does not know draws nothing.
 */

import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { CompletedWorkItem, ProjectedMessage, SummaryItem, TranscriptItem } from '../../rust/document';
import { QuestionExchangeCards } from '../cards';
import { useNativeChatUi, useTranscriptEnv, useTranscriptFlags } from './context';
import { DisclosureBody, DisclosureHeading, FoldPlaceProvider } from './Disclosure';
import { cardEdge, ReadImageStrip } from './Images';
import { CompletedFilesFold } from './FileChanges';
import { arr, obj } from './json';
import { MessageRow } from './MessageRow';
import { SentAgentMessageCards } from './AgentMessageCards';
import { WorkflowCards } from './WorkflowCard';
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
import { PROSE_SIZE } from './theme';

/** The space between the parts of a finished turn (desktop `PART_GAP` in completed_work_row.rs). */
const COMPLETED_PART_GAP = 10;
const IN_WORK_FOLD = { inWorkFold: true, hideFileChanges: true };
const HIDE_FILES = { inWorkFold: false, hideFileChanges: true };

export const TranscriptItemView = memo(function TranscriptItemView({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case 'message':
      return <MessageRow message={(item as { message: ProjectedMessage }).message} />;
    case 'summary':
      return <SummaryRow item={item as SummaryItem} />;
    case 'completed-work':
      return <CompletedWorkRow item={item as CompletedWorkItem} />;
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
  // The turn's messages holding a page card, a question form or a chart, drawn in full and never
  // folded; the folds below leave them out (gx-chat-core `content_rows`, where the user's decision
  // lives; desktop `transcript.rs`).
  const cards = item.cards ?? [];
  const content = new Set(cards.map((card) => card.id));
  const foldRows = (hasFinal ? [...(item.earlierReplies ?? []), item.final!] : item.work).filter(
    (message) => !content.has(message.id),
  );
  return (
    <View style={styles.column}>
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
            <View style={styles.column}>
              {foldRows.map((message) => (
                <MessageRow key={message.id} message={message} />
              ))}
            </View>
          ) : null}
        </>
      ) : null}
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
  // Two one-line cards in a row are a row gap apart (`cardSpacing.ts`): the answered-question and
  // sent-message stacks sit that far under the "Worked for" fold, or under each other, when nothing
  // else comes between.
  const foldAbove = !open && (item.readImages ?? []).length === 0 && item.artifacts.length === 0;
  const hasQuestions = arr(item.questions).length > 0;
  return (
    <View style={styles.completedColumn}>
      <WorkSummary item={item} open={open} onToggle={toggle} />
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
          notice={deferredState !== undefined ? <DeferredNotice item={item} error={deferredState.error ?? ''} /> : null}
        />
      ) : null}
      {open ? (
        <FoldPlaceProvider value={IN_WORK_FOLD}>
          <DisclosureBody onCollapse={toggle} label="Collapse completed work" rail="work">
            {deferredState !== undefined ? <DeferredNotice item={item} error={deferredState.error ?? ''} /> : null}
            {item.work.map((message) => (
              <MessageRow key={message.id} message={message} />
            ))}
          </DisclosureBody>
        </FoldPlaceProvider>
      ) : null}
      <FoldPlaceProvider value={HIDE_FILES}>
        {item.artifacts.map((message) => (
          <MessageRow key={message.id} message={message} />
        ))}
        <QuestionExchangeCards exchanges={item.questions} aboveIsCard={foldAbove} columnGap={COMPLETED_PART_GAP} />
        <SentAgentMessageCards
          cards={item.sentMessages}
          aboveIsCard={foldAbove || hasQuestions}
          columnGap={COMPLETED_PART_GAP}
        />
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
        {/* The count pills sit at the row's right end and wrap among themselves (desktop `work_summary`). */}
        <View style={styles.chips}>
          {stats.map((stat) => {
            const failed = stat.kind === 'failed' || stat.kind === 'recovered';
            const tone = failed ? theme.error : theme.cardMuted;
            return (
              <SingleLinePill
                key={stat.kind}
                icon={
                  stat.kind === 'files'
                    ? 'pencil'
                    : stat.kind === 'images'
                      ? 'photo'
                      : failed
                        ? 'alert-triangle'
                        : 'tool'
                }
                label={stat.label}
                color={tone}
              />
            );
          })}
        </View>
      </Pressable>
      {pictures ? (
        <View style={[styles.cardPictures, { borderTopColor: theme.ink(SINGLE_LINE_CARD.borderAlpha) }]}>
          <ReadImageStrip images={item.readImages} inset={0} edge={cardEdge(theme)} />
        </View>
      ) : null}
    </View>
  );
}

/** The work fold while its history is being read, or after the read failed (`deferred_work.rs`). */
function DeferredNotice({ item, error }: { item: CompletedWorkItem; error: string }) {
  const { theme, dispatch } = useTranscriptEnv();
  const failed = error.length > 0;
  return (
    <View style={styles.deferred}>
      <Text style={[styles.deferredText, { color: failed ? theme.error : theme.muted }]}>
        {failed ? error : 'Loading work details…'}
      </Text>
      {failed ? (
        <Pressable
          onPress={() => dispatch({ type: 'loadWork', id: item.id, work: (item.deferred ?? null) as never })}
          style={({ pressed }) => [styles.retry, pressed && { backgroundColor: theme.pressed }]}
          accessibilityRole="button"
        >
          <Text style={[styles.deferredText, { color: theme.muted }]}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  column: { gap: 8, minWidth: 0 },
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
  chips: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 6,
  },
  deferred: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  deferredText: { fontSize: PROSE_SIZE, flexShrink: 1 },
  retry: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
});
