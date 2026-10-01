/**
 * The Run on row above a new thread's composer (`run_location.rs` on desktop): This computer or an
 * agentbox box, from the document's `runLocation` key. gx-chat-core decides when it shows, what it
 * offers and which chip is selected; this only lays it out and reports the pick. A chip's tooltip
 * (an SSH host's "Your server <alias> over SSH") is its accessibility hint here.
 */

import { Pressable, ScrollView, Text, View } from 'react-native';

import type { UserAction } from '../../rust/actions';
import type { RunLocationRow as Row } from '../../rust/document';
import { Glyph } from './icons';
import { themedStyles, useTranscriptTheme } from '../transcript/theme';

const GLYPH = { computer: 'device-desktop', box: 'box', server: 'server', cloud: 'cloud' } as const;

export function RunLocationRow({ row, dispatch }: { row: Row; dispatch: (action: UserAction) => void }) {
  const styles = useStyles();
  const P = useTranscriptTheme();
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{row.label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        {row.options.map((option) => {
          const on = option.runLocation === row.selected;
          const color = on ? P.primary : P.muted;
          return (
            <Pressable
              key={option.runLocation}
              accessibilityRole='button'
              accessibilityState={{ selected: on, busy: row.busy && on }}
              accessibilityLabel={`Run on ${option.label}`}
              accessibilityHint={option.tooltip ?? undefined}
              disabled={on || row.busy}
              onPress={() => dispatch({ type: 'switchDraftRunLocation', runLocation: option.runLocation })}
              style={({ pressed }) => [
                styles.chip,
                on ? styles.chipOn : null,
                pressed ? styles.pressed : null,
                row.busy && on ? styles.busy : null,
              ]}
            >
              <Glyph name={GLYPH[option.icon] ?? 'box'} size={13} color={color} />
              <Text style={[styles.chipText, { color }]} numberOfLines={1}>
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const useStyles = themedStyles((P) => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 6 },
  label: { color: P.muted, fontSize: 12 },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'transparent',
    maxWidth: 160,
  },
  chipOn: { backgroundColor: P.border, borderColor: P.border },
  pressed: { backgroundColor: P.border },
  busy: { opacity: 0.6 },
  chipText: { fontSize: 12.5, flexShrink: 1 },
}));
