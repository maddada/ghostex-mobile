/**
 * The `@` files, `$` skills and `/` commands popup above the composer (`suggestions/render.rs`).
 * Trigger detection, filtering, the rows and their order all come from the core's `suggestions`;
 * this draws them and reports a pick (`suggestionPick`) or a retry (`suggestionRetry`).
 */

import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import type { UserAction } from '../../rust/actions';
import { Glyph } from './icons';
import { arr, isTrue, num, obj, str } from './json';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';

export function Suggestions({ data, dispatch }: { data: unknown; dispatch: (action: UserAction) => void }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const popup = obj(data);
  if (popup === null) return null;
  const rows = arr(popup.rows);
  const files = str(popup, 'kind') === 'file';
  const selected = num(popup, 'selected') ?? -1;
  const status = str(popup, 'status');
  const heading = str(popup, 'heading');
  return (
    <View style={styles.popup} accessibilityRole="menu" accessibilityLabel={heading}>
      <ScrollView keyboardShouldPersistTaps="always" style={styles.scroll} contentContainerStyle={styles.content}>
        {heading.length > 0 ? <Text style={styles.heading}>{heading.toUpperCase()}</Text> : null}
        {status.length > 0 ? (
          <View style={styles.status}>
            {isTrue(popup, 'loading') ? <ActivityIndicator size="small" color={P.muted} /> : null}
            <Text style={styles.statusText}>{status}</Text>
            {isTrue(popup, 'retry') ? (
              <Pressable accessibilityRole="button" hitSlop={8} onPress={() => dispatch({ type: 'suggestionRetry' })}>
                <Text style={styles.retry}>Retry</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
        {rows.map((row, index) => (
          <Pressable
            key={`${index}:${str(row, 'label')}`}
            accessibilityRole="menuitem"
            accessibilityState={{ selected: index === selected }}
            onPress={() => dispatch({ type: 'suggestionPick', index })}
            style={({ pressed }) => [styles.row, index === selected || pressed ? styles.rowSelected : null]}
          >
            {files ? <Glyph name="file" size={16} color={P.muted} strokeWidth={1.6} /> : null}
            <Text style={[styles.label, files ? styles.fileLabel : null]} numberOfLines={1}>
              {str(row, 'label')}
            </Text>
            <Text style={styles.detail} numberOfLines={1}>
              {str(row, 'detail')}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}

const useStyles = themedStyles((P) => ({
  popup: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: P.composerBorder,
    backgroundColor: P.menu,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  scroll: { maxHeight: 264 },
  content: { padding: 6 },
  heading: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4, color: P.muted, fontSize: 10, fontWeight: '600', letterSpacing: 1.4 },
  status: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8 },
  statusText: { flex: 1, color: P.muted, fontSize: 14 },
  retry: { color: P.foreground, fontSize: 14, fontWeight: '500' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40, paddingHorizontal: 12, borderRadius: 10 },
  rowSelected: { backgroundColor: P.border },
  label: { color: P.foreground, fontSize: 14, flexShrink: 0, maxWidth: '60%' },
  fileLabel: { fontWeight: '600' },
  detail: { flex: 1, color: P.muted, fontSize: 13 },
}));
