/**
 * The answers a reader sent from an agent's HTML page or an in-chat questions form, drawn as a
 * receipt instead of the JSON message gxserver typed into the session (`pageAnswers`,
 * packages/gx-chat-core/src/transcript/page_answers.rs).
 *
 * CDXC:SessionChat 2026-10-11 SEE-ALSO:
 * Desktop draws the same card in apps/desktop/src/app/native_chat/page_answers.rs. Change them together. The agent's own question receipts (QuestionExchangeCards.tsx) take the same `PlainAnswer`.
 */

import { createContext, useContext, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ProjectedMessage } from '../../rust/document';
import { useNativeChatUi, useTranscriptEnv, useTranscriptFlags } from './context';
import { Glyph } from './icons';
import { LinkWords } from './LinkWords';
import {
  SINGLE_LINE_CARD,
  SINGLE_LINE_HEADER_HEIGHT,
  SINGLE_LINE_TITLE,
  SingleLineTile,
  singleLinePressed,
  singleLineShell,
} from './singleLineCard';
import { useDisclosure } from './state';
import { MONO_FONT } from './theme';
import { arr, num, obj, str } from './json';

/** The green that marks an answered page or form (desktop `answered_color`). */
export { answeredColor } from '../cards/askCard';

/** Set under Quiet View's own answers line, whose card opens without a line of its own (quietView.tsx). */
export const AnswersUnderQuietLine = createContext(false);

/** About two lines of a note at a phone's width: a longer note folds to two lines with More. */
const NOTE_TWO_LINES = 110;

/**
 * The folded answers card and, opened, each question once (CDXC:SessionChat 2026-11-13 DECISION in
 * desktop page_answers.rs, Q2990 A to Q2997). Under Quiet View's own line (`AnswersUnderQuietLine`)
 * the card opens straight onto its rows without a line of its own.
 */
export function PageAnswersCard({ message }: { message: ProjectedMessage }) {
  const bodyOnly = useContext(AnswersUnderQuietLine);
  const { theme, dispatch } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const { canRemoveQueued, sendFailureCardPromptId } = useTranscriptFlags();
  // Answers on their way to the agent (gx-chat-core `session/answer_echoes.rs`): the card shows at
  // once with a spinner at its bottom left, or why they could not be delivered with Retry and Remove.
  const delivery = message.startupDelivery ?? null;
  const failed = delivery?.state === 'failed';
  // Left the queue and the conversation never showed it: the fact and Remove, no spinner (CDXC:SessionChat 2026-10-31 in packages/gx-chat-core/src/session/startup_sends.rs).
  const unconfirmed = delivery?.state === 'unconfirmed';
  const promptId = delivery?.promptId ?? '';
  const removable = promptId.length > 0 && (unconfirmed || (delivery?.state === 'queued' && canRemoveQueued));
  const removeAction = (
    <Pressable hitSlop={6} accessibilityRole="button" onPress={() => dispatch({ type: 'removeQueue', promptId })}>
      <Text style={[styles.deliveryAction, { color: theme.primary }]}>Remove</Text>
    </Pressable>
  );
  const errorColor = theme.light ? '#b91c1c' : '#fb7185';
  const answers = obj(message.pageAnswers);
  const more = num(answers, 'more') ?? 0;
  const pageId = str(answers, 'pageId');
  const by = str(answers, 'by');
  const [toggledOpen, toggle] = useDisclosure(disclosures, `answers-card:${pageId}:${by}`, false);
  const open = bodyOnly || toggledOpen;
  // Older chat cores sent no `skipped` or `extra`: their words stand in.
  const rows = arr(answers?.rows).map((row) => {
    const value = str(row, 'value');
    const label = str(row, 'label');
    return {
      row,
      label,
      value,
      tag: str(row, 'tag'),
      note: str(row, 'note'),
      skipped: obj(row)?.skipped === true || value === 'Skipped' || value === 'Not answered',
      extra: obj(row)?.extra === true || (str(row, 'tag').length === 0 && label === 'Additional notes'),
    };
  });
  const questions = rows.filter((row) => !row.extra);
  const answeredCount = questions.filter((row) => !row.skipped).length;
  const skippedRows = questions.filter((row) => row.skipped);
  // The phone's short count: "3 of 4" when some were skipped, else "3 answered".
  const count =
    questions.length === 0
      ? ''
      : skippedRows.length === 0
        ? `${answeredCount} answered`
        : answeredCount === 0
          ? `${skippedRows.length} skipped`
          : `${answeredCount} of ${questions.length}`;
  const page = obj(answers?.page);
  const pageUrl = str(page, 'url');
  const hairline = theme.ink(0.05);
  const body = (
    <View style={[styles.rows, bodyOnly ? styles.rowsBodyOnly : null]}>
      {open
        ? rows
            .filter((row) => !row.skipped)
            .map((row, drawn) => {
              const index = rows.indexOf(row);
              // Older answers carry no tags: their place in the list stands in.
              const marker = row.extra ? '' : row.tag.length > 0 ? row.tag : `${index + 1}.`;
              return (
                <View
                  key={index}
                  style={[
                    styles.row,
                    drawn > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: hairline } : null,
                  ]}
                >
                  <QuestionLine
                    marker={marker}
                    label={row.extra ? 'Your note' : row.label}
                    runs={row.extra ? undefined : obj(row.row)?.labelRuns}
                  />
                  <Text style={[styles.answer, { color: theme.foreground, fontWeight: row.extra ? '400' : '500' }]}>
                    {row.value}
                  </Text>
                  {row.note.length > 0 ? <AnswerNote note={row.note} /> : null}
                </View>
              );
            })
        : null}
      {open && skippedRows.length > 0 ? (
        <Text
          style={[
            styles.skipped,
            { color: theme.muted },
            rows.some((row) => !row.skipped)
              ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: hairline }
              : null,
          ]}
        >
          Skipped{' '}
          {skippedRows.map((row, at) => (
            <Text key={at}>
              {row.tag.length > 0 ? <Text style={styles.tag}>{row.tag} </Text> : null}
              {row.label}
              {at + 1 < skippedRows.length ? ', ' : ''}
            </Text>
          ))}
        </Text>
      ) : null}
      {open && more > 0 ? <Text style={[styles.more, { color: theme.muted }]}>and {more} more</Text> : null}
      {unconfirmed ? (
        <View style={styles.delivery} accessibilityRole="text">
          <Text style={[styles.deliveryText, { color: theme.muted }]}>{delivery?.waitReason ?? ''}</Text>
          {removable ? removeAction : null}
        </View>
      ) : null}
      {delivery !== null && !failed && !unconfirmed ? (
        <View style={styles.delivery} accessibilityRole="progressbar">
          <ActivityIndicator size={12} color={theme.muted} />
          <Text style={[styles.deliveryText, { color: theme.muted }]}>
            {delivery.state === 'queued'
              ? delivery.waitReason?.length
                ? delivery.waitReason
                : 'Waiting for the agent to finish its turn…'
              : delivery.state === 'reconnecting'
                ? "Reconnecting to Ghostex… your answers go out as soon as it's back."
                : 'Sending to the agent…'}
          </Text>
          {removable ? removeAction : null}
        </View>
      ) : null}
      {failed ? (
        <View style={styles.delivery} accessibilityRole="alert">
          <Text style={[styles.deliveryText, { color: errorColor }]}>
            {delivery?.errorMessage
              ? `Your answers could not be delivered: ${delivery.errorMessage}`
              : 'Your answers could not be delivered.'}
          </Text>
          {promptId.length > 0 ? (
            <>
              {promptId === sendFailureCardPromptId ? null : (
                <Pressable
                  hitSlop={6}
                  accessibilityRole="button"
                  onPress={() => dispatch({ type: 'retryQueue', promptId })}
                >
                  <Text style={[styles.deliveryAction, { color: theme.primary }]}>Retry</Text>
                </Pressable>
              )}
              {removeAction}
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
  const hasBody = open || delivery !== null;
  if (bodyOnly) {
    return (
      <View style={[styles.lined, { borderColor: theme.inputBorder, backgroundColor: theme.cardPanel }]}>{body}</View>
    );
  }
  return (
    <View style={singleLineShell(theme)}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? 'Hide your answers' : 'Show your answers'}
        onPress={toggle}
        style={({ pressed }) => [styles.head, pressed ? singleLinePressed(theme) : null]}
      >
        <SingleLineTile glyph="question" badge="check" />
        <Text numberOfLines={1} style={[SINGLE_LINE_TITLE, styles.title, { color: theme.foreground }]}>
          {str(answers, 'title')}
        </Text>
        {count.length > 0 || by.length > 0 ? (
          <Text numberOfLines={1} style={[styles.count, { color: theme.muted }]}>
            {by.length > 0 ? (count.length > 0 ? `${by} · ${count}` : by) : count}
          </Text>
        ) : null}
        {pageUrl.length > 0 ? (
          <Pressable
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Open the page"
            onPress={() => dispatch({ type: 'openMarkdownLink', href: pageUrl, external: false })}
            style={({ pressed }) => [styles.openPage, pressed ? singleLinePressed(theme) : null]}
          >
            <Glyph name="arrow-up-right" size={15} color={theme.muted} />
          </Pressable>
        ) : null}
      </Pressable>
      {hasBody ? <View style={styles.body}>{body}</View> : null}
    </View>
  );
}

/** A row's first line: its tag (or number) and its question on one line; a long press shows all of it. */
function QuestionLine({ marker, label, runs }: { marker: string; label: string; runs: unknown }) {
  const { theme } = useTranscriptEnv();
  const [whole, setWhole] = useState(false);
  return (
    <Pressable onLongPress={() => setWhole((shown) => !shown)} style={styles.questionLine}>
      {marker.length > 0 ? <Text style={[styles.tag, { color: theme.muted }]}>{marker}</Text> : null}
      <View style={styles.questionText}>
        {/* The question's links open on a tap (`labelRuns`, gx-chat-core `questions/form_links.rs`). */}
        <LinkWords
          text={label}
          runs={runs}
          color={theme.muted}
          style={styles.question}
          numberOfLines={whole ? undefined : 1}
        />
      </View>
    </Pressable>
  );
}

/** A note under its answer: muted, behind a thin rule, two lines until More opens it. */
function AnswerNote({ note }: { note: string }) {
  const { theme } = useTranscriptEnv();
  const [whole, setWhole] = useState(false);
  const long = note.length > NOTE_TWO_LINES || note.split('\n').length > 2;
  return (
    <View style={styles.noteBox}>
      <Text
        numberOfLines={long && !whole ? 2 : undefined}
        style={[styles.note, { color: theme.muted, borderLeftColor: theme.ink(0.1) }]}
      >
        {note}
      </Text>
      {long ? (
        <Pressable hitSlop={6} accessibilityRole="button" onPress={() => setWhole((shown) => !shown)}>
          <Text style={[styles.moreNote, { color: theme.foreground }]}>{whole ? 'Less' : 'More'}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  head: {
    height: SINGLE_LINE_HEADER_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: SINGLE_LINE_CARD.paddingX,
  },
  title: { flex: 1, minWidth: 0 },
  count: { flexShrink: 0, fontSize: 12.5, lineHeight: 18 },
  openPage: { width: 28, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center', marginRight: -4 },
  body: { paddingHorizontal: SINGLE_LINE_CARD.paddingX, paddingBottom: 10 },
  lined: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 12, paddingBottom: 10 },
  rows: { minWidth: 0 },
  rowsBodyOnly: { paddingTop: 2 },
  row: { paddingVertical: 8, gap: 2, minWidth: 0 },
  questionLine: { flexDirection: 'row', alignItems: 'baseline', gap: 8, minWidth: 0 },
  questionText: { flex: 1, minWidth: 0 },
  question: { fontSize: 13, lineHeight: 19 },
  tag: { fontFamily: MONO_FONT, fontSize: 11.5, lineHeight: 16, fontWeight: '500', flexShrink: 0 },
  answer: { fontSize: 15, lineHeight: 21 },
  noteBox: { marginTop: 3, alignItems: 'flex-start', gap: 1 },
  note: { fontSize: 12.5, lineHeight: 18, borderLeftWidth: 2, paddingLeft: 8, alignSelf: 'stretch' },
  moreNote: { fontSize: 12.5, lineHeight: 18, fontWeight: '500' },
  skipped: { fontSize: 12.5, lineHeight: 18, paddingVertical: 8 },
  more: { fontSize: 12, paddingTop: 2 },
  delivery: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingTop: 10 },
  deliveryText: { fontSize: 12, lineHeight: 18 },
  deliveryAction: { fontSize: 12, lineHeight: 18, fontWeight: '500' },
});
