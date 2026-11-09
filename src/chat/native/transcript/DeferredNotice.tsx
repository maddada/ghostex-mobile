/**
 * A finished turn's work fold while its history is being read, or after the read failed, with
 * Retry (desktop `deferred_work.rs`). A Reduced line shows one per section it reads, keyed by the
 * section's `startId` (`quietWorkRows.tsx`).
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useTranscriptEnv } from './context';
import { PROSE_SIZE } from './theme';

/** `id` is the turn (or section) the read is keyed by; `deferred` the descriptor it reads again on Retry. */
export function DeferredNotice({ id, deferred, error }: { id: string; deferred: unknown; error: string }) {
  const { theme, dispatch } = useTranscriptEnv();
  const failed = error.length > 0;
  return (
    <View style={styles.deferred}>
      <Text style={[styles.deferredText, { color: failed ? theme.error : theme.muted }]}>
        {failed ? error : 'Loading work details…'}
      </Text>
      {failed ? (
        <Pressable
          onPress={() => dispatch({ type: 'loadWork', id, work: (deferred ?? null) as never })}
          style={({ pressed }) => [styles.retry, pressed && { backgroundColor: theme.pressed }]}
          accessibilityRole="button"
        >
          <Text style={[styles.deferredText, { color: theme.muted }]}>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  deferred: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  deferredText: { fontSize: PROSE_SIZE, flexShrink: 1 },
  retry: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6 },
});
