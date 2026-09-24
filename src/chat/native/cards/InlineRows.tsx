/**
 * Small pieces the transcript places inside its own rows:
 *
 * - `DeferredWorkNotice`: a completed turn whose work is being read on demand, or failed with
 *   Retry (`document.deferredWork[item.id]`; desktop `deferred_work.rs`).
 * - `StartupDeliveryStatus`: "Waiting for agent…" under an accepted send still waiting for the
 *   terminal, or the failure with Retry and Remove (`message.startupDelivery`; desktop
 *   `startup_delivery.rs`).
 * - `InterAgentMessageCard`: a message another agent sent with `ghostex agents send`
 *   (`message.interAgentMessage`; desktop `inter_agent_message.rs`). The body is Markdown, so the
 *   transcript hands in its own renderer.
 */

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ChatDocument, CompletedWorkItem, ProjectedMessage } from '../../rust/document';
import type { RustChat } from '../../rust/useRustChat';
import { asJson, obj, str } from './json';
import { ChatCardPalette as P } from './palette';
import { CardHeader, StatusCard } from './primitives';

export function DeferredWorkNotice({
  chat,
  document,
  item,
}: {
  chat: RustChat;
  document: ChatDocument;
  item: Pick<CompletedWorkItem, 'id' | 'deferred'>;
}) {
  const state = document.deferredWork?.[item.id];
  if (state === undefined || state === null) return null;
  const error = typeof state.error === 'string' ? state.error : '';
  const failed = error.length > 0;
  return (
    <View style={styles.deferred}>
      <Text style={[styles.deferredText, failed && { color: P.error }]}>{failed ? error : 'Loading work details…'}</Text>
      {failed ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retry"
          hitSlop={6}
          onPress={() => chat.dispatch({ type: 'loadWork', id: item.id, work: asJson(item.deferred) })}
          style={({ pressed }) => [styles.retry, pressed && { backgroundColor: 'rgba(29,29,29,0.4)' }]}
        >
          <Text style={styles.retryLabel}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function StartupDeliveryStatus({ chat, message }: { chat: RustChat; message: ProjectedMessage }) {
  const delivery = message.startupDelivery;
  if (delivery === undefined || delivery === null || typeof delivery !== 'object') return null;
  const failed = delivery.state === 'failed';
  const status = failed ? delivery.errorMessage || 'Message could not be delivered.' : 'Waiting for agent…';
  const promptId = delivery.promptId;
  return (
    <View accessibilityRole="text" style={styles.delivery}>
      <Text style={styles.deliveryText}>{status}</Text>
      {failed ? (
        <>
          <DeliveryAction label="Retry" onPress={() => chat.dispatch({ type: 'retryQueue', promptId })} />
          <DeliveryAction label="Remove" onPress={() => chat.dispatch({ type: 'removeQueue', promptId })} />
        </>
      ) : null}
    </View>
  );
}

function DeliveryAction({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.deliveryAction, pressed && { backgroundColor: P.border }]}
    >
      <Text style={styles.deliveryActionLabel}>{label}</Text>
    </Pressable>
  );
}

export function InterAgentMessageCard({
  chat,
  message,
  renderMarkdown,
}: {
  chat: RustChat;
  message: ProjectedMessage;
  /** The transcript's Markdown renderer for the body; plain text without it. */
  renderMarkdown?: (text: string) => ReactNode;
}) {
  const sent = obj(message.interAgentMessage);
  const session = str(sent, 'sessionTitle');
  const body = str(sent, 'body');
  const header = (
    <CardHeader
      icon="message"
      title={`Message from ${str(sent, 'agentName')}`}
      titleAddon={
        session.length > 0 ? (
          <Text style={styles.session} numberOfLines={1}>
            {session}
          </Text>
        ) : undefined
      }
      trailing={message.queued === true ? <Text style={styles.queued}>QUEUED</Text> : undefined}
    />
  );
  const status = <StartupDeliveryStatus key="delivery" chat={chat} message={message} />;
  return (
    <StatusCard
      header={header}
      body={
        body.length > 0
          ? [
              <View key="body">
                {renderMarkdown ? renderMarkdown(body) : <Text style={styles.prose}>{body}</Text>}
              </View>,
            ]
          : []
      }
      actions={message.startupDelivery ? [status] : []}
    />
  );
}

const styles = StyleSheet.create({
  deferred: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  deferredText: {
    flexShrink: 1,
    color: P.muted,
    fontSize: 14,
  },
  retry: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  retryLabel: {
    color: P.muted,
    fontSize: 14,
  },
  delivery: {
    width: '100%',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 4,
  },
  deliveryText: {
    color: P.muted,
    fontSize: 12,
  },
  deliveryAction: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 5,
  },
  deliveryActionLabel: {
    color: P.primary,
    fontSize: 12,
  },
  session: {
    flexShrink: 1,
    color: P.muted,
    fontSize: 14,
  },
  queued: {
    color: P.muted,
    fontSize: 11,
    lineHeight: 20,
  },
  prose: {
    color: P.prose,
    fontSize: 14,
    lineHeight: 22,
  },
});
