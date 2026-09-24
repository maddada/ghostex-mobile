/**
 * Ghostex's own prompt queue above the input (`queue.rs`, React's `session-chat-queue-rows.tsx`):
 * one line per prompt with its grip, preview, and Retry / Edit / Send now / Delete. A phone has no
 * hover, so the controls stay on screen (React's `@media (hover: none)` rule). Dragging the grip
 * moves a row (`moveQueue`, the drop desktop sends).
 */

import { useRef, useState } from 'react';
import { ActivityIndicator, Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import type { UserAction } from '../../rust/actions';
import type { ChatDocument, QueuedPrompt } from '../../rust/document';
import { Glyph, type GlyphName } from './icons';
import { ComposerPalette as P } from './palette';

const ROW_HEIGHT = 34;
const ROW_GAP = 4;

export function QueueList({ document, dispatch }: { document: ChatDocument; dispatch: (action: UserAction) => void }) {
  const prompts = document.queue.prompts.filter((prompt) => prompt.startupSend !== true);
  const capabilities = document.queue.capabilities;
  if (!capabilities.supported || prompts.length === 0) return null;
  const blocked = typeof document.sendBlockedReason === 'string';
  const canDrag = !blocked && prompts.length > 1 && capabilities.canReorder;
  return (
    <View style={styles.list} accessibilityLabel="Queued prompts">
      {prompts.map((prompt, index) => (
        <QueueRow
          key={prompt.id}
          prompt={prompt}
          index={index}
          count={prompts.length}
          canDrag={canDrag}
          blocked={blocked}
          capabilities={capabilities}
          onMove={(to) => {
            const target = prompts[to];
            if (target !== undefined && to !== index) dispatch({ type: 'moveQueue', promptId: prompt.id, targetId: target.id });
          }}
          dispatch={dispatch}
        />
      ))}
    </View>
  );
}

function QueueRow({
  prompt,
  index,
  count,
  canDrag,
  blocked,
  capabilities,
  onMove,
  dispatch,
}: {
  prompt: QueuedPrompt;
  index: number;
  count: number;
  canDrag: boolean;
  blocked: boolean;
  capabilities: ChatDocument['queue']['capabilities'];
  onMove: (to: number) => void;
  dispatch: (action: UserAction) => void;
}) {
  const busy = prompt.busy;
  const failed = prompt.state === 'failed';
  const locked = blocked || busy;
  const offset = useRef(new Animated.Value(0)).current;
  const [dragging, setDragging] = useState(false);
  const latest = useRef({ index, count, onMove });
  latest.current = { index, count, onMove };
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => setDragging(true),
      onPanResponderMove: (_, gesture) => offset.setValue(gesture.dy),
      onPanResponderRelease: (_, gesture) => {
        const { index: from, count: total, onMove: move } = latest.current;
        const to = Math.min(total - 1, Math.max(0, from + Math.round(gesture.dy / (ROW_HEIGHT + ROW_GAP))));
        offset.setValue(0);
        setDragging(false);
        move(to);
      },
      onPanResponderTerminate: () => {
        offset.setValue(0);
        setDragging(false);
      },
    })
  ).current;

  const actions: { glyph: GlyphName; label: string; action: UserAction; show: boolean; disabled: boolean }[] = [
    { glyph: 'refresh', label: 'Retry', action: { type: 'retryQueue', promptId: prompt.id }, show: capabilities.canRetry && failed, disabled: blocked },
    { glyph: 'pencil', label: 'Edit', action: { type: 'removeQueue', promptId: prompt.id, edit: true }, show: capabilities.canEdit, disabled: locked },
    { glyph: 'arrow-up', label: 'Send now', action: { type: 'sendQueue', promptId: prompt.id }, show: capabilities.canSendNow, disabled: locked },
    { glyph: 'trash', label: 'Delete', action: { type: 'removeQueue', promptId: prompt.id }, show: capabilities.canRemove, disabled: locked },
  ];

  return (
    <Animated.View
      style={[
        styles.row,
        failed ? styles.rowFailed : null,
        dragging ? styles.rowDragging : null,
        { transform: [{ translateY: offset }], zIndex: dragging ? 2 : 0 },
      ]}
    >
      {canDrag && !busy ? (
        <View {...responder.panHandlers} style={styles.grip} accessibilityRole="adjustable" accessibilityLabel="Reorder queued prompt">
          <Glyph name="grip-vertical" size={15} color={P.muted} strokeWidth={1.8} />
        </View>
      ) : (
        <View style={[styles.grip, busy ? null : styles.gripInert]}>
          {busy ? <ActivityIndicator size="small" color={P.muted} /> : <Glyph name="grip-vertical" size={15} color={P.muted} strokeWidth={1.8} />}
        </View>
      )}
      <Text style={[styles.text, failed ? styles.textFailed : null, prompt.state === 'sending' ? styles.textSending : null]} numberOfLines={1}>
        {prompt.preview}
      </Text>
      {failed ? (
        <View style={styles.error}>
          <Glyph name="alert-triangle" size={13} color={P.error} />
          <Text style={styles.errorText} numberOfLines={1}>
            {`Not delivered: ${prompt.errorMessage ?? 'the send failed.'}`}
          </Text>
        </View>
      ) : null}
      {actions
        .filter((entry) => entry.show)
        .map((entry) => (
          <Pressable
            key={entry.label}
            accessibilityRole="button"
            accessibilityLabel={entry.label}
            disabled={entry.disabled}
            hitSlop={4}
            onPress={() => dispatch(entry.action)}
            style={({ pressed }) => [styles.action, pressed ? styles.actionPressed : null, entry.disabled ? styles.disabled : null]}
          >
            <Glyph name={entry.glyph} size={15} color={P.muted} />
          </Pressable>
        ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  list: { gap: ROW_GAP, paddingBottom: 6, maxHeight: 5 * (ROW_HEIGHT + ROW_GAP) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    height: ROW_HEIGHT,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: 'rgba(29,29,29,0.9)',
    paddingRight: 2,
    backgroundColor: P.composerBackground,
  },
  rowFailed: {},
  rowDragging: { backgroundColor: '#222222', opacity: 0.9 },
  grip: { width: 26, height: ROW_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  gripInert: { opacity: 0.35 },
  text: { flex: 1, minWidth: 64, color: P.muted, fontSize: 13 },
  textFailed: { color: P.error },
  textSending: { opacity: 0.7 },
  error: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1, maxWidth: '45%' },
  errorText: { color: P.error, fontSize: 11.5, flexShrink: 1 },
  action: { width: 30, height: 30, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  actionPressed: { backgroundColor: P.pressed },
  disabled: { opacity: 0.4 },
});
