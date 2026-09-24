/**
 * Transcript search (desktop `search.rs`): a find bar above the list while `transcriptSearch` is
 * open, with the core's match label and previous / next. The screen opens it with `searchOpen`
 * (the terminal header's Search Conversation). The bar's own open request wins until the document
 * catches up, so the field it just focused is not dropped for a frame.
 */

import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { RustChat } from '../../rust/useRustChat';
import { Glyph } from './icons';
import { obj, str } from './json';
import { useTranscriptTheme } from './Transcript';

export function TranscriptSearchBar({ chat }: { chat: RustChat }) {
  const theme = useTranscriptTheme();
  const search = obj(chat.state?.document?.transcriptSearch);
  const open = search?.open === true;
  const [query, setQuery] = useState('');
  const inputRef = useRef<TextInput>(null);
  useEffect(() => {
    if (!open) setQuery('');
    else inputRef.current?.focus();
  }, [open]);
  if (!open) return null;
  const label = str(search, 'label');
  const button = (glyph: 'arrow-up' | 'arrow-down' | 'x', accessibilityLabel: string, type: 'searchPrevious' | 'searchNext' | 'searchClose') => (
    <Pressable
      hitSlop={6}
      onPress={() => chat.dispatch({ type })}
      accessibilityRole='button'
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.button, pressed && { backgroundColor: theme.pressed }]}
    >
      <Glyph name={glyph} size={15} color={theme.muted} />
    </Pressable>
  );
  return (
    <View style={styles.row} accessibilityRole='search'>
      <View style={[styles.field, { backgroundColor: theme.input, borderColor: theme.light ? '#e5e5e5' : 'rgba(255,255,255,0.08)' }]}>
        <Glyph name='search' size={15} color={theme.muted} />
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={(text) => {
            setQuery(text);
            chat.dispatch({ type: 'searchQuery', query: text });
          }}
          onSubmitEditing={() => chat.dispatch({ type: 'searchNext' })}
          placeholder='Search'
          placeholderTextColor={theme.muted}
          returnKeyType='search'
          autoCorrect={false}
          autoCapitalize='none'
          blurOnSubmit={false}
          style={[styles.input, { color: theme.foreground }]}
        />
        {label.length > 0 ? <Text style={[styles.label, { color: theme.muted }]}>{label}</Text> : null}
        {button('arrow-up', 'Previous match', 'searchPrevious')}
        {button('arrow-down', 'Next match', 'searchNext')}
        {button('x', 'Close search', 'searchClose')}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 16, paddingTop: 8 },
  field: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderRadius: 10, paddingLeft: 10, paddingRight: 4, height: 38 },
  input: { flex: 1, fontSize: 14, paddingVertical: 0 },
  label: { fontSize: 12 },
  button: { width: 28, height: 28, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
});
