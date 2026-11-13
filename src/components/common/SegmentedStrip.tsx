/**
 * The phone's single-select "pick exactly one of N" strip: one bordered group of segments, the
 * selected one filled, scrolled sideways when it is wider than the screen (the desktop's
 * `modal_bordered_segmented_control`, which the Beads view scrolls in a narrow panel). Each segment
 * may carry a count after its label. The picked segment is scrolled into view.
 */

import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, type ScrollViewInstance } from 'react-native';

import { themedStyles } from '../../chat/native/transcript/theme';

export type SegmentedStripItem<K extends string> = { key: K; label: string; count?: number };

export default function SegmentedStrip<K extends string>({
  items,
  selected,
  onSelect,
  accessibilityLabel,
}: {
  items: SegmentedStripItem<K>[];
  selected: K;
  onSelect: (key: K) => void;
  accessibilityLabel: string;
}) {
  const styles = useStyles();
  const scroll = useRef<ScrollViewInstance | null>(null);
  const offsets = useRef(new Map<string, number>());
  useEffect(() => {
    const x = offsets.current.get(selected);
    if (x !== undefined) scroll.current?.scrollTo({ x: Math.max(0, x - 24), animated: true });
  }, [selected]);
  return (
    <ScrollView
      ref={scroll}
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.content}
      accessibilityRole="tablist"
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.group}>
        {items.map((item, index) => {
          const on = item.key === selected;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              onLayout={(event) => offsets.current.set(item.key, event.nativeEvent.layout.x)}
              onPress={() => onSelect(item.key)}
              style={({ pressed }) => [
                styles.segment,
                index > 0 && styles.divided,
                on && styles.selected,
                pressed && !on && styles.pressed,
              ]}
            >
              <Text style={[styles.label, on && styles.labelOn]}>{item.label}</Text>
              {item.count !== undefined ? <Text style={styles.count}>{item.count}</Text> : null}
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const useStyles = themedStyles((t) => ({
  content: { paddingHorizontal: 12 },
  group: {
    flexDirection: 'row',
    borderRadius: 9,
    borderWidth: 1,
    borderColor: t.controlBorder,
    overflow: 'hidden',
  },
  segment: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12 },
  divided: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: t.controlBorder },
  selected: { backgroundColor: t.selectedFill },
  pressed: { backgroundColor: t.pressedFill },
  label: { color: t.muted, fontSize: 13.5, fontWeight: '500' },
  labelOn: { color: t.foreground },
  count: { color: t.muted, fontSize: 12.5 },
}));
