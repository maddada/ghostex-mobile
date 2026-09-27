/**
 * A `/btw` side question kept in the transcript after Close (desktop `side_question_row` in
 * `native_chat/side_question.rs`): folded to one line where it was asked, opening to the answer.
 */

import * as Clipboard from 'expo-clipboard';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Json, ProjectedMessage } from '../../rust/document';
import { ChatButton } from '../cards/primitives';
import { SideBadge, SideAnswer } from '../cards/SideQuestionCard';
import { useNativeChatUi, useTranscriptEnv } from './context';
import { Chevron } from './Disclosure';
import { obj, str } from './json';
import { useDisclosure } from './state';

export function SideQuestionRow({ message }: { message: ProjectedMessage }) {
  const { theme, dispatch } = useTranscriptEnv();
  const { disclosures } = useNativeChatUi();
  const card = obj(message.sideQuestion);
  const [open, toggle] = useDisclosure(disclosures, `side-question:${message.id}`);
  const answer = str(card, 'answer');
  return (
    <View style={styles.row}>
      <View style={[styles.box, { borderColor: theme.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Side question: ${str(card, 'question')}`}
          accessibilityState={{ expanded: open }}
          onPress={toggle}
          style={({ pressed }) => [styles.header, pressed && { backgroundColor: theme.pressed }]}
        >
          <Chevron open={open} color={theme.muted} />
          <SideBadge />
          <Text style={[styles.question, { color: theme.foreground }]} numberOfLines={1}>
            {str(card, 'question')}
          </Text>
          <Text style={[styles.time, { color: theme.muted }]}>{typeof message.time === 'string' ? message.time : ''}</Text>
        </Pressable>
        {open ? (
          <View style={[styles.body, { borderTopColor: theme.border }]}>
            {answer.length > 0 ? (
              <SideAnswer dispatch={dispatch} markdown={str(card, 'answerMarkdown')} references={card?.answerReferences as Json} />
            ) : (
              <Text style={[styles.note, { color: theme.muted }]}>No answer was saved for this side question.</Text>
            )}
            <View style={styles.footer}>
              <Text style={[styles.note, { color: theme.muted }]}>Not added to the conversation</Text>
              {answer.length > 0 ? <ChatButton label="Copy" icon="copy" onPress={() => void Clipboard.setStringAsync(answer)} /> : null}
            </View>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingBottom: 13 },
  box: { borderWidth: 1, borderRadius: 10, overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  question: { flex: 1, minWidth: 0, fontSize: 13 },
  time: { fontSize: 12 },
  body: { borderTopWidth: 1, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8, gap: 6 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  note: { flex: 1, fontSize: 12 },
});
