/**
 * The subagent transcript viewer: a subagent's own transcript in a sheet over the chat, opened
 * from a fleet row or a subagent link (`openSubagent`). Port of desktop `subagent_view.rs`: the
 * header state is `document.subagent`, the rows are `state.subagentItems` (their own splice
 * channel), and back / close / retry / load earlier are the core's actions.
 *
 * The rows are drawn by the transcript's row renderer when the screen hands one in
 * (`renderItem`), so a subagent's transcript reads like the main one; without it a plain reading
 * of each row stands in.
 */

import type { ReactNode } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { transcriptItemKey, type ProjectedMessage, type TranscriptItem } from '../../rust/document';
import type { RustChat } from '../../rust/useRustChat';
import { Glyph, type GlyphName } from './icons';
import { isTrue, obj, str } from './json';
import { ChatCardPalette as P } from './palette';
import { ChatButton } from './primitives';

export type TranscriptItemRenderer = (item: TranscriptItem, index: number) => ReactNode;

export function SubagentViewer({ chat, renderItem }: { chat: RustChat; renderItem?: TranscriptItemRenderer }) {
  const insets = useSafeAreaInsets();
  const state = obj(chat.state?.document?.subagent);
  const items = chat.state?.subagentItems ?? [];
  if (state === null) return null;
  const { dispatch } = chat;
  const close = () => dispatch({ type: 'subagentClose' });
  const error = str(state, 'error');
  const loading = isTrue(state, 'loading');
  const hasMore = isTrue(state, 'hasMore');

  return (
    <Modal visible transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <View style={[styles.backdrop, { paddingTop: insets.top + 12, paddingBottom: insets.bottom + 12 }]}>
        <Pressable accessibilityLabel="Close subagent transcript" style={StyleSheet.absoluteFill} onPress={close} />
        <View style={styles.card}>
          <View style={styles.header}>
            {isTrue(state, 'canBack') ? (
              <IconButton label="Back to previous subagent" icon="chevron-left" onPress={() => dispatch({ type: 'subagentBack' })} />
            ) : null}
            <View style={styles.titles}>
              <Text style={styles.title} numberOfLines={1} accessibilityHint={str(state, 'tooltip') || undefined}>
                {str(state, 'title')}
              </Text>
              <Text style={styles.description} numberOfLines={1}>
                {str(state, 'description')}
              </Text>
            </View>
            <IconButton label="Close subagent transcript" icon="x" onPress={close} />
          </View>
          {error.length > 0 ? (
            <View accessibilityRole="alert" style={styles.errorRow}>
              <Text style={styles.errorText}>{error}</Text>
              <ChatButton label="Retry" onPress={() => dispatch({ type: 'subagentRetry' })} />
            </View>
          ) : null}
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={P.muted} />
              <Text style={styles.muted}>Loading transcript…</Text>
            </View>
          ) : isTrue(state, 'empty') ? (
            <Text style={[styles.muted, styles.empty]}>This subagent has not written any messages yet.</Text>
          ) : items.length > 0 ? (
            <FlatList
              data={items}
              keyExtractor={(item, index) => `${transcriptItemKey(item)}:${index}`}
              renderItem={({ item, index }) => <>{renderItem ? renderItem(item, index) : <PlainRow item={item} />}</>}
              contentContainerStyle={styles.list}
              ListHeaderComponent={
                hasMore ? (
                  <View style={styles.loadEarlier}>
                    <ChatButton
                      label={isTrue(state, 'loadingEarlier') ? 'Loading…' : 'Load earlier messages'}
                      onPress={() => dispatch({ type: 'subagentLoadEarlier' })}
                    />
                  </View>
                ) : null
              }
            />
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

/** A row read plainly: who said it and what. Stands in until the transcript's renderer is handed in. */
function PlainRow({ item }: { item: TranscriptItem }) {
  const messages: ProjectedMessage[] =
    item.kind === 'message'
      ? [(item as { message: ProjectedMessage }).message]
      : item.kind === 'summary' || item.kind === 'completed-work'
        ? [((item as { final?: ProjectedMessage | null }).final ?? null)].filter((m): m is ProjectedMessage => m !== null)
        : [];
  const label = item.kind === 'completed-work' ? str(item, 'label') : '';
  return (
    <View style={styles.plainRow}>
      {label.length > 0 ? <Text style={styles.muted}>{label}</Text> : null}
      {messages.map((message) => (
        <Text key={message.id} style={message.role === 'user' ? styles.userText : styles.prose} selectable>
          {message.text ?? ''}
        </Text>
      ))}
    </View>
  );
}

function IconButton({ label, icon, onPress }: { label: string; icon: GlyphName; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.iconButton, pressed && { backgroundColor: 'rgba(29,29,29,0.6)' }]}
    >
      <Glyph name={icon} size={16} color={P.primary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    paddingHorizontal: 12,
    justifyContent: 'center',
    backgroundColor: P.backdrop,
  },
  card: {
    flex: 1,
    maxHeight: 860,
    overflow: 'hidden',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: P.border,
    backgroundColor: P.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: P.border,
  },
  titles: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  title: {
    color: P.foreground,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: '500',
  },
  description: {
    color: P.muted,
    fontSize: 12,
  },
  iconButton: {
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  errorText: {
    flex: 1,
    color: P.error,
    fontSize: 14,
  },
  center: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  muted: {
    color: P.muted,
    fontSize: 14,
  },
  empty: {
    padding: 24,
  },
  list: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  loadEarlier: {
    alignItems: 'center',
    paddingBottom: 8,
  },
  plainRow: {
    gap: 4,
  },
  prose: {
    color: P.prose,
    fontSize: 14,
    lineHeight: 22,
  },
  userText: {
    color: P.foreground,
    fontSize: 14,
    lineHeight: 22,
    padding: 10,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: P.input,
  },
});
