/**
 * One-click answers under an agent's question: the marked line gx-chat-core puts under the question
 * (`transcript/inline_answers.rs`), drawn as one compact segmented pill. The state is the question's
 * one-question form in the document's `questionForms` (open, sending, queued, answered, changing);
 * this file only lays it out and sends the taps, as desktop `inline_answers.rs` does.
 *
 * CDXC:SessionChat 2026-11-05 SEE-ALSO: The decision (Q1245 C, the segmented pill on the line under the question; Q1247 B, Change while queued or after) is in packages/gx-chat-core/src/transcript/inline_answers.rs.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTranscriptEnv } from '../context';
import { arr, obj, str, type JsonRecord } from '../json';
import { QuestionFlashFrame } from '../OpenQuestions';
import { useQuestionFormState } from '../QuestionForm';
import { openQuestionReply } from '../QuestionReply';

/** The reader's own answer as the status quotes it: its first line, at most 48 characters. */
function short(text: string): string {
  const line = (text.split('\n')[0] ?? '').trim();
  const cut = Array.from(line).slice(0, 48).join('');
  return cut.length < line.length || text.trim().includes('\n') ? `${cut}…` : cut;
}

/** `rgba()` of a `#rrggbb` colour at `alpha`; other colour strings come back as they are. */
function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color);
  if (match === null) return color;
  const value = parseInt(match[1]!, 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

export function InlineAnswers({ mark }: { mark: JsonRecord }) {
  const { theme, dispatch } = useTranscriptEnv();
  const formId = str(mark, 'form');
  const form = useQuestionFormState(formId);
  // Asked by a work item too: drawn once, as its ask card (gx-chat-core work_cards.rs `card_tags`).
  const covered = form?.coveredByCard === true;
  const phase = form === null ? 'open' : str(form, 'state') || 'open';
  const changing = form?.changing === true;
  const withdrawn = form?.tagWithdrawn === true || phase === 'withdrawn' || phase === 'canceled';
  const firstDraft = obj(arr(form?.drafts)[0]);
  const pickedRaw = arr(firstDraft?.indices)[0];
  const picked = typeof pickedRaw === 'number' ? pickedRaw : null;
  const sent = phase === 'sending' || phase === 'queued' || phase === 'answered';
  const clickable = !withdrawn && (phase === 'open' || (changing && phase !== 'sending'));
  // A newer copy of this question sits further down; every copy answers it there.
  const askedAgain = form?.askedAgain === true && phase === 'open' && !changing && !withdrawn;
  const ownAnswer = sent && form !== null ? str(form, 'ownAnswer') : '';
  const words = ownAnswer.length > 0 ? ` “${short(ownAnswer)}”` : '';
  const tag = str(mark, 'tag');
  const edge = withAlpha(theme.foreground, 0.16);
  const inkText = theme.light ? '#fafafa' : '#111113';
  const choices = arr(mark.choices).map((choice) => obj(choice)).filter((choice) => choice !== null);

  let status: { text: string; link: string | null } | null = null;
  if (withdrawn) status = { text: 'Withdrawn', link: null };
  else if (changing) status = { text: 'Pick another answer ·', link: 'Cancel' };
  else if (askedAgain) status = { text: 'Asked again below', link: null };
  else if (phase === 'sending') status = { text: `Sending${words}…`, link: null };
  else if (phase === 'queued') status = { text: `Queued${words} ·`, link: 'Change' };
  else if (phase === 'answered') status = { text: `Sent${words} ·`, link: 'Change' };

  if (covered) return null;
  return (
    <QuestionFlashFrame target={formId} light={theme.light}>
      <View style={styles.row}>
        <View style={[styles.pill, { borderColor: edge }]} accessibilityRole="radiogroup">
          {choices.map((choice, index) => {
            const label = str(choice, 'label');
            const chosen = sent && picked === index;
            const recommended = choice.recommended === true && !sent;
            const faded = (sent && !chosen && !changing) || withdrawn;
            const active = clickable && !(chosen && !changing);
            return (
              <Pressable
                key={index}
                disabled={!active}
                accessibilityRole="radio"
                accessibilityState={{ selected: chosen, disabled: !active }}
                accessibilityLabel={recommended ? `${label}, recommended` : label}
                onPress={() => dispatch({ type: 'inlineAnswer', form: formId, choice: index })}
                style={({ pressed }) => [
                  styles.segment,
                  index > 0 && { borderLeftWidth: StyleSheet.hairlineWidth * 2, borderLeftColor: edge },
                  {
                    backgroundColor: chosen
                      ? theme.foreground
                      : withAlpha(theme.foreground, pressed && active ? 0.1 : 0.035),
                  },
                  faded && styles.faded,
                ]}
              >
                {recommended ? (
                  <View style={[styles.dot, { backgroundColor: withAlpha(theme.foreground, 0.55) }]} />
                ) : null}
                <Text style={[styles.label, { color: chosen ? inkText : theme.foreground }]} numberOfLines={1}>
                  {chosen ? `${label} ✓` : label}
                </Text>
              </Pressable>
            );
          })}
          {clickable ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Write your own answer"
              onPress={() => openQuestionReply({ form: formId, tag })}
              style={({ pressed }) => [
                styles.segment,
                choices.length > 0 && { borderLeftWidth: StyleSheet.hairlineWidth * 2, borderLeftColor: edge },
                { backgroundColor: withAlpha(theme.foreground, pressed ? 0.1 : 0.035) },
              ]}
            >
              <Text style={[styles.label, { color: theme.cardMuted }]}>✎</Text>
            </Pressable>
          ) : null}
        </View>
        {status !== null ? (
          <View style={styles.status}>
            <Text style={[styles.statusText, { color: theme.cardMuted }]}>{status.text}</Text>
            {status.link !== null ? (
              <Pressable
                hitSlop={8}
                accessibilityRole="button"
                onPress={() => dispatch({ type: 'inlineAnswerChange', form: formId })}
              >
                <Text style={[styles.statusText, styles.statusLink, { color: theme.cardMuted }]}>{status.link}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </View>
    </QuestionFlashFrame>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  pill: { flexDirection: 'row', borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: 9, overflow: 'hidden', flexShrink: 1 },
  segment: { flexDirection: 'row', alignItems: 'center', gap: 5, minHeight: 32, paddingHorizontal: 13 },
  label: { fontSize: 13.5, fontWeight: '600' },
  dot: { width: 5, height: 5, borderRadius: 3 },
  faded: { opacity: 0.4 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  statusText: { fontSize: 12 },
  statusLink: { textDecorationLine: 'underline' },
});
