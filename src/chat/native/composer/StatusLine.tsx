/**
 * The status line under the composer (`context_meter.rs`, `render_context_status`): the context
 * rows the user starred, separated by diamonds, with the pen that opens the context editor. While
 * the values are still loading it keeps its row with the shared skeleton geometry
 * (`status-line-skeleton.json`) so the composer does not jump.
 */

import * as Clipboard from 'expo-clipboard';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { UserAction } from '../../rust/actions';
import type { ChatDocument } from '../../rust/document';
import { Glyph } from './icons';
import { arr, isTrue, obj, str } from './json';
import { ComposerPalette as P } from './palette';

const SKELETON = { widths: [52, 72, 36], height: 10, gap: 12 };

export function statusLineReserved(document: ChatDocument): boolean {
  const context = obj(document.contextMeter);
  if (context === null) return false;
  return isTrue(context, 'statusLineReserved') || isTrue(context, 'hasConfiguredItems') || arr(context.starred).length > 0;
}

export function StatusLine({ document, dispatch }: { document: ChatDocument; dispatch: (action: UserAction) => void }) {
  const context = obj(document.contextMeter);
  const starred = arr(context?.starred);
  if (starred.length === 0) {
    return (
      <View style={[styles.line, { gap: SKELETON.gap }]}>
        {SKELETON.widths.map((width, index) => (
          <View key={index} style={[styles.skeleton, { width, height: SKELETON.height }]} />
        ))}
      </View>
    );
  }
  return (
    <View style={styles.line}>
      {starred.map((item, index) => {
        const copy = str(obj(obj(item)?.copy), 'text');
        const value = (
          <Text style={styles.value} numberOfLines={1}>
            {str(item, 'value')}
          </Text>
        );
        return (
          <View key={`${index}:${str(item, 'id')}`} style={styles.item}>
            {index > 0 ? <Text style={styles.separator}>◆</Text> : null}
            {copy.length > 0 ? (
              <Pressable accessibilityRole="button" accessibilityLabel={`${str(item, 'label')}, copy id`} onPress={() => void Clipboard.setStringAsync(copy)}>
                {value}
              </Pressable>
            ) : (
              value
            )}
          </View>
        );
      })}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Edit status line"
        hitSlop={10}
        onPress={() => dispatch({ type: 'contextEdit' })}
        style={styles.pen}
      >
        <Glyph name="pencil" size={11} color={P.muted} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', minHeight: 16, paddingHorizontal: 4 },
  item: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  separator: { width: 18, textAlign: 'center', fontSize: 7, color: 'rgba(158,158,158,0.4)' },
  value: { color: 'rgba(158,158,158,0.8)', fontSize: 11, lineHeight: 16 },
  pen: { marginLeft: 4, width: 16, height: 16, alignItems: 'center', justifyContent: 'center', opacity: 0.55 },
  skeleton: { borderRadius: 5, backgroundColor: 'rgba(158,158,158,0.24)' },
});
