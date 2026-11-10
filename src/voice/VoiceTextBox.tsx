/**
 * The voice screen's text box: type to the voice agent instead of speaking, muted or not. A sent
 * message is the user's turn in the running call (`sendVoiceText`, conversation.ts has the
 * DECISION); gxserver shows it as your caption and the agent answers it like a spoken one. Typing
 * never touches Mute. What could not be sent stays in the box, with why under it.
 */

import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Glyph } from '../chat/native/transcript/icons';
import { GhostexRadii } from '../theme/palette';
import { useAppearance, type Appearance } from '../theme/useAppearance';
import { sendVoiceText, useVoiceStore } from './conversation';

/** A typed turn this long is a letter, not a turn (the box stops taking more). */
const MAX_TYPED = 4_000;

export function VoiceTextBox() {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const live = useVoiceStore((state) => state.phase === 'live');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const canSend = live && !sending && text.trim().length > 0;

  const send = () => {
    if (!canSend) return;
    setSending(true);
    setProblem(null);
    void sendVoiceText(text).then((failure) => {
      setSending(false);
      if (failure === null) setText('');
      else setProblem(failure);
    });
  };

  return (
    <View style={styles.wrap}>
      {problem !== null ? (
        <Text style={styles.problem} accessibilityLiveRegion="polite">
          {problem}
        </Text>
      ) : null}
      <View style={styles.row}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={(next) => {
            setText(next);
            if (problem !== null) setProblem(null);
          }}
          placeholder={live ? 'Type to the voice agent' : 'Connecting…'}
          placeholderTextColor={appearance.muted}
          multiline
          maxLength={MAX_TYPED}
          editable={!sending}
          accessibilityLabel="Message to the voice agent"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send to the voice agent"
          accessibilityState={{ disabled: !canSend, busy: sending }}
          disabled={!canSend}
          hitSlop={6}
          onPress={send}
          style={({ pressed }) => [styles.send, !canSend && styles.sendDisabled, pressed && styles.sendPressed]}
        >
          {sending ? (
            <ActivityIndicator size="small" color={appearance.accentForeground} />
          ) : (
            <Glyph name="arrow-up" size={20} color={appearance.accentForeground} strokeWidth={2.4} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const createStyles = (appearance: Appearance) =>
  StyleSheet.create({
    wrap: { paddingHorizontal: 16, paddingBottom: 12, gap: 6 },
    problem: { color: appearance.danger, fontSize: 13, lineHeight: 18 },
    row: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
      backgroundColor: appearance.card,
      borderRadius: GhostexRadii.section,
      paddingLeft: 14,
      paddingRight: 6,
      paddingVertical: 6,
    },
    input: {
      flex: 1,
      color: appearance.foreground,
      fontSize: 17,
      lineHeight: 22,
      maxHeight: 22 * 4 + 16,
      paddingTop: 8,
      paddingBottom: 8,
    },
    send: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: appearance.accent,
    },
    sendDisabled: { opacity: 0.4 },
    sendPressed: { opacity: 0.7 },
  });
