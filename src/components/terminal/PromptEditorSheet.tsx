/**
 * Prompt Editor — the phone's reading of the desktop Agent Actions entry.
 *
 * On the desktop, Prompt Editor hands the agent's $EDITOR a scratch file and
 * opens a Monaco window ON THAT MACHINE, which is useless from a phone. What
 * the action is actually for is composing a long prompt somewhere roomier than
 * the agent's one-line TUI input, so here it is a full-width multiline sheet
 * whose text is delivered to the session on Send: as a chat message when the
 * tab is showing Session Chat, and typed into the terminal (no trailing
 * newline, exactly like an attachment reference) otherwise.
 *
 * In chat mode the sheet is a second composer for the same session, so it
 * takes over that session's SYNCED draft (plan 016) while it is open: it opens
 * on whatever the last client left there and hands back whatever the user
 * leaves behind, so closing the sheet never destroys a half-written prompt and
 * the other clients see it.
 */

import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';

export type PromptEditorSheetProps = {
  visible: boolean;
  sessionTitle: string;
  /** Chat mode sends a message; terminal mode types into the PTY. */
  destination: 'chat' | 'terminal';
  /** True while the send is in flight (buttons disabled). */
  busy: boolean;
  /**
   * The session's synced draft, which reaches the host over SSH and therefore
   * usually lands a moment AFTER the sheet is already on screen. It seeds the
   * field only while the user has not typed, so a slow read can never
   * overwrite words they are in the middle of writing.
   */
  initialText?: string;
  onSubmit: (text: string) => void;
  /** Carries the unsent text back so a chat draft is published, not dropped. */
  onCancel: (text: string) => void;
};

export default function PromptEditorSheet({
  visible,
  sessionTitle,
  destination,
  busy,
  initialText,
  onSubmit,
  onCancel,
}: PromptEditorSheetProps) {
  const [text, setText] = useState('');
  /** Cleared on every open; set the first time the user changes the field. */
  const typedRef = useRef(false);

  useEffect(() => {
    if (!visible) return;
    typedRef.current = false;
    setText('');
  }, [visible]);

  useEffect(() => {
    if (!visible || typedRef.current || initialText === undefined) return;
    setText(initialText);
  }, [initialText, visible]);

  const trimmed = text.trim();
  const canSubmit = trimmed.length > 0 && !busy;
  const title = sessionTitle.trim();

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => onCancel(text)}
    >
      <Pressable style={styles.backdrop} onPress={() => onCancel(text)}>
        <Pressable style={styles.card} onPress={(event) => event.stopPropagation()}>
          <Text style={styles.title}>Prompt Editor</Text>
          <Text style={styles.body}>
            {destination === 'chat'
              ? `Send this prompt to ${title.length > 0 ? `"${title}"` : 'this agent session'} as a chat message.`
              : `Type this prompt into ${title.length > 0 ? `"${title}"` : 'this session'} without pressing Enter.`}
          </Text>
          <TextInput
            accessibilityLabel="Prompt"
            style={styles.input}
            multiline
            textAlignVertical="top"
            autoCapitalize="sentences"
            autoCorrect
            autoFocus
            placeholder="Write a longer prompt…"
            placeholderTextColor={GhostexPalette.MUTED}
            value={text}
            onChangeText={(next) => {
              typedRef.current = true;
              setText(next);
            }}
          />
          <View style={styles.buttonRow}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              style={[styles.cancelButton, busy ? styles.buttonDisabled : null]}
              onPress={() => onCancel(text)}
            >
              <Text style={styles.cancelLabel}>Cancel</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={!canSubmit}
              style={[styles.confirmButton, canSubmit ? null : styles.buttonDisabled]}
              onPress={() => {
                if (canSubmit) onSubmit(trimmed);
              }}
            >
              <Text style={styles.confirmLabel}>
                {destination === 'chat' ? 'Send' : 'Insert'}
              </Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: GhostexPalette.BACKGROUND,
    borderRadius: 12,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    padding: 16,
  },
  title: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 15,
    fontWeight: 'bold',
  },
  body: {
    color: GhostexPalette.MUTED,
    fontSize: 12,
    marginTop: 8,
  },
  input: {
    marginTop: 12,
    backgroundColor: GhostexPalette.INPUT_BACKGROUND,
    borderRadius: GhostexRadii.input,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    color: GhostexPalette.FOREGROUND,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    lineHeight: 20,
    // Roughly ten lines of the composer, the point of leaving the TUI input.
    minHeight: 200,
    maxHeight: 320,
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 16,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  cancelButton: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: GhostexRadii.card,
    backgroundColor: GhostexPalette.CARD_ACTIVE,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelLabel: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 13,
    fontWeight: '600',
  },
  confirmButton: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: GhostexRadii.card,
    backgroundColor: GhostexPalette.ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmLabel: {
    color: GhostexPalette.ACCENT_FOREGROUND,
    fontSize: 13,
    fontWeight: '600',
  },
});
