/**
 * A Claude panel read as blocks (desktop `native_chat/panel_blocks.rs`): tabs, headings,
 * `Label  value` tables, usage meters, text, and code-font text kept as painted.
 */

import { Pressable, ScrollView, Text, View } from 'react-native';

import type { RustChat } from '../../rust/useRustChat';
import { MONO_FONT, themedStyles } from '../transcript/theme';
import { arr, isTrue, num, str, type JsonRecord } from './json';

export function PanelBlocks({ chat, dialog, blocks }: { chat: RustChat; dialog: JsonRecord; blocks: unknown[] }) {
  const styles = useStyles();
  const dialogId = str(dialog, 'id');
  return (
    <View style={styles.column}>
      {blocks.map((block, index) => {
        const type = str(block, 'type');
        if (type === 'tabs') {
          const tabs = arr((block as JsonRecord).tabs);
          const selected = tabs.findIndex((tab) => isTrue(tab, 'selected'));
          return (
            <View key={index} style={styles.tabs}>
              {tabs.map((tab, position) => {
                const active = isTrue(tab, 'selected');
                const delta = selected >= 0 ? position - selected : 0;
                return (
                  <Pressable
                    key={position}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    disabled={active || delta === 0}
                    onPress={() =>
                      chat.dispatch({
                        type: 'answer',
                        answer: { kind: 'terminalDialog', dialogId, dialogAction: 'selectTab', tabDelta: delta },
                      })
                    }
                    style={[styles.tab, active && styles.tabActive]}
                  >
                    <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{str(tab, 'label')}</Text>
                  </Pressable>
                );
              })}
            </View>
          );
        }
        if (type === 'heading') {
          return (
            <Text key={index} style={styles.heading}>
              {str(block, 'text')}
            </Text>
          );
        }
        if (type === 'table') {
          return (
            <View key={index} style={styles.table}>
              {arr((block as JsonRecord).rows).map((row, rowIndex) => (
                <View key={rowIndex} style={[styles.tableRow, rowIndex > 0 && styles.tableRowRule]}>
                  <Text style={styles.tableKey}>{str(row, 'key')}</Text>
                  <Text style={styles.tableValue}>{str(row, 'value')}</Text>
                </View>
              ))}
            </View>
          );
        }
        if (type === 'meter') {
          const percent = Math.max(0, Math.min(100, num(block, 'percent') ?? 0));
          const label = str(block, 'label');
          return (
            <View key={index} style={styles.meter}>
              <View style={styles.meterHead}>
                <Text style={styles.meterLabel}>{label ? `${label} · ${str(block, 'value')}` : str(block, 'value')}</Text>
                <Text style={styles.meterDetail}>{str(block, 'detail')}</Text>
              </View>
              <View style={styles.meterTrack}>
                <View style={[styles.meterFill, { width: `${percent}%` }]} />
              </View>
            </View>
          );
        }
        if (type === 'pre') {
          return (
            <ScrollView key={index} horizontal nestedScrollEnabled style={styles.pre}>
              <Text style={styles.preText}>{str(block, 'text')}</Text>
            </ScrollView>
          );
        }
        return (
          <Text key={index} style={isTrue(block, 'muted') ? styles.textMuted : styles.text}>
            {str(block, 'text')}
          </Text>
        );
      })}
    </View>
  );
}

const useStyles = themedStyles((P) => ({
  column: { gap: 10 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  tab: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6 },
  tabActive: { backgroundColor: P.foreground },
  tabLabel: { color: P.muted, fontSize: 13 },
  tabLabelActive: { color: P.cardPanel },
  heading: { color: P.foreground, fontSize: 13, fontWeight: '600' },
  table: { borderWidth: 1, borderColor: P.border, borderRadius: 8, overflow: 'hidden' },
  tableRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 10, paddingVertical: 5 },
  tableRowRule: { borderTopWidth: 1, borderTopColor: P.border },
  tableKey: { width: '34%', color: P.muted, fontSize: 13 },
  tableValue: { flex: 1, color: P.foreground, fontSize: 13 },
  meter: { gap: 5 },
  meterHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  meterLabel: { color: P.foreground, fontSize: 13 },
  meterDetail: { color: P.muted, fontSize: 12 },
  meterTrack: { height: 6, borderRadius: 3, backgroundColor: P.light ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.12)', overflow: 'hidden' },
  meterFill: { height: 6, borderRadius: 3, backgroundColor: P.primary },
  pre: { borderRadius: 8, padding: 10, backgroundColor: P.light ? P.input : 'rgba(29,29,29,0.3)' },
  preText: { color: P.cardMuted, fontFamily: MONO_FONT, fontSize: 12, lineHeight: 18 },
  text: { color: P.foreground, fontSize: 13, lineHeight: 19 },
  textMuted: { color: P.muted, fontSize: 13, lineHeight: 19 },
}));
