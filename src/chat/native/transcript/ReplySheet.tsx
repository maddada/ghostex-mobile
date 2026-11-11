/**
 * The transcript menu's Reply on the phone (desktop `reply_popover.rs`; the user's words are on
 * `reply_item` in `packages/gx-chat-core/src/composer/transcript_menu.rs`, CDXC:SessionChat
 * 2026-10-29 DECISION): a sheet with the quoted words, a field for the reply, and the popover's two
 * actions, Add to prompt and Send reply. The draft they leave is the core's (`transcriptReply`).
 * A phone has no Enter or Cmd+Enter for them, so Return is a new line and the two are buttons.
 */

import { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Sheet } from '../composer/Sheet';
import { themedStyles, useTranscriptTheme } from './theme';

export type ReplyAction = 'add' | 'send';

export function ReplySheet({
  quote,
  question,
  onClose,
  onReply,
  initialText = '',
  onChangeText,
}: {
  /** The Reply row's `quote` (Add to Chat's text); null closes the sheet. */
  quote: string | null;
  /** The tag of the one-click question it answers instead (`InlineAnswers.tsx`): Send answer only. */
  question?: string;
  onClose: () => void;
  onReply: (quote: string, reply: string, action: ReplyAction) => void;
  /** The words it opens with: a work item Reply's kept draft (`replyDrafts.ts`). */
  initialText?: string;
  /** Every edit, so a work item Reply keeps its draft however the sheet closes. */
  onChangeText?: (text: string) => void;
}) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const [text, setText] = useState('');
  // Every Reply starts with an empty field, or with the draft its row kept.
  useEffect(() => {
    if (quote !== null) setText(initialText);
    // Only a new opening resets the field; the draft follows the typing, not the other way round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quote]);
  // The quoted words as the reader selected them, without the `> ` markers.
  const preview = (quote ?? '')
    .trim()
    .split('\n')
    .map((line) => line.replace(/^> ?/u, ''))
    .join('\n')
    .trim();
  const button = (label: string, action: ReplyAction, primary: boolean) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        if (quote !== null) onReply(quote, text, action);
      }}
      style={({ pressed }) => [
        styles.button,
        primary ? styles.primary : null,
        pressed ? (primary ? styles.primaryPressed : styles.pressed) : null,
      ]}
    >
      <Text style={[styles.buttonText, primary ? styles.primaryText : null]}>{label}</Text>
    </Pressable>
  );
  return (
    <Sheet visible={quote !== null} onClose={onClose} title={question !== undefined ? `Answer ${question}` : 'Reply'}>
      <View style={styles.body}>
        {preview.length > 0 ? (
          <Text style={styles.quote} numberOfLines={3}>
            {preview}
          </Text>
        ) : null}
        <TextInput
          value={text}
          onChangeText={(next) => {
            setText(next);
            onChangeText?.(next);
          }}
          multiline
          autoFocus
          placeholder={question !== undefined ? `Your answer to ${question}…` : 'Reply…'}
          placeholderTextColor={P.placeholder}
          accessibilityLabel={question !== undefined ? `Answer ${question}` : 'Reply'}
          style={styles.input}
        />
        <View style={styles.footer}>
          {question !== undefined ? null : button('Add to prompt', 'add', false)}
          {button(question !== undefined ? 'Send answer' : 'Send reply', 'send', true)}
        </View>
      </View>
    </Sheet>
  );
}

const useStyles = themedStyles((P) => ({
  body: { gap: 10, paddingHorizontal: 16, paddingTop: 4, paddingBottom: 4 },
  quote: {
    color: P.muted,
    fontSize: 13,
    lineHeight: 18,
    borderLeftWidth: 2,
    borderLeftColor: P.border,
    paddingLeft: 10,
  },
  input: {
    color: P.foreground,
    fontSize: 15,
    lineHeight: 20,
    minHeight: 84,
    maxHeight: 160,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: P.inputBorder,
    backgroundColor: P.input,
    textAlignVertical: 'top' as const,
  },
  footer: { flexDirection: 'row' as const, justifyContent: 'flex-end' as const, gap: 8 },
  button: {
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 10,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    backgroundColor: P.neutralFill,
  },
  pressed: { backgroundColor: P.neutralFillPressed },
  primary: { backgroundColor: P.foreground },
  primaryPressed: { opacity: 0.8 },
  buttonText: { color: P.foreground, fontSize: 14, fontWeight: '600' as const },
  primaryText: { color: P.background },
}));
