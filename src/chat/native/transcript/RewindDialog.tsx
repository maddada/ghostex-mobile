/**
 * The rewind confirmation a prompt's Rewind button opens (desktop `rewind.rs`): the prompt it goes
 * back to, the core's description and error, and Cancel / the submit label. Everything it says is
 * `document.rewind`; the buttons send `rewindCancel` and `rewindSubmit`.
 */

import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import type { RustChat } from '../../rust/useRustChat';
import { isTrue, obj, str } from './json';
import { useTranscriptTheme } from './Transcript';

export function RewindDialog({ chat }: { chat: RustChat }) {
  const theme = useTranscriptTheme();
  const state = obj(chat.state?.document?.rewind);
  if (state === null) return null;
  const busy = isTrue(state, 'busy');
  const completed = isTrue(state, 'completed');
  const preview = str(state, 'preview');
  const error = str(state, 'error');
  const destructive = theme.light ? '#e7000b' : '#ff6467';
  const cancel = () => chat.dispatch({ type: 'rewindCancel' });
  const button = (label: string, onPress: () => void, disabled: boolean, primary: boolean) => (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      accessibilityRole='button'
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.button,
        primary
          ? { backgroundColor: theme.controlPrimary }
          : { borderColor: theme.light ? '#e5e5e5' : 'rgba(255,255,255,0.08)', borderWidth: 1 },
        (pressed || disabled) && { opacity: disabled ? 0.5 : 0.8 },
      ]}
    >
      <Text style={[styles.buttonText, { color: primary ? theme.background : theme.foreground }]}>{label}</Text>
    </Pressable>
  );
  return (
    <Modal visible transparent animationType='fade' onRequestClose={cancel} statusBarTranslucent>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={busy ? undefined : cancel} accessibilityLabel='Cancel rewind' />
        <View
          style={[styles.card, { backgroundColor: theme.light ? '#fefefe' : '#161616', borderColor: theme.light ? '#e5e5e5' : 'rgba(255,255,255,0.08)' }]}
          accessibilityViewIsModal
        >
          <View style={styles.titleBlock}>
            <Text style={[styles.title, { color: theme.foreground }]}>Rewind conversation</Text>
            <Text style={[styles.text, { color: theme.cardMuted }]}>Restore the conversation to the point before you sent this message?</Text>
          </View>
          <View style={styles.details}>
            {preview.length > 0 ? (
              <View style={[styles.preview, { borderLeftColor: theme.border }]}>
                <Text numberOfLines={6} style={[styles.text, { color: theme.muted }]}>
                  {preview}
                </Text>
              </View>
            ) : null}
            <Text style={[styles.small, { color: theme.muted }]}>{str(state, 'description')}</Text>
            {error.length > 0 ? <Text style={[styles.small, { color: destructive }]}>{error}</Text> : null}
          </View>
          <View style={styles.buttons}>
            {button(str(state, 'cancelLabel') || 'Cancel', cancel, busy, false)}
            {button(str(state, 'submitLabel') || 'Rewind', () => chat.dispatch({ type: 'rewindSubmit' }), busy || completed, true)}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)', padding: 16 },
  card: { width: 448, maxWidth: '100%', gap: 24, padding: 24, borderRadius: 12, borderWidth: 1 },
  titleBlock: { gap: 6 },
  title: { fontSize: 16, fontWeight: '500' },
  text: { fontSize: 14, lineHeight: 20 },
  details: { gap: 16 },
  preview: { borderLeftWidth: 2, paddingLeft: 12 },
  small: { fontSize: 12, lineHeight: 18 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8 },
  button: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  buttonText: { fontSize: 14, fontWeight: '500' },
});
