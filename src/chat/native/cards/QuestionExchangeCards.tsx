/**
 * Answered question cards in the transcript: every exchange a message carries (`message.questions`)
 * or a completed turn hoisted out of its fold (`item.questions`). Port of desktop
 * `question_exchange.rs`: a green receipt ("You answered 2 questions") that folds to its head, one
 * numbered row per question with the answer as plain text under it (like the answer card under a
 * form), the option's description, the custom answer or note, "Skipped" / "Dismissed without
 * answering", and every option behind "Show all N options".
 *
 * CDXC:SessionChat 2026-10-12 DECISION: The user answered "yes" to "The agent's own question receipts still show green chips. Make them plain like the new answer card?": each answer is plain foreground text at medium weight under its muted question (`PlainAnswer`), no chip, border or fill. Supersedes the 2026-10-11 green chips; desktop is question_exchange.rs.
 */

import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { AnswerAside, AskCard, AskHead, PlainAnswer, ReceiptRow, type AskTone } from './askCard';
import { Glyph } from './icons';
import { arr, isTrue, obj, str } from './json';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { ChoiceRow } from './primitives';
import { ROW_GAP, cardStackMargin } from '../transcript/cardSpacing';
import { useRowGap } from '../transcript/messageSpacing';

export function QuestionExchangeCards({ exchanges, aboveIsCard = false, columnGap = 0 }: { exchanges: unknown; aboveIsCard?: boolean; columnGap?: number }) {
  const styles = useStyles();
  const rowGap = useRowGap();
  const list = arr(exchanges);
  if (list.length === 0) return null;
  return (
    <View
      style={[
        styles.column,
        rowGap !== ROW_GAP && { gap: rowGap },
        { marginTop: cardStackMargin(aboveIsCard, columnGap, rowGap) },
      ]}
    >
      {list.map((exchange, index) => (
        <ExchangeCard key={index} exchange={exchange} />
      ))}
    </View>
  );
}

/** Whether the reader gave this question an answer: a pick or their own words. */
function answerGiven(answer: unknown): boolean {
  return arr(obj(answer)?.selectedIndices).length > 0 || str(answer, 'otherText').length > 0;
}

function ExchangeCard({ exchange }: { exchange: unknown }) {
  const [open, setOpen] = useState(true);
  const questions = arr(obj(exchange)?.questions);
  const answers = Array.isArray(obj(exchange)?.answers) ? arr(obj(exchange)?.answers) : null;
  const fallback = str(exchange, 'fallbackText');
  const total = questions.length;
  const answerAt = (index: number) => answers?.[index] ?? null;
  const answered = questions.filter((_, index) => answerGiven(answerAt(index))).length;
  const dismissed = questions.some((_, index) => isTrue(answerAt(index), 'dismissed'));
  const headers = questions.map((question) => str(question, 'header')).filter((header) => header.length > 0);
  let tone: AskTone;
  let title: string;
  if (answered > 0 || fallback.length > 0) {
    tone = 'answered';
    title =
      total <= 1 || answered === 0
        ? 'You answered the question'
        : answered === total
          ? `You answered ${total} questions`
          : `You answered ${answered} of ${total} questions`;
  } else {
    tone = 'quiet';
    title = dismissed ? 'Dismissed without answering' : total > 1 ? 'Questions skipped' : 'Question skipped';
  }
  let detail = headers.join(' · ');
  if (tone === 'quiet') {
    detail = detail.length > 0 ? `${detail} · No answer was given` : 'No answer was given';
  } else if (detail.length === 0 && total === 1) {
    detail = str(questions[0], 'question');
  }
  const hasRows = total > 0 || fallback.length > 0;
  return (
    <AskCard
      singleLine
      head={
        <AskHead
          singleLine
          title={title}
          detail={detail}
          accessibilityLabel={open ? 'Hide the answers' : 'Show the answers'}
          onPress={() => setOpen(!open)}
        />
      }
    >
      {hasRows && open ? (
        <View style={{ marginTop: -6 }}>
          {questions.map((question, index) => (
            <ExchangeRow
              key={index}
              question={question}
              answer={answerAt(index)}
              parsedAnswers={answers !== null}
              index={index}
            />
          ))}
          {fallback.length > 0 ? (
            <ReceiptRow
              number={total + 1}
              question=""
              answer={<PlainAnswer>{fallback}</PlainAnswer>}
              first={total === 0}
            />
          ) : null}
        </View>
      ) : null}
    </AskCard>
  );
}

function ExchangeRow({
  question,
  answer,
  parsedAnswers,
  index,
}: {
  question: unknown;
  answer: unknown;
  parsedAnswers: boolean;
  index: number;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const [expanded, setExpanded] = useState(false);
  const options = arr(obj(question)?.options);
  const selected = arr(obj(answer)?.selectedIndices).filter((value): value is number => typeof value === 'number');
  const other = str(answer, 'otherText');
  const prompt = str(question, 'question') || str(question, 'header');
  const picked = selected.map((optionIndex) => options[optionIndex]).filter((option) => option !== undefined);
  // One picked option's description reads under its answer, as the card showed it while it was asked.
  const description = picked.length === 1 ? str(picked[0], 'description') : '';
  const showDescription = description.length > 0 && description !== str(picked[0], 'label');
  const unanswered =
    picked.length === 0 && other.length === 0
      ? isTrue(answer, 'dismissed')
        ? 'Dismissed without answering'
        : parsedAnswers
          ? 'Skipped'
          : null
      : null;
  const answerLine = (
    <>
      {picked.length > 0 ? <PlainAnswer>{picked.map((option) => str(option, 'label')).join(', ')}</PlainAnswer> : null}
      {other.length > 0 && picked.length === 0 ? <PlainAnswer>{other}</PlainAnswer> : null}
      {unanswered !== null ? <AnswerAside italic>{unanswered}</AnswerAside> : null}
    </>
  );
  const below = (
    <>
      {showDescription ? <AnswerAside>{description}</AnswerAside> : null}
      {other.length > 0 && picked.length === 0 ? <AnswerAside>Your own answer</AnswerAside> : null}
      {other.length > 0 && picked.length > 0 ? <AnswerAside>{`Note: ${other}`}</AnswerAside> : null}
      {options.length > 0 ? (
        <>
          <Pressable
            accessibilityRole="button"
            onPress={() => setExpanded(!expanded)}
            style={styles.disclosure}
            hitSlop={6}
          >
            <Text style={styles.disclosureLabel}>
              {expanded ? 'Hide options' : `Show all ${options.length} options`}
            </Text>
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
    </>
  );
  return <ReceiptRow number={index + 1} question={prompt} answer={answerLine} below={below} first={index === 0} />;
}

const useStyles = themedStyles((P) => ({
  column: {
    width: '100%',
    gap: ROW_GAP,
  },
  disclosure: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingTop: 2,
  },
  disclosureLabel: {
    color: P.muted,
    fontSize: 12.5,
  },
  options: {
    gap: 6,
    paddingTop: 2,
  },
}));
