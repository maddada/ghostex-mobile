/**
 * Context details (`context_editor/`): which context rows show under the meter, and which are
 * starred onto the status line. Every change is the action desktop sends (`contextQuery`,
 * `contextShown`, `contextStar`, `contextReset`, `contextSave`, `contextCancel`); the core keeps
 * the edit until Save.
 */

import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

import type { UserAction } from '../../rust/actions';
import { Glyph } from './icons';
import { arr, isTrue, obj, str, type JsonRecord } from './json';
import { ComposerPalette as P } from './palette';
import { Sheet } from './Sheet';

export function ContextEditorSheet({ editor, dispatch }: { editor: JsonRecord | null; dispatch: (action: UserAction) => void }) {
  const [query, setQuery] = useState('');
  const open = editor !== null;
  useEffect(() => {
    if (open) setQuery(str(editor, 'query'));
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const saving = isTrue(editor, 'saving');
  const starred = arr(editor?.starred);
  const error = str(editor, 'error');
  return (
    <Sheet visible={open} onClose={() => dispatch({ type: 'contextCancel' })} title="Context details" maxHeight="90%">
      <View style={styles.search}>
        <Glyph name="search" size={16} color={P.muted} />
        <TextInput
          value={query}
          onChangeText={(next) => {
            setQuery(next);
            dispatch({ type: 'contextQuery', query: next });
          }}
          placeholder="Search rows"
          placeholderTextColor="rgba(158,158,158,0.6)"
          style={styles.searchInput}
          autoCorrect={false}
          autoCapitalize="none"
        />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
        <Text style={styles.description}>{str(editor, 'description')}</Text>
        {arr(editor?.groups).map((group) => (
          <View key={str(group, 'id')} style={styles.group}>
            <Text style={styles.groupLabel}>{str(group, 'label').toUpperCase()}</Text>
            {arr(obj(group)?.rows).map((row) => {
              const id = str(row, 'id');
              const label = str(row, 'label');
              const starredRow = isTrue(row, 'starred');
              const shown = isTrue(row, 'shown');
              return (
                <View key={id} style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={styles.rowLabel} numberOfLines={1}>
                      {label}
                    </Text>
                    <Text style={styles.rowDescription} numberOfLines={2}>
                      {str(row, 'description')}
                    </Text>
                  </View>
                  <Text style={styles.sample} numberOfLines={1}>
                    {str(row, 'sample') || '—'}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${starredRow ? 'Unstar' : 'Star'} ${label}`}
                    disabled={saving}
                    hitSlop={6}
                    onPress={() => dispatch({ type: 'contextStar', id })}
                    style={styles.star}
                  >
                    <Glyph name={starredRow ? 'star-filled' : 'star'} size={17} color={starredRow ? '#f6c945' : P.muted} />
                  </Pressable>
                  <Switch
                    accessibilityLabel={`Show ${label}`}
                    value={shown}
                    disabled={saving}
                    onValueChange={(next) => dispatch({ type: 'contextShown', id, shown: next })}
                  />
                </View>
              );
            })}
          </View>
        ))}
        <View style={styles.statusLine}>
          <View style={styles.statusHeader}>
            <Text style={styles.groupLabel}>STATUS LINE</Text>
            <Text style={styles.rowDescription}>{starred.length === 0 ? 'Star rows above to show them under the chat box.' : ''}</Text>
          </View>
          <View style={styles.chips}>
            {starred.map((row) => (
              <Pressable
                key={str(row, 'id')}
                accessibilityRole="button"
                accessibilityLabel={`Unstar ${str(row, 'label')}`}
                disabled={saving}
                onPress={() => dispatch({ type: 'contextStar', id: str(row, 'id') })}
                style={styles.chip}
              >
                <Text style={styles.chipText}>{str(row, 'label')}</Text>
                <Glyph name="x" size={11} color={P.muted} />
              </Pressable>
            ))}
          </View>
        </View>
        {error.length > 0 ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
      <View style={styles.footer}>
        <Pressable accessibilityRole="button" disabled={saving} onPress={() => dispatch({ type: 'contextReset' })} style={styles.textButton}>
          <Text style={styles.textButtonLabel}>Reset to recommended</Text>
        </Pressable>
        <View style={styles.footerRight}>
          <Pressable accessibilityRole="button" onPress={() => dispatch({ type: 'contextCancel' })} style={styles.button}>
            <Text style={styles.buttonText}>Cancel</Text>
          </Pressable>
          <Pressable accessibilityRole="button" disabled={saving} onPress={() => dispatch({ type: 'contextSave' })} style={[styles.button, styles.primary, saving ? styles.dim : null]}>
            <Text style={styles.primaryText}>Save</Text>
          </Pressable>
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 6,
    paddingHorizontal: 12,
    height: 40,
    borderRadius: 10,
    backgroundColor: P.composerBackground,
    borderWidth: 1,
    borderColor: P.composerBorder,
  },
  searchInput: { flex: 1, color: P.foreground, fontSize: 15, paddingVertical: 0 },
  content: { paddingHorizontal: 16, paddingBottom: 12, gap: 12 },
  description: { color: P.muted, fontSize: 13, lineHeight: 18 },
  group: { gap: 2 },
  groupLabel: { color: 'rgba(158,158,158,0.75)', fontSize: 11, fontWeight: '600', letterSpacing: 0.6, paddingVertical: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6 },
  rowText: { flex: 1, minWidth: 0 },
  rowLabel: { color: P.foreground, fontSize: 14 },
  rowDescription: { color: P.muted, fontSize: 12 },
  sample: { color: P.muted, fontSize: 12, maxWidth: 80 },
  star: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  statusLine: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.menuBorder, paddingTop: 10, gap: 6 },
  statusHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, height: 30, borderRadius: 8, borderWidth: 1, borderColor: P.border },
  chipText: { color: P.foreground, fontSize: 12.5 },
  error: { color: P.error, fontSize: 13 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: P.menuBorder,
  },
  footerRight: { flexDirection: 'row', gap: 8 },
  textButton: { height: 38, justifyContent: 'center' },
  textButtonLabel: { color: P.muted, fontSize: 13 },
  button: { height: 38, paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: P.menuBorder, justifyContent: 'center' },
  buttonText: { color: P.foreground, fontSize: 14 },
  primary: { backgroundColor: P.sendFill, borderColor: P.sendFill },
  primaryText: { color: P.sendInk, fontSize: 14, fontWeight: '600' },
  dim: { opacity: 0.5 },
});
