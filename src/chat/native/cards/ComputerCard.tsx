/**
 * The card above the chat box while the session's computer is offline (`computerNotice`, decided in
 * gx-chat-core `session/computer.rs`): "Windows PC is offline · last seen 2h ago" and Retry, or
 * "… isn't answering · checking…" with a spinner while a message to it got no answer.
 *
 * CDXC:RemoteMachines 2026-11-08 DECISION:
 * User, on the offline-notice page: the card above the chat box (Q1831 "card"), with the "Worked
 * for …" bar below it ("pls swap the placement of the working bar and this new card"), Retry as
 * its only action (Q1835), never red, and the phone in the same release (Q1839). It takes the
 * place of "Reconnecting to …" while it shows, so the computer is named once. The desktop draws
 * the same card in apps/desktop/src/app/native_chat/computer_card.rs.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ChatDocument } from '../../rust/document';
import { Glyph } from '../transcript/icons';
import { SINGLE_LINE_CARD, SINGLE_LINE_TITLE, singleLineShell } from '../transcript/singleLineCard';
import { useTranscriptTheme } from '../transcript/theme';
import { STACK_GAP } from './NativeChatCards';
import { Spinner } from './primitives';
import { cardGap, workingCardShown } from './WorkingCard';

export function ComputerCard({ document, onRetry }: { document: ChatDocument | null; onRetry: () => void }) {
  const theme = useTranscriptTheme();
  const notice = document?.computerNotice;
  if (document === null || notice === undefined || notice === null) return null;
  const label =
    notice.detail !== undefined && notice.detail.length > 0 ? `${notice.title} · ${notice.detail}` : notice.title;
  return (
    <View
      style={[styles.row, { paddingBottom: workingCardShown(document) ? STACK_GAP : cardGap(document) }]}
      accessibilityLiveRegion="polite"
    >
      <View style={[singleLineShell(theme), styles.card]} accessible accessibilityLabel={label}>
        <View style={styles.lead}>
          <Glyph name="device-desktop" size={SINGLE_LINE_CARD.tile.glyphSize} color={theme.muted} />
        </View>
        <Text style={[SINGLE_LINE_TITLE, styles.title, { color: theme.cardMuted }]} numberOfLines={1}>
          {label}
        </Text>
        {notice.checking === true ? (
          <Spinner size={SINGLE_LINE_CARD.tile.glyphSize} color={theme.muted} />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retry"
            hitSlop={8}
            onPress={onRetry}
            style={({ pressed }) => [
              styles.retry,
              { backgroundColor: pressed ? theme.neutralFillPressed : theme.neutralFill },
            ]}
          >
            <Text style={[styles.retryLabel, { color: theme.primary }]}>Retry</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  card: {
    height: SINGLE_LINE_CARD.height,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: SINGLE_LINE_CARD.paddingX,
  },
  lead: {
    width: SINGLE_LINE_CARD.tile.size,
    height: SINGLE_LINE_CARD.tile.size,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flex: 1,
    minWidth: 0,
  },
  retry: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 6,
  },
  retryLabel: {
    fontSize: 12,
    lineHeight: 17,
  },
});
