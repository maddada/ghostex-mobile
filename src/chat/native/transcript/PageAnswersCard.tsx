/**
 * The answers a reader sent from an agent's HTML page or an in-chat questions form, drawn as a
 * receipt instead of the JSON message gxserver typed into the session (`pageAnswers`,
 * packages/gx-chat-core/src/transcript/page_answers.rs).
 *
 * CDXC:SessionChat 2026-10-11 SEE-ALSO:
 * Desktop draws the same card in apps/desktop/src/app/native_chat/page_answers.rs. Change them together. The agent's own question receipts (QuestionExchangeCards.tsx) take the same `PlainAnswer`.
 */

import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ProjectedMessage } from '../../rust/document';
import { AnswerAside, AskCard, AskHead, PlainAnswer, ReceiptRow } from '../cards/askCard';
import { useTranscriptEnv } from './context';
import { SingleLineTile } from './singleLineCard';
import { arr, num, obj, str } from './json';

/** The green that marks an answered page or form (desktop `answered_color`). */
export { answeredColor } from '../cards/askCard';

export function PageAnswersCard({ message }: { message: ProjectedMessage }) {
  const { theme, dispatch } = useTranscriptEnv();
  // Answers on their way to the agent (gx-chat-core `session/answer_echoes.rs`): the card shows at
  // once with a spinner at its bottom left, or why they could not be delivered with Retry and Remove.
  const delivery = message.startupDelivery ?? null;
  const failed = delivery?.state === 'failed';
  const promptId = delivery?.promptId ?? '';
  const errorColor = theme.light ? '#b91c1c' : '#fb7185';
  const answers = obj(message.pageAnswers);
  const more = num(answers, 'more') ?? 0;
  const rows = arr(answers?.rows);
  // The answer is plain text under its question, no chip and no count (the user's 2026-10-12 decision in desktop page_answers.rs).
  return (
    <AskCard
      lined
      head={
        // The one-line cards' question tile with its green check, the ring in this card's panel, lined up with the one-line cards (desktop `answered_ask_head`).
        <AskHead
          lined
          lead={<SingleLineTile glyph="question" badge="check" ring={theme.cardPanel} />}
          title={`You answered “${str(answers, 'title')}”`}
        />
      }
    >
      <View style={styles.rows}>
        {rows.map((row, index) => {
          const value = str(row, 'value');
          const note = str(row, 'note');
          // The question sits above its answer, both at the card's full width (the user's decision in desktop page_answers.rs).
          return (
            <ReceiptRow
              key={index}
              number={index + 1}
              question={str(row, 'label')}
              answer={<PlainAnswer>{value}</PlainAnswer>}
              below={note.length > 0 ? <AnswerAside>{note}</AnswerAside> : undefined}
              first={index === 0}
            />
          );
        })}
        {more > 0 ? <Text style={[styles.more, { color: theme.muted }]}>and {more} more</Text> : null}
        {delivery !== null && !failed ? (
          <View style={styles.delivery} accessibilityRole="progressbar">
            <ActivityIndicator size={12} color={theme.muted} />
            <Text style={[styles.deliveryText, { color: theme.muted }]}>
              {delivery.state === 'queued'
                ? delivery.waitReason?.length
                  ? delivery.waitReason
                  : 'Waiting for the agent to be free…'
                : delivery.state === 'reconnecting'
                  ? "Reconnecting to Ghostex… your answers go out as soon as it's back."
                  : 'Sending to the agent…'}
            </Text>
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
                <Pressable
                  hitSlop={6}
                  accessibilityRole="button"
                  onPress={() => dispatch({ type: 'retryQueue', promptId })}
                >
                  <Text style={[styles.deliveryAction, { color: theme.primary }]}>Retry</Text>
                </Pressable>
                <Pressable
                  hitSlop={6}
                  accessibilityRole="button"
                  onPress={() => dispatch({ type: 'removeQueue', promptId })}
                >
                  <Text style={[styles.deliveryAction, { color: theme.primary }]}>Remove</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        ) : null}
      </View>
    </AskCard>
  );
}

const styles = StyleSheet.create({
  rows: { marginTop: -6 },
  more: { fontSize: 12, paddingLeft: 32, paddingTop: 2 },
  delivery: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6, paddingTop: 10 },
  deliveryText: { fontSize: 12, lineHeight: 18 },
  deliveryAction: { fontSize: 12, lineHeight: 18, fontWeight: '500' },
});
