/**
 * The action row under a message (desktop `message_actions.rs`, React `CopyFooter`): a final
 * reply's Copy then its time, starting at the prose column; a prompt's time then Rewind, Save
 * prompt and Copy, right-aligned under the bubble. A phone has no hover, so the row always shows
 * (React's `@media (pointer: coarse)` rule).
 */

import * as Clipboard from 'expo-clipboard';
import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { ProjectedMessage } from '../../rust/document';
import { useTranscriptEnv, useTranscriptFlags } from './context';
import { Glyph, type GlyphName } from './icons';
import { obj, str } from './json';
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

/** Whether a reply gets its actions: a copyable assistant row whose turn is final. */
export function hasReplyActions(message: ProjectedMessage, finalIds: ReadonlySet<string>): boolean {
  return message.role === 'assistant' && obj(message.actionContent)?.copyable === true && finalIds.has(message.id);
}

export const ReplyActions = memo(function ReplyActions({ message }: { message: ProjectedMessage }) {
  return (
    <View style={[styles.row, { paddingLeft: PROSE_COLUMN }]}>
      <View style={styles.buttons}>
        <CopyButton text={typeof message.copyText === 'string' ? message.copyText : ''} label='Copy message' />
      </View>
      <MessageTime message={message} />
    </View>
  );
});

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
  buttons: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  button: { width: 26, height: 26, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  time: { fontSize: 12 },
});
