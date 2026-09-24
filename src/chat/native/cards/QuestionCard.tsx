/**
 * The agent's blocking question (`AskUserQuestion` and the like) and its approval request, drawn
 * from `questionCard` and `prompt`. Port of desktop `question.rs` and `approval.rs`: the same
 * copy, the same actions and payloads.
 *
 * While `prompt.kind` is `question` desktop draws this card in place of the composer; the screen
 * decides that (see `questionReplacesComposer`).
 */

import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';

import type { ChatDocument } from '../../rust/document';
import type { RustChat } from '../../rust/useRustChat';
import { Glyph } from './icons';
import { arr, isTrue, obj, str } from './json';
import { MONO_FONT, themedStyles, useTranscriptTheme } from '../transcript/theme';
import { CARD_LINE_HEIGHT, CARD_TEXT_SIZE, CardButton, CardHeader, ChoiceRow, StatusCard, useCardText, useWellStyle } from './primitives';
import { useEchoedText } from './useEchoedText';

/** Desktop returns the question card instead of the composer for a `question` prompt. */
export function questionReplacesComposer(document: ChatDocument | null | undefined): boolean {
  return document?.questionCard?.visible === true && str(document.prompt, 'kind') === 'question';
}

export function QuestionCard({ chat, document }: { chat: RustChat; document: ChatDocument }) {
  const cardText = useCardText();
  const card = document.questionCard;
  if (card?.visible !== true) return null;
  if (card.loading) {
    return (
      <StatusCard
        header={<CardHeader icon="help-circle" title="Question" />}
        body={[
          <Text key="restoring" style={cardText.prose}>
            Restoring your answer…
          </Text>,
        ]}
      />
    );
  }
  if (str(document.prompt, 'kind') === 'approval') {
    return <ApprovalCard chat={chat} document={document} />;
  }
  return <QuestionPromptCard chat={chat} document={document} />;
}

function QuestionPromptCard({ chat, document }: { chat: RustChat; document: ChatDocument }) {
  const cardText = useCardText();
  const styles = useStyles();
  const P = useTranscriptTheme();
  const { dispatch } = chat;
  const { height } = useWindowDimensions();
  const card = document.questionCard;
  const prompt = document.prompt;
  const questions = arr(obj(prompt)?.questions);
  const count = questions.length;
  const index = card.questionIndex ?? 0;
  const question = questions[index];
  const draft = card.drafts[index] ?? { indices: [], other: '' };
  const busy = card.busy;
  const multi = isTrue(question, 'multiSelect');
  const title = str(question, 'header') || (count > 1 ? 'Questions' : 'Question');
  const promptKey = useMemo(() => JSON.stringify(prompt), [prompt]);
  const [collapsedKey, setCollapsedKey] = useState<string | null>(null);
  const collapsed = collapsedKey === promptKey;

  const reportText = useCallback((text: string) => dispatch({ type: 'questionText', text }), [dispatch]);
  const [other, setOther] = useEchoedText(`${promptKey}:${index}`, draft.other ?? '', reportText);
  const allowCustom = obj(question)?.allowCustom !== false;

  const header = (
    <CardHeader
      icon="help-circle"
      title={title}
      titleAddon={
        collapsed ? (
          <Text style={styles.collapsedQuestion} numberOfLines={1}>
            {str(question, 'question')}
          </Text>
        ) : undefined
      }
      trailing={
        count > 1 && !collapsed ? (
          <Text style={styles.counter}>{`question ${index + 1} of ${count}`}</Text>
        ) : undefined
      }
      chevron={collapsed ? 'closed' : 'open'}
      hasBody={!collapsed}
      accessibilityLabel={collapsed ? 'Show the question and its options' : 'Hide the question and its options'}
      onPress={() => setCollapsedKey(collapsed ? null : promptKey)}
    />
  );

  const body = collapsed
    ? []
    : [
        <Text key="question" style={cardText.prose}>
          {str(question, 'question')}
        </Text>,
        multi ? (
          <Text key="multi" style={cardText.hint}>
            Select one or more options.
          </Text>
        ) : null,
        <ScrollView key="options" style={{ maxHeight: height * 0.45 }} contentContainerStyle={styles.options} nestedScrollEnabled>
          {arr(obj(question)?.options).map((option, optionIndex) => {
            // A multi-select note is sent beside the picks, so they stay visible while it is typed.
            const selected = (multi || draft.other.trim().length === 0) && draft.indices.includes(optionIndex);
            return (
              <ChoiceRow
                key={optionIndex}
                label={str(option, 'label')}
                description={str(option, 'description')}
                selected={selected}
                disabled={busy}
                onPress={() => dispatch({ type: 'questionOption', index: optionIndex })}
              />
            );
          })}
        </ScrollView>,
      ];

  const actions = [
    index > 0 ? (
      <CardButton key="back" label="←" ghost disabled={busy} onPress={() => dispatch({ type: 'questionBack' })} />
    ) : null,
    allowCustom ? (
      <TextInput
        key="answer"
        accessibilityLabel="Your answer"
        style={styles.answerInput}
        value={other}
        onChangeText={setOther}
        editable={!busy}
        multiline
        submitBehavior="submit"
        returnKeyType="send"
        onSubmitEditing={() => dispatch({ type: 'questionNext' })}
        placeholder="Write a custom answer…"
        placeholderTextColor={P.placeholder}
      />
    ) : (
      <View key="spacer" style={styles.spacer} />
    ),
    <CardButton key="cancel" label="Cancel" ghost disabled={busy} onPress={() => dispatch({ type: 'questionCancel' })} />,
    <CardButton
      key="next"
      label={card.controls.label}
      wide
      disabled={busy || card.controls.disabled}
      onPress={() => dispatch({ type: 'questionNext' })}
    />,
  ];

  return <StatusCard header={header} body={body} actions={actions} />;
}

function ApprovalCard({ chat, document }: { chat: RustChat; document: ChatDocument }) {
  const cardText = useCardText();
  const wellStyle = useWellStyle();
  const styles = useStyles();
  const P = useTranscriptTheme();
  const { dispatch } = chat;
  const prompt = document.prompt;
  const busy = document.questionCard.busy;
  const summary = str(prompt, 'summary');
  const header = (
    <View style={styles.approvalHeader}>
      <View style={styles.approvalIcon}>
        <Glyph name="shield-check" size={14} color={P.muted} />
      </View>
      <Text style={styles.approvalTitle}>Approval request</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        hitSlop={8}
        onPress={() => dispatch({ type: 'questionCancel' })}
        style={({ pressed }) => [styles.dismiss, pressed && { backgroundColor: P.wellFill }]}
      >
        <Glyph name="x" size={14} color={P.muted} />
      </Pressable>
    </View>
  );
  const body = [
    <View key="ask" style={styles.approvalAsk}>
      <Text style={[cardText.prose, styles.flexText]}>Allow this command?</Text>
      <Text style={cardText.hint}>{str(prompt, 'tool')}</Text>
    </View>,
    summary.length > 0 ? (
      <View key="summary" style={wellStyle}>
        <ScrollView style={styles.command} nestedScrollEnabled>
          <Text style={styles.commandText} selectable>
            {summary}
          </Text>
        </ScrollView>
      </View>
    ) : null,
  ];
  const actions = [
    <CardButton
      key="deny"
      label="Deny"
      disabled={busy}
      onPress={() => dispatch({ type: 'answer', answer: { kind: 'approval', approvalSend: '' } })}
    />,
    <CardButton
      key="allow"
      label="Allow"
      disabled={busy}
      onPress={() => dispatch({ type: 'answer', answer: { kind: 'approval', approvalSend: '1' } })}
    />,
  ];
  return <StatusCard header={header} body={body} actions={actions} />;
}

const useStyles = themedStyles((P) => ({
  collapsedQuestion: {
    flex: 1,
    minWidth: 0,
    color: P.muted,
    fontSize: CARD_TEXT_SIZE,
    lineHeight: CARD_LINE_HEIGHT,
  },
  counter: {
    color: P.muted,
    fontSize: 12,
    lineHeight: CARD_LINE_HEIGHT,
  },
  options: {
    gap: 6,
  },
  answerInput: {
    flexGrow: 1,
    flexBasis: 150,
    minWidth: 0,
    maxHeight: 96,
    color: P.foreground,
    fontSize: CARD_TEXT_SIZE,
    lineHeight: 20,
    paddingVertical: 6,
    paddingHorizontal: 0,
  },
  spacer: {
    flexGrow: 1,
  },
  approvalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  approvalIcon: {
    height: CARD_LINE_HEIGHT,
    justifyContent: 'center',
  },
  approvalTitle: {
    flex: 1,
    color: P.foreground,
    fontSize: CARD_TEXT_SIZE,
    lineHeight: CARD_LINE_HEIGHT,
    fontWeight: '500',
  },
  dismiss: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: P.light ? P.wellBorder : 'rgba(255,255,255,0.04)',
    backgroundColor: P.light ? P.background : 'rgba(14,14,14,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  approvalAsk: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: 12,
  },
  flexText: {
    flexShrink: 1,
  },
  command: {
    maxHeight: 160,
  },
  commandText: {
    color: P.cardMuted,
    fontFamily: MONO_FONT,
    fontSize: 13,
    lineHeight: 20,
  },
}));
