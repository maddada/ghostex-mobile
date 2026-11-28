/**
 * Chat for a demo session. The transcript and the reply live in the demo world,
 * so this view never mounts the Rust chat core and never opens a socket.
 *
 * CDXC:SessionChat 2026-11-28 WHY:
 * 12.5.0 smoke on the iPhone: in the demo a sideways swipe never changed tabs (a rightward one went back to Sessions)
 * and the keyboard covered the chat box. The demo chat had neither the real chat's tab swipe (`TabSwipe.tsx`) nor its
 * keyboard lift (`useKeyboardInset`, as the chat box's `KeyboardLiftedView`); React Native's KeyboardAvoidingView
 * here lifted nothing. It now uses both, so the demo shows what a paired computer's chat does.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ScrollViewInstance,
  type StyleProp,
  type ViewInstance,
  type ViewStyle,
} from 'react-native';
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler';

import { useHorizontalSwipeGesture } from '../components/common/HorizontalSwipe';
import { useKeyboardInset } from '../chat/native/composer/useKeyboardInset';
import { TabSwipeView, type TabSwipe } from '../chat/native/TabSwipe';
import { userBubbleTint } from '../chat/native/transcript/theme';
import { useAppearance, type Appearance } from '../theme/useAppearance';
import { DemoCopy } from './copy';
import { demoProjectName, demoTranscript, sendDemoMessage, type DemoTurn } from './world';

type Props = {
  sessionId: string;
  visible: boolean;
  /** A sideways swipe on the transcript goes to the previous or next tab, as in the real chat; null: no swipe. */
  tabSwipe: TabSwipe | null;
  /** Kept warm for a recent tab while another is shown (`WarmChats.tsx`). */
  parked: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Space between the chat box and the keyboard's top edge (the real chat box's `KEYBOARD_GAP`). */
const KEYBOARD_GAP = 8;
/** The chat box's own space below its field without a keyboard. */
const COMPOSER_PADDING = 10;

export default function DemoChatView({ sessionId, visible, tabSwipe, parked, style }: Props) {
  const appearance = useAppearance();
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const [turns, setTurns] = useState<readonly DemoTurn[]>(() => demoTranscript(sessionId));
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState<string | null>(null);
  const scrollRef = useRef<ScrollViewInstance>(null);
  const composerRef = useRef<ViewInstance>(null);
  const { inset: keyboardInset, onAnchorLayout } = useKeyboardInset(composerRef);
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
    <View style={[styles.root, !visible ? styles.hidden : null, style]} pointerEvents={visible ? 'auto' : 'none'}>
      <Text style={styles.note}>{DemoCopy.chatNote}</Text>
      <TabSwipeView swipe={tabSwipe} shown={!parked}>
        <DemoTranscript scrollRef={scrollRef} contentStyle={styles.transcript}>
          {turns.map((turn) => (
            <Message key={turn.id} turn={turn} styles={styles} />
          ))}
          {streaming !== null ? (
            <Message turn={{ id: 'streaming', role: 'agent', text: streaming }} styles={styles} />
          ) : null}
        </DemoTranscript>
      </TabSwipeView>
      <View
        ref={composerRef}
        onLayout={onAnchorLayout}
        style={[styles.composer, { paddingBottom: keyboardInset > 0 ? keyboardInset + KEYBOARD_GAP : COMPOSER_PADDING }]}
      >
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
    </View>
  );
}

/** The transcript's vertical scroll, which waits for the tab swipe to see a drag is more vertical than sideways. */
function DemoTranscript({
  scrollRef,
  contentStyle,
  children,
}: {
  scrollRef: RefObject<ScrollViewInstance | null>;
  contentStyle: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const swipePan = useHorizontalSwipeGesture();
  return (
    <GestureScrollView
      ref={scrollRef}
      contentContainerStyle={contentStyle}
      keyboardShouldPersistTaps="handled"
      requireToFail={swipePan ?? undefined}
    >
      {children}
    </GestureScrollView>
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
    // The chat's own bubble: a soft blue tint over the page, under the normal text colour (the accent fill left dark text on dark navy in the light theme and light text on pale blue in the dark one).
    userBubble: { alignSelf: 'flex-end', backgroundColor: userBubbleTint(appearance.background, appearance.light) },
    agentBubble: { alignSelf: 'flex-start', backgroundColor: appearance.card, borderWidth: 1, borderColor: appearance.border },
    role: { fontSize: 11, fontWeight: '700', letterSpacing: 0.3, textTransform: 'uppercase', color: appearance.muted },
    body: { fontSize: 16, lineHeight: 22, color: appearance.foreground },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
      paddingHorizontal: 12,
      paddingTop: COMPOSER_PADDING,
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
      backgroundColor: appearance.primaryFill,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    sendPressed: { backgroundColor: appearance.primaryFillPressed },
    sendLabel: { color: appearance.foreground, fontSize: 15, fontWeight: '600' },
  });
