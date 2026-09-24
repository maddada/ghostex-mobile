/**
 * The async question strip: questions a still-working agent (Codex) asks without stopping, drawn
 * from `asyncQuestions`. Port of desktop `async_questions.rs`: the same header, the same
 * option rows and the same Skip / Send answer actions and payloads.
 */

import { useCallback } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import type { ChatDocument } from '../../rust/document';
import type { RustChat } from '../../rust/useRustChat';
import { Glyph } from './icons';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';
import { CardButton, ChoiceRow, Spinner } from './primitives';
import { useEchoedText } from './useEchoedText';

export function AsyncQuestionsCard({ chat, document }: { chat: RustChat; document: ChatDocument }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const { dispatch } = chat;
  const { height } = useWindowDimensions();
  const state = document.asyncQuestions;
  const question = state?.question;
  const key = question?.key ?? '';
  const report = useCallback((text: string) => dispatch({ type: 'asyncQuestionText', key, text }), [dispatch, key]);
  const [answer, setAnswer] = useEchoedText(key, state?.draft?.other ?? '', report);
  if (state === undefined || question === undefined || typeof question.key !== 'string') return null;

  const collapsed = state.collapsed;
  const count = state.count || 1;
  const busy = state.disabled;
  const options = question.options ?? [];
  const inputLocked = state.submitting || state.loading;

  const header = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={collapsed ? 'Expand questions from Codex' : 'Collapse questions from Codex'}
      onPress={() => dispatch({ type: 'asyncQuestionToggle' })}
      style={({ pressed }) => [styles.header, pressed && { backgroundColor: P.pressedFill }]}
    >
      <View style={styles.indicator}>
        {state.working ? (
          <View style={StyleSheet.absoluteFill}>
            <Spinner size={16} color={P.asyncSpinner} periodMs={820} />
          </View>
        ) : null}
        <View style={styles.dot} />
      </View>
      <Text style={styles.headerTitle}>{count > 1 ? 'Questions from Codex' : 'Question from Codex'}</Text>
      <Text style={styles.headerMeta} numberOfLines={1}>
        {state.working ? 'Still working' : ''}
      </Text>
      <Text style={styles.headerCount}>{`${state.index + 1}/${count}`}</Text>
      <Glyph name={collapsed ? 'chevron-right' : 'chevron-down'} size={16} color={P.foreground} />
    </Pressable>
  );

  return (
    <View style={styles.card}>
      {header}
      {collapsed ? null : (
        <ScrollView
          style={{ maxHeight: Math.min(360, Math.max(64, height * 0.42 - 44)) }}
          contentContainerStyle={styles.body}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.title}>{question.title}</Text>
          {options.length > 0 ? (
            <View style={styles.options}>
              {options.map((option, optionIndex) => (
                <ChoiceRow
                  key={optionIndex}
                  label={option}
                  selected={state.selected.includes(optionIndex)}
                  disabled={busy}
                  onPress={() => dispatch({ type: 'asyncQuestionOption', key, index: optionIndex })}
                />
              ))}
            </View>
          ) : null}
          <TextInput
            accessibilityLabel="Your answer"
            style={styles.answer}
            value={answer}
            onChangeText={setAnswer}
            editable={!inputLocked}
            multiline
            submitBehavior="submit"
            returnKeyType="send"
            onSubmitEditing={() => dispatch({ type: 'asyncQuestionSend' })}
            placeholder={options.length > 0 ? 'Or write your own answer…' : 'Write your answer…'}
            placeholderTextColor={P.placeholder}
          />
          {state.error.length > 0 ? <Text style={styles.error}>{state.error}</Text> : null}
          {state.canSend === false ? (
            <Text style={styles.readOnly}>Answers are unavailable while this chat is read-only or disconnected.</Text>
          ) : null}
          <View style={styles.actions}>
            {count > 1 ? (
              <>
                <NavButton
                  label="Previous question"
                  icon="chevron-left"
                  disabled={state.previousDisabled}
                  onPress={() => dispatch({ type: 'asyncQuestionNavigate', direction: 'previous' })}
                />
                <NavButton
                  label="Next question"
                  icon="chevron-right"
                  disabled={state.nextDisabled}
                  onPress={() => dispatch({ type: 'asyncQuestionNavigate', direction: 'next' })}
                />
              </>
            ) : null}
            <View style={styles.spacer} />
            <CardButton label="Skip" ghost tint={P.primary} disabled={busy} onPress={() => dispatch({ type: 'asyncQuestionSkip' })} />
            <CardButton
              label={state.submitting ? 'Sending…' : 'Send answer'}
              disabled={busy || state.answer.trim().length === 0}
              onPress={() => dispatch({ type: 'asyncQuestionSend' })}
            />
          </View>
        </ScrollView>
      )}
    </View>
  );
}

function NavButton({
  label,
  icon,
  disabled,
  onPress,
}: {
  label: string;
  icon: 'chevron-left' | 'chevron-right';
  disabled: boolean;
  onPress: () => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [styles.nav, disabled && { opacity: 0.5 }, pressed && { backgroundColor: P.input }]}
    >
      <Glyph name={icon} size={16} color={P.primary} />
    </Pressable>
  );
}

const useStyles = themedStyles((P) => ({
  card: {
    width: '100%',
    overflow: 'hidden',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: P.inputBorder,
    backgroundColor: P.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  indicator: {
    width: 16,
    height: 16,
  },
  dot: {
    position: 'absolute',
    left: 5,
    top: 5,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: P.asyncDot,
  },
  headerTitle: {
    color: P.primary,
    fontSize: 12,
    fontWeight: '500',
  },
  headerMeta: {
    flex: 1,
    minWidth: 0,
    color: P.muted,
    fontSize: 12,
  },
  headerCount: {
    color: P.muted,
    fontSize: 12,
  },
  body: {
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  title: {
    color: P.foreground,
    fontSize: 13,
    lineHeight: 18,
  },
  options: {
    gap: 6,
  },
  answer: {
    minHeight: 60,
    maxHeight: 118,
    color: P.foreground,
    fontSize: 13,
    lineHeight: 20,
    borderWidth: 1,
    borderColor: P.inputBorder,
    borderRadius: 12,
    backgroundColor: P.background,
    paddingHorizontal: 10,
    paddingVertical: 8,
    textAlignVertical: 'top',
  },
  error: {
    color: '#ef4444',
    fontSize: 13,
  },
  readOnly: {
    color: P.muted,
    fontSize: 13,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
  },
  spacer: {
    flex: 1,
  },
  nav: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
