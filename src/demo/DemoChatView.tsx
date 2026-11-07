/**
 * Chat for a demo session. The transcript and the reply live in the demo world,
 * so this view never mounts the Rust chat core and never opens a socket.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { useAppearance, type Appearance } from '../theme/useAppearance';
import { DemoCopy } from './copy';
import { demoProjectName, demoTranscript, sendDemoMessage, type DemoTurn } from './world';

type Props = {
  sessionId: string;
  visible: boolean;
  style?: StyleProp<ViewStyle>;
};

export default function DemoChatView({ sessionId, visible, style }: Props) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const [turns, setTurns] = useState<readonly DemoTurn[]>(() => demoTranscript(sessionId));
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState<string | null>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const streamTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setTurns(demoTranscript(sessionId));
    setStreaming(null);
    setDraft('');
  }, [sessionId]);

  useEffect(() => {
    return () => {
      if (streamTimer.current !== null) clearInterval(streamTimer.current);
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [turns, streaming]);

  const send = (): void => {
    const text = draft.trim();
    if (text.length === 0 || streaming !== null) return;
    setDraft('');
    const reply = sendDemoMessage(sessionId, text);
    const committed = demoTranscript(sessionId).slice(0, -1);
    setTurns(committed);
    setStreaming('');
    let shown = 0;
    streamTimer.current = setInterval(() => {
      shown = Math.min(reply.length, shown + 3);
      setStreaming(reply.slice(0, shown));
      if (shown >= reply.length) {
        if (streamTimer.current !== null) clearInterval(streamTimer.current);
        streamTimer.current = null;
        setStreaming(null);
        setTurns(demoTranscript(sessionId));
      }
    }, 16);
  };

  return (
    <KeyboardAvoidingView
      style={[styles.root, !visible ? styles.hidden : null, style]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      pointerEvents={visible ? 'auto' : 'none'}
    >
      <Text style={styles.note}>{DemoCopy.chatNote}</Text>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.transcript} keyboardShouldPersistTaps="handled">
        {turns.map((turn) => (
          <Message key={turn.id} turn={turn} styles={styles} />
        ))}
        {streaming !== null ? (
          <Message turn={{ id: 'streaming', role: 'agent', text: streaming }} styles={styles} />
        ) : null}
      </ScrollView>
      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={`Message ${demoProjectName(sessionId)}`}
          placeholderTextColor={appearance.muted}
          style={styles.input}
          multiline
          accessibilityLabel="Message"
          editable={streaming === null}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          disabled={draft.trim().length === 0 || streaming !== null}
          onPress={send}
          style={({ pressed }) => [styles.send, pressed ? styles.sendPressed : null]}
        >
          <Text style={styles.sendLabel}>Send</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

function Message({ turn, styles }: { turn: DemoTurn; styles: ReturnType<typeof createStyles> }) {
  const mine = turn.role === 'user';
  return (
    <View style={[styles.bubble, mine ? styles.userBubble : styles.agentBubble]}>
      <Text style={styles.role}>{mine ? 'You' : 'Agent'}</Text>
      <Text style={styles.body}>{turn.text}</Text>
    </View>
  );
}

const createStyles = (appearance: Appearance) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: appearance.background },
    hidden: { display: 'none' },
    note: {
      color: appearance.muted,
      fontSize: 13,
      lineHeight: 18,
      paddingHorizontal: 16,
      paddingTop: 10,
      paddingBottom: 4,
    },
    transcript: { paddingHorizontal: 16, paddingBottom: 12, gap: 10 },
    bubble: { maxWidth: '92%', borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, gap: 4 },
    userBubble: { alignSelf: 'flex-end', backgroundColor: appearance.accent },
    agentBubble: { alignSelf: 'flex-start', backgroundColor: appearance.card, borderWidth: 1, borderColor: appearance.border },
    role: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase', color: appearance.muted },
    body: { fontSize: 16, lineHeight: 22, color: appearance.foreground },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: appearance.border,
    },
    input: {
      flex: 1,
      minHeight: 40,
      maxHeight: 120,
      color: appearance.foreground,
      fontSize: 16,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: appearance.border,
      backgroundColor: appearance.card,
    },
    send: {
      backgroundColor: appearance.accent,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    sendPressed: { opacity: 0.8 },
    sendLabel: { color: appearance.accentForeground, fontSize: 15, fontWeight: '600' },
  });
