/**
 * Answered question cards in the transcript: every exchange a message carries (`message.questions`)
 * or a completed turn hoisted out of its fold (`item.questions`). Port of desktop
 * `question_exchange.rs`: each question with its picked answers, the custom answer or note,
 * "Skipped" / "Dismissed without answering", and every option behind "Show all N options". The
 * option rows reuse the live card's choice rows, as a record rather than a control.
 */

import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Glyph } from './icons';
import { arr, isTrue, obj, str } from './json';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { ChoiceRow } from './primitives';

export function QuestionExchangeCards({ exchanges }: { exchanges: unknown }) {
  const styles = useStyles();
  const list = arr(exchanges);
  if (list.length === 0) return null;
  return (
    <View style={styles.column}>
      {list.map((exchange, index) => (
        <ExchangeCard key={index} exchange={exchange} />
      ))}
    </View>
  );
}

function ExchangeCard({ exchange }: { exchange: unknown }) {
  const styles = useStyles();
  const questions = arr(obj(exchange)?.questions);
  const answers = Array.isArray(obj(exchange)?.answers) ? arr(obj(exchange)?.answers) : null;
  const fallback = str(exchange, 'fallbackText');
  return (
    <View style={styles.card}>
      {questions.map((question, index) => (
        <ExchangeSection
          key={index}
          question={question}
          answer={answers?.[index] ?? null}
          parsedAnswers={answers !== null}
          index={index}
          total={questions.length}
        />
      ))}
      {fallback.length > 0 ? (
        <View style={[styles.section, questions.length > 0 && styles.sectionDivider]}>
          <Text style={styles.label}>ANSWER</Text>
          <Text style={styles.answerText}>{fallback}</Text>
        </View>
      ) : null}
    </View>
  );
}

function ExchangeSection({
  question,
  answer,
  parsedAnswers,
  index,
  total,
}: {
  question: unknown;
  answer: unknown;
  parsedAnswers: boolean;
  index: number;
  total: number;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const [expanded, setExpanded] = useState(false);
  const options = arr(obj(question)?.options);
  const selected = arr(obj(answer)?.selectedIndices).filter((value): value is number => typeof value === 'number');
  const other = str(answer, 'otherText');
  const prompt = str(question, 'question');
  const picked = selected.map((optionIndex) => options[optionIndex]).filter((option) => option !== undefined);
  const unanswered =
    picked.length === 0 && other.length === 0
      ? isTrue(answer, 'dismissed')
        ? 'Dismissed without answering'
        : parsedAnswers
          ? 'Skipped'
          : null
      : null;
  return (
    <View style={[styles.section, index > 0 && styles.sectionDivider]}>
      <View style={styles.sectionHeader}>
        <Text style={styles.label}>{(str(question, 'header') || 'Question').toUpperCase()}</Text>
        {total > 1 ? <Text style={styles.badge}>{`${index + 1}/${total}`}</Text> : null}
      </View>
      {prompt.length > 0 ? <Text style={styles.prompt}>{prompt}</Text> : null}
      {picked.length > 0 || other.length > 0 || unanswered !== null ? (
        <View style={styles.answers}>
          {picked.map((option, optionIndex) => (
            <AnswerRow key={optionIndex} label={str(option, 'label')} description={str(option, 'description')} />
          ))}
          {other.length > 0 ? <AnswerRow label={other} micro={selected.length === 0 ? 'CUSTOM ANSWER' : 'ADDED NOTE'} /> : null}
          {unanswered !== null ? <Text style={styles.unanswered}>{unanswered}</Text> : null}
        </View>
      ) : null}
      {options.length > 0 ? (
        <>
          <Pressable accessibilityRole="button" onPress={() => setExpanded(!expanded)} style={styles.disclosure} hitSlop={6}>
            <Text style={styles.disclosureLabel}>{expanded ? 'Hide options' : `Show all ${options.length} options`}</Text>
            <Glyph name={expanded ? 'chevron-down' : 'chevron-right'} size={12} color={P.muted} />
          </Pressable>
          {expanded ? (
            <View style={styles.options}>
              {options.map((option, optionIndex) => (
                <ChoiceRow
                  key={optionIndex}
                  label={str(option, 'label')}
                  description={str(option, 'description')}
                  selected={selected.includes(optionIndex)}
                  dense
                  disabled
                />
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function AnswerRow({ label, description, micro }: { label: string; description?: string; micro?: string }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <View style={styles.answerRow}>
      <View style={styles.answerCheck}>
        <Glyph name="check" size={14} color={P.controlPrimary} />
      </View>
      <View style={styles.answerBody}>
        {micro !== undefined ? <Text style={styles.micro}>{micro}</Text> : null}
        <Text style={[styles.answerText, micro === undefined && styles.answerChosen]}>{label}</Text>
        {description !== undefined && description.length > 0 && description !== label ? (
          <Text style={styles.answerDescription}>{description}</Text>
        ) : null}
      </View>
    </View>
  );
}

const useStyles = themedStyles((P) => ({
  column: {
    width: '100%',
    gap: 12,
    paddingVertical: 6,
  },
  card: {
    width: '100%',
    overflow: 'hidden',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: P.inputBorder,
    backgroundColor: P.cardPanel,
  },
  section: {
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  sectionDivider: {
    borderTopWidth: 1,
    borderTopColor: P.inputBorder,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  label: {
    color: P.muted,
    fontSize: 11,
    fontWeight: '600',
  },
  badge: {
    paddingHorizontal: 5,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: P.light ? P.input : 'rgba(29,29,29,0.6)',
    color: P.muted,
    fontSize: 10,
  },
  prompt: {
    color: P.ink(0.9),
    fontSize: 14,
    lineHeight: 21,
  },
  answers: {
    gap: 6,
    paddingTop: 6,
  },
  answerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: P.selectedBorder,
    backgroundColor: P.selectedFill,
  },
  answerCheck: {
    paddingTop: 3,
  },
  answerBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  micro: {
    color: P.muted,
    fontSize: 10,
    fontWeight: '600',
  },
  answerText: {
    color: P.foreground,
    fontSize: 14,
    lineHeight: 20,
  },
  answerChosen: {
    fontWeight: '500',
  },
  answerDescription: {
    color: P.cardMuted,
    fontSize: 12,
    lineHeight: 17,
  },
  unanswered: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    overflow: 'hidden',
    backgroundColor: P.ink(0.045),
    color: P.muted,
    fontSize: 12,
  },
  disclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingTop: 4,
  },
  disclosureLabel: {
    color: P.muted,
    fontSize: 12,
  },
  options: {
    gap: 6,
    paddingTop: 6,
  },
}));
