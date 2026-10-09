/**
 * The action row under a message (desktop `message_actions.rs`, React `CopyFooter`): a final
 * reply's Copy and Save to md then its time, starting at the prose column; a prompt's time then Rewind, Save
 * prompt and Copy, right-aligned under the bubble. A phone has no hover, so the row always shows
 * (React's `@media (pointer: coarse)` rule).
 */

import * as Clipboard from 'expo-clipboard';
import { memo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { ProjectedMessage } from '../../rust/document';
import { useTranscriptEnv, useTranscriptFlags } from './context';
import { Glyph, type GlyphName } from './icons';
import { arr, obj, str } from './json';
import { rememberSaveMarkdown } from './saveMarkdownStore';
import { PROSE_COLUMN } from './theme';

function ActionButton({ label, glyph, onPress }: { label: string; glyph: GlyphName; onPress(): void }) {
  const { theme } = useTranscriptEnv();
  return (
    <Pressable
      hitSlop={6}
      onPress={onPress}
      accessibilityRole='button'
      accessibilityLabel={label}
      style={({ pressed }) => [styles.button, pressed && { backgroundColor: theme.pressed }]}
    >
      <Glyph name={glyph} size={13} color={theme.muted} />
    </Pressable>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <ActionButton
      label={copied ? 'Copied' : label}
      glyph={copied ? 'saved' : 'copy'}
      onPress={() => {
        void Clipboard.setStringAsync(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    />
  );
}

function MessageTime({ message }: { message: ProjectedMessage }) {
  const { theme } = useTranscriptEnv();
  const label = str(message.time, 'label');
  if (label.length === 0) return null;
  return (
    <Text style={[styles.time, { color: theme.muted }]} accessibilityLabel={str(message.time, 'title') || label}>
      {label}
    </Text>
  );
}

/**
 * A turn's final answer with no tool calls of its own: drawn flush with the chat column, without
 * the reply dot (desktop `is_flush_reply` in native_chat/message_actions.rs).
 */
export function isFlushReply(message: ProjectedMessage, finalIds: ReadonlySet<string>): boolean {
  return message.role === 'assistant' && arr(message.tools).length === 0 && finalIds.has(message.id);
}

/** Whether a reply gets its actions: a copyable assistant row whose turn is final. */
export function hasReplyActions(message: ProjectedMessage, finalIds: ReadonlySet<string>): boolean {
  return message.role === 'assistant' && obj(message.actionContent)?.copyable === true && finalIds.has(message.id);
}

/**
 * Desktop's reply row: Copy, Reply by Annotating, Save to md, then the time. Reply by Annotating
 * opens the reply in the desktop Docs review surface, which the phone does not have, so it is left
 * out rather than drawn as a control that does nothing.
 */
export const ReplyActions = memo(function ReplyActions({ message, flush }: { message: ProjectedMessage; flush: boolean }) {
  const { dispatch } = useTranscriptEnv();
  const markdown = typeof message.copyText === 'string' ? message.copyText : '';
  const canSave = obj(message.actionContent)?.canSaveMarkdown === true;
  return (
    <View style={[styles.row, { paddingLeft: flush ? 0 : PROSE_COLUMN }]}>
      <View style={styles.buttons}>
        <CopyButton text={markdown} label='Copy message' />
        {canSave ? (
          <ActionButton
            label='Save message to Markdown'
            glyph='save'
            onPress={() => {
              rememberSaveMarkdown(markdown);
              dispatch({ type: 'markdownSaveOpen', markdown });
            }}
          />
        ) : null}
      </View>
      <MessageTime message={message} />
    </View>
  );
});

/**
 * Desktop's `delivery_indicator` (`startup_delivery.rs`): a spinner while the send waits for the
 * agent's terminal, a play button while the agent holds it queued behind its running turn, drawn
 * left of the bubble level with its last line. A tap on play sends one Escape so the agent takes
 * the queued prompt now.
 */
export function DeliveryIndicator({ message }: { message: ProjectedMessage }) {
  const { theme, dispatch } = useTranscriptEnv();
  const delivery = message.startupDelivery;
  const waiting = delivery !== undefined && delivery !== null && delivery.state !== 'failed';
  const queued = message.queued === true && (delivery === undefined || delivery === null);
  if (waiting) {
    return (
      <View style={[styles.button, styles.indicator]} accessibilityRole='progressbar' accessibilityLabel='Waiting for agent'>
        <ActivityIndicator size={13} color={theme.muted} />
      </View>
    );
  }
  if (!queued) return null;
  return (
    <View style={styles.indicator}>
      <ActionButton label='Queued, tap to interrupt and send' glyph='player-play' onPress={() => dispatch({ type: 'sendKey', key: 'escape' })} />
    </View>
  );
}

export const UserActions = memo(function UserActions({ message }: { message: ProjectedMessage }) {
  const { dispatch, main } = useTranscriptEnv();
  const flags = useTranscriptFlags();
  const prompt = typeof message.copyText === 'string' ? message.copyText : '';
  if (prompt.length === 0) return null;
  const saved = flags.savedPrompts[message.id];
  // A rewind types into this session's own pane, so a subagent's transcript never offers one.
  const rewindable = main && message.canRewind === true && flags.rewindAvailable && flags.rewindEnabled;
  return (
    <View style={[styles.row, styles.userRow]}>
      <MessageTime message={message} />
      <View style={styles.buttons}>
        {rewindable ? (
          <ActionButton
            label='Rewind to here'
            glyph='rewind'
            onPress={() => dispatch({ type: 'rewindOpen', messageId: message.id, prompt })}
          />
        ) : null}
        {flags.canSavePrompt ? (
          <ActionButton
            label={
              saved === 'saved'
                ? 'Prompt saved'
                : saved === 'saving'
                  ? 'Saving prompt'
                  : saved === 'error'
                    ? 'Could not save prompt. Tap to retry.'
                    : 'Save prompt'
            }
            glyph={saved === 'saved' ? 'saved' : 'savePrompt'}
            onPress={() => dispatch({ type: 'savePrompt', messageId: message.id, prompt })}
          />
        ) : null}
        <CopyButton text={prompt} label='Copy message' />
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  userRow: { justifyContent: 'flex-end', paddingRight: 4 },
  indicator: { marginBottom: 10 },
  buttons: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  button: { width: 26, height: 26, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  time: { fontSize: 12 },
});
