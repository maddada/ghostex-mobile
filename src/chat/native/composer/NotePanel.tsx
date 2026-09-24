/**
 * The session note above the composer (`note.rs`): a free text field kept per conversation. Typing
 * sends `editNote`, leaving the field saves (`saveNote`), and the header has Copy, Clear
 * (`clearNote`) and Close (`toggleNote`).
 */

import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import type { UserAction } from '../../rust/actions';
import type { NoteState } from '../../rust/document';
import { Glyph, type GlyphName } from './icons';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';

export function NotePanel({ note, dispatch }: { note: NoteState; dispatch: (action: UserAction) => void }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const [text, setText] = useState(note.value);
  const typed = useRef(note.value);
  useEffect(() => {
    // The core's value wins when it moved somewhere this field did not put it (a load, a clear).
    if (note.value !== typed.current) {
      typed.current = note.value;
      setText(note.value);
    }
  }, [note.value]);
  if (!note.open) return null;
  const button = (glyph: GlyphName, label: string, onPress: () => void) => (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={6} onPress={onPress} style={({ pressed }) => [styles.icon, pressed ? styles.pressed : null]}>
      <Glyph name={glyph} size={15} color={P.muted} />
    </Pressable>
  );
  return (
    <View style={styles.panel}>
      <View style={styles.header}>
        <Text style={styles.title}>Session note</Text>
        <View style={styles.actions}>
          {button('copy', 'Copy note', () => void Clipboard.setStringAsync(text))}
          {button('eraser', 'Clear note', () => dispatch({ type: 'clearNote' }))}
          {button('x', 'Close session note', () => dispatch({ type: 'toggleNote' }))}
        </View>
      </View>
      <TextInput
        value={text}
        onChangeText={(next) => {
          typed.current = next;
          setText(next);
          dispatch({ type: 'editNote', text: next });
        }}
        onBlur={() => dispatch({ type: 'saveNote' })}
        editable={!note.loading}
        multiline
        autoFocus
        placeholder="What’s next in this thread…"
        placeholderTextColor={P.placeholder}
        style={styles.input}
      />
    </View>
  );
}

const useStyles = themedStyles((P) => ({
  panel: { gap: 4, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10, borderRadius: 16, borderWidth: 1, borderColor: P.border, backgroundColor: P.composerBackground },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: P.muted, fontSize: 12 },
  actions: { flexDirection: 'row', gap: 4 },
  icon: { width: 30, height: 30, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: P.controlPressed },
  input: { color: P.foreground, fontSize: 14, lineHeight: 20, minHeight: 60, maxHeight: 160, paddingTop: 0, paddingBottom: 0, textAlignVertical: 'top' },
}));
