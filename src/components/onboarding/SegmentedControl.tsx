/**
 * Segmented row of pills used by the machine form (auth method picker and
 * SSH key algorithm picker). Selected pill fills with the accent color.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';

export type SegmentOption<T extends string> = {
  value: T;
  label: string;
};

type Props<T extends string> = {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
};

export default function SegmentedControl<T extends string>({ options, value, onChange }: Props<T>) {
  return (
    <View style={styles.row}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            style={[styles.pill, selected && styles.pillSelected]}
            onPress={() => onChange(option.value)}
          >
            <Text style={[styles.label, selected && styles.labelSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  pill: {
    borderRadius: GhostexRadii.pill,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
    backgroundColor: GhostexPalette.CARD,
    paddingHorizontal: 14,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillSelected: {
    backgroundColor: GhostexPalette.ACCENT,
    borderColor: GhostexPalette.ACCENT,
  },
  label: {
    color: GhostexPalette.MUTED,
    fontSize: 13,
    fontWeight: '500',
  },
  labelSelected: {
    color: GhostexPalette.ACCENT_FOREGROUND,
    fontWeight: '600',
  },
});
