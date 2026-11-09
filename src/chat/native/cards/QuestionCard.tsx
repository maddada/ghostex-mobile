/**
 * The agent's blocking question (`AskUserQuestion` and the like) and its approval request, drawn
 * from `questionCard` and `prompt`. Port of desktop `question.rs` and `approval.rs`: the same
 * copy, the same actions and payloads.
 *
 * While `prompt.kind` is `question` desktop draws this card in place of the composer; the screen
 * decides that (see `questionReplacesComposer`).
 */

import { useCallback, useMemo, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';

import type { ChatDocument } from '../../rust/document';
import { useChatViewSize } from '../chatPlacement';
import type { RustChat } from '../../rust/useRustChat';
import { RECONNECTING_NOTE, questionOptionAnswer } from './answers';
import { Glyph } from './icons';
import { arr, isTrue, obj, str } from './json';
import { MONO_FONT, themedStyles, useTranscriptTheme } from '../transcript/theme';
import { AskCard, AskHead, AskOption, PrimaryButton, ProgressDots } from './askCard';
import { SingleLineTile } from '../transcript/singleLineCard';
import { CardButton, CardHeader, StatusCard, useCardText } from './primitives';
import { ApprovalCard } from './ApprovalCard';
import { useEchoedText } from './useEchoedText';

/**
 * The share of the window (of a chat in a pane: the chat's own height, `chatPlacement`) the cards band above the
 * composer may take (`NativeChatCards`).
 */
export const CARD_BAND_SHARE = 0.6;

/**
 * CDXC:SessionChat 2026-10-23 DECISION: User: "please make the height of this limited and the text in the middle scrollable. right now it sometimes becomes super tall and i can't click on the buttons at the bottom." The card stands in for the composer at the foot of the cards band, so it is no taller than that band (less its top padding): its head, options and footer keep their height and only the question text scrolls. The options keep their own scroll at under half the card. Desktop caps its card the same way (`question_card_max_height` in apps/desktop/src/app/native_chat/question.rs).
 */
function questionCardMaxHeight(viewHeight: number): number {
  return viewHeight * CARD_BAND_SHARE - 8;
}

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
  const maxHeight = questionCardMaxHeight(useChatViewSize().height);
  const card = document.questionCard;
  const prompt = document.prompt;
  const questions = arr(obj(prompt)?.questions);
  const count = questions.length;
  const index = card.questionIndex ?? 0;
  const question = questions[index];
  const draft = card.drafts[index] ?? { indices: [], other: '' };
  const busy = card.busy;
  const multi = isTrue(question, 'multiSelect');
  const header = str(question, 'header');
  const promptKey = useMemo(() => JSON.stringify(prompt), [prompt]);
  const [collapsedKey, setCollapsedKey] = useState<string | null>(null);
  const collapsed = collapsedKey === promptKey;

  const reportText = useCallback((text: string) => dispatch({ type: 'questionText', text }), [dispatch]);
  const [other, setOther] = useEchoedText(`${promptKey}:${index}`, draft.other ?? '', reportText);
  const allowCustom = obj(question)?.allowCustom !== false;

  // The header names the ask over the question's own header and its place (desktop question.rs, CDXC:SessionChat 2026-10-11).
  const detail = collapsed
    ? str(question, 'question')
    : count > 1
      ? header.length > 0
        ? `${header} · ${index + 1} of ${count}`
        : `${index + 1} of ${count}`
      : header;
  const head = (
    <AskHead
      lead={<SingleLineTile glyph="checklist" badge="ask" ring={P.cardPanel} />}
      title="Needs your answer"
      detail={detail}
      trailing={count > 1 && !collapsed ? <ProgressDots index={index} count={count} /> : undefined}
      chevron={collapsed ? 'closed' : 'open'}
      accessibilityLabel={collapsed ? 'Show the question and its options' : 'Hide the question and its options'}
      onPress={() => setCollapsedKey(collapsed ? null : promptKey)}
    />
  );

  const footer = (
    <>
      {index > 0 ? <CardButton label="←" disabled={busy} onPress={() => dispatch({ type: 'questionBack' })} /> : null}
      {allowCustom ? (
        <View style={styles.answerField}>
          <Glyph name="pencil" size={13} color={P.muted} />
          <TextInput
            accessibilityLabel="Your answer"
            style={styles.answerInput}
            value={other}
            onChangeText={setOther}
            editable={!busy}
            multiline
            submitBehavior="submit"
            returnKeyType="send"
            onSubmitEditing={() => dispatch({ type: 'questionNext' })}
            placeholder="Or write your own answer…"
            placeholderTextColor={P.placeholder}
          />
        </View>
      ) : (
        <View style={styles.spacer} />
      )}
      <CardButton label="Cancel" disabled={busy} onPress={() => dispatch({ type: 'questionCancel' })} />
      <PrimaryButton
        label={card.controls.label}
        disabled={busy || card.controls.disabled}
        onPress={() => dispatch({ type: 'questionNext' })}
      />
    </>
  );

  return (
    <AskCard head={head} footer={footer} style={{ maxHeight }} bodyStyle={styles.shrinks}>
      {collapsed ? null : (
        <View style={[styles.body, styles.shrinks]}>
          <ScrollView style={styles.questionScroll} nestedScrollEnabled>
            <Text style={styles.question}>{str(question, 'question')}</Text>
          </ScrollView>
          {multi ? <Text style={[cardText.hint, styles.multiHint]}>Select one or more options.</Text> : null}
          <ScrollView
            style={{ maxHeight: maxHeight * 0.45 }}
            contentContainerStyle={styles.options}
            nestedScrollEnabled
          >
            {arr(obj(question)?.options).map((option, optionIndex) => {
              // A multi-select note is sent beside the picks, so they stay visible while it is typed.
              const selected = (multi || draft.other.trim().length === 0) && draft.indices.includes(optionIndex);
              const preview = str(option, 'preview');
              return (
                <View key={optionIndex} style={styles.optionWithPreview}>
                  <AskOption
                    label={str(option, 'label')}
                    detail={str(option, 'description')}
                    picked={selected}
                    multiple={multi}
                    enabled={!busy}
                    onPress={() => dispatch(questionOptionAnswer(optionIndex))}
                  />
                  {/* The mockup Claude shows beside the option, under the row that picks it (desktop question.rs):
                      its lines kept as written, up to ten tall, then its own scroll; long lines scroll sideways
                      instead of wrapping, so the mockup's columns stay lined up. */}
                  {preview.length > 0 ? (
                    <ScrollView style={styles.optionPreview} nestedScrollEnabled persistentScrollbar>
                      <ScrollView
                        horizontal
                        nestedScrollEnabled
                        persistentScrollbar
                        contentContainerStyle={styles.optionPreviewLines}
                      >
                        <Text style={styles.commandText} selectable>
                          {preview.replace(/\n+$/, '')}
                        </Text>
                      </ScrollView>
                    </ScrollView>
                  ) : null}
                </View>
              );
            })}
          </ScrollView>
          {card.reconnecting === true ? <Text style={cardText.hint}>{RECONNECTING_NOTE}</Text> : null}
        </View>
      )}
    </AskCard>
  );
}

const useStyles = themedStyles((P) => ({
  body: {
    gap: 12,
  },
  shrinks: {
    flexShrink: 1,
    minHeight: 0,
  },
  questionScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  question: {
    color: P.foreground,
    fontSize: 15,
    lineHeight: 22,
  },
  multiHint: {
    marginTop: -6,
  },
  options: {
    gap: 8,
  },
  answerField: {
    flexGrow: 1,
    flexBasis: 160,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: P.inputBorder,
    backgroundColor: P.light ? P.background : P.cardRow,
  },
  answerInput: {
    flex: 1,
    minWidth: 0,
    maxHeight: 96,
    color: P.foreground,
    fontSize: 13.5,
    lineHeight: 20,
    paddingVertical: 6,
    paddingHorizontal: 0,
  },
  spacer: {
    flexGrow: 1,
  },
  optionWithPreview: {
    gap: 6,
  },
  optionPreview: {
    // Ten 20px lines and the padding.
    maxHeight: 216,
    flexGrow: 0,
    marginLeft: 28,
    borderRadius: 8,
    backgroundColor: P.wellFill,
  },
  optionPreviewLines: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  commandText: {
    color: P.cardMuted,
    fontFamily: MONO_FONT,
    fontSize: 13,
    lineHeight: 20,
  },
}));
