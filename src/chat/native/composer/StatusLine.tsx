/**
 * The status line under the composer (`context_meter.rs`, `render_context_status`): the context
 * rows the user starred, separated by diamonds, with the pen that opens the context editor. While
 * the values are still loading it keeps its row with the shared skeleton geometry
 * (`status-line-skeleton.json`) so the composer does not jump.
 *
 * Where the line wraps is the core's (`contextStatusRows`, balanced rows): the line measures its
 * width and each value's width and reports them (`measureContextStatus`), then starts a new row
 * at every index the core names, with no diamond at a row's start, as desktop does.
 */

import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Pressable, Text, View, type LayoutChangeEvent } from 'react-native';

import type { UserAction } from '../../rust/actions';
import type { ChatDocument } from '../../rust/document';
import { Glyph } from './icons';
import { arr, isTrue, obj, str } from './json';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';

const SKELETON = { widths: [52, 72, 36], height: 10, gap: 12 };
/** `SESSION_CHAT_STATUS_LINE_EDIT_RESERVE_PX`: the pen after the last value. */
const EDIT_RESERVE = 18;
/** The diamond's column between two values on one row. */
const SEPARATOR = 18;
/** The line's own horizontal padding, both sides. */
const LINE_PADDING = 8;

export function statusLineReserved(document: ChatDocument): boolean {
  const context = obj(document.contextMeter);
  if (context === null) return false;
  return isTrue(context, 'statusLineReserved') || isTrue(context, 'hasConfiguredItems') || arr(context.starred).length > 0;
}

export function StatusLine({ document, dispatch }: { document: ChatDocument; dispatch: (action: UserAction) => void }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  const context = obj(document.contextMeter);
  const starred = arr(context?.starred);
  const values = starred.map((item) => str(item, 'value'));
  const [available, setAvailable] = useState(0);
  const [widths, setWidths] = useState<(number | undefined)[]>([]);
  const sent = useRef('');
  const valuesKey = JSON.stringify(values);
  useEffect(() => {
    if (available <= 0 || values.length === 0) return;
    if (widths.length < values.length || values.some((_, index) => widths[index] === undefined)) return;
    const measured = values.map((_, index) => (widths[index] ?? 0) + (index === values.length - 1 ? EDIT_RESERVE : 0));
    const measurement = { available: Math.max(0, available - LINE_PADDING), widths: measured, separator: SEPARATOR };
    const key = JSON.stringify(measurement);
    if (key === sent.current) return;
    sent.current = key;
    dispatch({ type: 'measureContextStatus', ...measurement });
  }, [available, dispatch, valuesKey, widths]); // eslint-disable-line react-hooks/exhaustive-deps
  if (starred.length === 0) {
    return (
      <View style={[styles.line, { gap: SKELETON.gap }]}>
        {SKELETON.widths.map((width, index) => (
          <View key={index} style={[styles.skeleton, { width, height: SKELETON.height }]} />
        ))}
      </View>
    );
  }
  const starts = new Set(arr(document.contextStatusRows).filter((value): value is number => typeof value === 'number'));
  const rows: { item: unknown; index: number }[][] = [];
  starred.forEach((item, index) => {
    if (index === 0 || starts.has(index)) rows.push([]);
    rows[rows.length - 1]!.push({ item, index });
  });
  const measureWidth = (index: number) => (event: LayoutChangeEvent) => {
    const width = Math.ceil(event.nativeEvent.layout.width);
    setWidths((current) => {
      if (current[index] === width) return current;
      const next = current.slice(0, values.length);
      next[index] = width;
      return next;
    });
  };
  return (
    <View style={styles.column} onLayout={(event) => setAvailable(Math.floor(event.nativeEvent.layout.width))}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} style={styles.line}>
          {row.map(({ item, index }, position) => {
            const copy = str(obj(obj(item)?.copy), 'text');
            const value = (
              <Text style={styles.value} numberOfLines={1}>
                {str(item, 'value')}
              </Text>
            );
            return (
              <View key={`${index}:${str(item, 'id')}`} style={styles.item}>
                {position > 0 ? <Text style={styles.separator}>◆</Text> : null}
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
          {rowIndex === rows.length - 1 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Edit status line"
              hitSlop={10}
              onPress={() => dispatch({ type: 'contextEdit' })}
              style={styles.pen}
            >
              <Glyph name="pencil" size={11} color={P.muted} />
            </Pressable>
          ) : null}
        </View>
      ))}
      {/* Each value at its natural width, for the core's row balance. */}
      <View style={styles.measure} pointerEvents="none">
        {values.map((value, index) => (
          <Text key={index} style={styles.value} numberOfLines={1} onLayout={measureWidth(index)}>
            {value}
          </Text>
        ))}
      </View>
    </View>
  );
}

const useStyles = themedStyles((P) => ({
  column: { width: '100%', minWidth: 0 },
  line: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', minHeight: 16, paddingHorizontal: 4 },
  measure: { position: 'absolute', left: 0, top: 0, width: 10000, flexDirection: 'row', alignItems: 'flex-start', opacity: 0 },
  item: { flexDirection: 'row', alignItems: 'center', flexShrink: 1 },
  separator: { width: 18, textAlign: 'center', fontSize: 7, color: P.mutedInk(0.4) },
  value: { color: P.mutedInk(0.8), fontSize: 11, lineHeight: 16 },
  pen: { marginLeft: 4, width: 16, height: 16, alignItems: 'center', justifyContent: 'center', opacity: 0.55 },
  skeleton: { borderRadius: 5, backgroundColor: P.mutedInk(0.24) },
}));
