import { useMemo, useState } from 'react';
import { StyleSheet, Text, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';

import { GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';
import { useAppearance, type Appearance } from '../../theme/useAppearance';

type SteppedSliderProps = {
  label: string;
  value: number;
  minimumValue: number;
  maximumValue: number;
  /** What a touch rounds to, and what VoiceOver's and TalkBack's adjust actions move by. */
  step: number;
  /** A touch takes any value between the ends, not rounded to `step`; `step` then only paces the adjust actions. */
  continuous?: boolean;
  valueLabel: string;
  onValueChange: (value: number) => void;
  /** Paints the card, text and track in these colors (Settings pages pass the current appearance). */
  appearance?: Appearance;
  /** Words under the two ends in place of the minimum and maximum numbers (Colourfulness: Subtle, Full). */
  rangeLabels?: readonly [string, string];
};

export default function SteppedSlider({
  label,
  value,
  minimumValue,
  maximumValue,
  step,
  continuous = false,
  valueLabel,
  onValueChange,
  appearance: suppliedAppearance,
  rangeLabels,
}: SteppedSliderProps) {
  const currentAppearance = useAppearance();
  const appearance = suppliedAppearance ?? currentAppearance;
  const styles = useMemo(() => createStyles(appearance), [appearance]);
  const [trackWidth, setTrackWidth] = useState(0);
  const range = maximumValue - minimumValue;
  const progress = range === 0 ? 0 : (value - minimumValue) / range;

  const valueForLocation = (locationX: number): number => {
    if (trackWidth <= 0) return value;
    const ratio = Math.min(1, Math.max(0, locationX / trackWidth));
    const touched = minimumValue + ratio * range;
    const next = continuous ? touched : Math.round(touched / step) * step;
    return Math.min(maximumValue, Math.max(minimumValue, next));
  };

  const handleTouch = (event: GestureResponderEvent): void => {
    const next = valueForLocation(event.nativeEvent.locationX);
    if (next !== value) onValueChange(next);
  };

  const handleLayout = (event: LayoutChangeEvent): void => {
    setTrackWidth(event.nativeEvent.layout.width);
  };

  const adjust = (delta: -1 | 1): void => {
    onValueChange(Math.min(maximumValue, Math.max(minimumValue, value + delta * step)));
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value}>{valueLabel}</Text>
      </View>
      <View
        accessible
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        accessibilityLabel={label}
        accessibilityRole="adjustable"
        accessibilityValue={{
          min: minimumValue,
          max: maximumValue,
          now: value,
          text: valueLabel,
        }}
        style={styles.touchTrack}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'increment') adjust(1);
          if (event.nativeEvent.actionName === 'decrement') adjust(-1);
        }}
        onLayout={handleLayout}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={handleTouch}
        onResponderMove={handleTouch}
        onStartShouldSetResponder={() => true}
      >
        <View style={styles.track}>
          <View style={[styles.fill, { width: `${progress * 100}%` }]} />
        </View>
        <View style={[styles.thumb, { left: `${progress * 100}%` }]} />
      </View>
      <View style={styles.rangeLabels}>
        <Text style={styles.rangeLabel}>
          {rangeLabels?.[0] ?? minimumValue.toLocaleString('en-US')}
        </Text>
        <Text style={styles.rangeLabel}>
          {rangeLabels?.[1] ?? maximumValue.toLocaleString('en-US')}
        </Text>
      </View>
    </View>
  );
}

const createStyles = (appearance: Appearance) => StyleSheet.create({
  card: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    borderRadius: GhostexRadii.row,
    backgroundColor: appearance.card,
    borderWidth: GhostexStrokeWidth,
    borderColor: appearance.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    color: appearance.foreground,
    fontSize: 14,
  },
  value: {
    color: appearance.muted,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
  },
  touchTrack: {
    height: 36,
    marginHorizontal: 8,
    justifyContent: 'center',
  },
  track: {
    height: 4,
    borderRadius: GhostexRadii.pill,
    backgroundColor: appearance.control,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: GhostexRadii.pill,
    backgroundColor: appearance.accent,
  },
  thumb: {
    position: 'absolute',
    width: 20,
    height: 20,
    marginLeft: -10,
    borderRadius: 10,
    backgroundColor: appearance.foreground,
    borderWidth: 2,
    borderColor: appearance.accent,
  },
  rangeLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  rangeLabel: {
    color: appearance.muted,
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
});
