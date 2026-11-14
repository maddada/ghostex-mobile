/**
 * How a finished turn draws inside an opened Quiet View line (gx-chat-core `QuietTurnLook`, where
 * the user's decision is): its card titled by its calls ("4 tool calls") when the line already says
 * its time, or, when the line holds several turns, its calls straight on the line's rail with a
 * "Then · 22s" mark between turns. `QuietRow` (quietView.tsx) provides the look of the row it
 * draws; `CompletedWorkRow` and `GroupedWorkRow` read it. Desktop: `quiet_turn` in
 * native_chat/state.rs, `flat_turn_row` in completed_work_row.rs, `quiet_turn_mark` in quiet_view.rs.
 */

import { createContext, useContext } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { QuietTurnLook } from '../../rust/document';
import { useTranscriptEnv } from './context';
import { SINGLE_LINE_CARD } from './singleLineCard';

export const QuietTurnContext = createContext<QuietTurnLook | null>(null);

/** The look of the finished turn row being drawn, or `null` outside an opened Quiet View line. */
export function useQuietTurn(): QuietTurnLook | null {
  return useContext(QuietTurnContext);
}

/** "Then · 22s": the pills' small type in the muted tone, then a hairline to the column's end. */
export function QuietTurnMark({ text }: { text: string }) {
  const { theme } = useTranscriptEnv();
  return (
    <View style={styles.mark}>
      <Text style={[styles.markText, { color: theme.muted }]}>{text}</Text>
      <View style={[styles.markRule, { backgroundColor: theme.ink(SINGLE_LINE_CARD.borderAlpha) }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  mark: { flexDirection: 'row', alignItems: 'center', gap: 8, minWidth: 0 },
  markText: { fontSize: SINGLE_LINE_CARD.pill.textSize, lineHeight: SINGLE_LINE_CARD.pill.lineHeight, flexShrink: 0 },
  markRule: { flex: 1, height: StyleSheet.hairlineWidth },
});
