/**
 * The context window panel the context meter opens (`option_menu/context.rs`): the summary, the
 * fill bar, Compact context, and the details the user picked, with the pen that opens the context
 * editor (`contextEdit`).
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Glyph } from './icons';
import { arr, isTrue, num, obj, str, type JsonRecord } from './json';
import { ComposerPalette as P } from './palette';

export function ContextPanel({ context, onCommand }: { context: JsonRecord; onCommand: (command: JsonRecord) => void }) {
  const percentage = num(context, 'usedPercentage');
  const compactDisabled = isTrue(context, 'compactDisabled');
  const reason = str(context, 'compactDisabledReason');
  const groups = Array.isArray(context.details) ? arr(context.details) : null;
  return (
    <View style={styles.panel}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>Context window</Text>
        <Text style={styles.muted}>{str(context, 'summary')}</Text>
      </View>
      {percentage !== null ? (
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${Math.min(100, Math.max(0, percentage))}%` }]} />
        </View>
      ) : null}
      <Text style={styles.muted}>Compacts automatically as the window fills.</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Compact context"
        disabled={compactDisabled}
        onPress={() => onCommand({ type: 'contextCompact' })}
        style={({ pressed }) => [styles.compact, pressed ? styles.pressed : null, compactDisabled ? styles.disabled : null]}
      >
        <Text style={styles.compactText}>Compact context</Text>
      </Pressable>
      {compactDisabled && reason.length > 0 ? <Text style={styles.reason}>{reason}</Text> : null}
      {groups !== null ? (
        <View style={styles.details}>
          <View style={styles.titleRow}>
            <Text style={styles.detailsTitle}>More details</Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose which details to show"
              hitSlop={8}
              onPress={() => onCommand({ type: 'contextEdit' })}
              style={({ pressed }) => [styles.pen, pressed ? styles.pressed : null]}
            >
              <Glyph name="pencil" size={15} color={P.muted} />
            </Pressable>
          </View>
          {groups.length === 0 ? <Text style={styles.muted}>Nothing selected.</Text> : null}
          {groups.map((group, groupIndex) => (
            <View key={`${groupIndex}:${str(group, 'id')}`} style={styles.group}>
              <Text style={styles.groupLabel}>{str(group, 'label').toUpperCase()}</Text>
              {arr(obj(group)?.items).map((item, itemIndex) => (
                <View key={`${itemIndex}:${str(item, 'id')}`} style={styles.item}>
                  <Text style={styles.itemLabel}>{str(item, 'label')}</Text>
                  <Text style={styles.itemValue}>{str(item, 'value')}</Text>
                </View>
              ))}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { gap: 10, paddingTop: 4 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { color: P.foreground, fontSize: 15, fontWeight: '600' },
  muted: { color: P.muted, fontSize: 13 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden', backgroundColor: P.meterTrack },
  fill: { height: '100%', borderRadius: 3, backgroundColor: P.meterFill },
  compact: {
    height: 40,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: P.menuBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactText: { color: P.primary, fontSize: 14 },
  reason: { color: P.muted, fontSize: 12 },
  pressed: { backgroundColor: P.pressed },
  disabled: { opacity: 0.5 },
  details: { marginTop: 4, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: P.menuBorder, gap: 4 },
  detailsTitle: { color: P.foreground, fontSize: 14, fontWeight: '500' },
  pen: { width: 32, height: 32, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  group: { paddingTop: 8, gap: 4 },
  groupLabel: { color: 'rgba(158,158,158,0.7)', fontSize: 10.5, fontWeight: '600', letterSpacing: 0.6 },
  item: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  itemLabel: { color: 'rgba(158,158,158,0.75)', fontSize: 13 },
  itemValue: { flex: 1, textAlign: 'right', color: P.muted, fontSize: 13 },
});
