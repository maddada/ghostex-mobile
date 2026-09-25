import { useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  type GestureResponderEvent,
  type LayoutChangeEvent,
} from 'react-native';

import { GhostexPalette, GhostexRadii, GhostexStrokeWidth } from '../../theme/palette';
import type { Appearance } from '../../theme/useAppearance';

type SteppedSliderProps = {
  label: string;
  value: number;
  minimumValue: number;
  maximumValue: number;
  step: number;
  valueLabel: string;
  onValueChange: (value: number) => void;
  /** Paints the card, text and track in these colors (Settings pages pass the current appearance). */
  appearance?: Appearance;
};

export default function SteppedSlider({
  label,
  value,
  minimumValue,
  maximumValue,
  step,
  valueLabel,
  onValueChange,
  appearance,
}: SteppedSliderProps) {
  const [trackWidth, setTrackWidth] = useState(0);
  const range = maximumValue - minimumValue;
  const progress = range === 0 ? 0 : (value - minimumValue) / range;

  const valueForLocation = (locationX: number): number => {
    if (trackWidth <= 0) return value;
    const ratio = Math.min(1, Math.max(0, locationX / trackWidth));
    const stepped = Math.round((minimumValue + ratio * range) / step) * step;
    return Math.min(maximumValue, Math.max(minimumValue, stepped));
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

  const colors =
    appearance === undefined
      ? null
      : {
          card: { backgroundColor: appearance.card, borderColor: appearance.border },
          label: { color: appearance.foreground },
          muted: { color: appearance.muted },
          track: { backgroundColor: appearance.control },
          thumb: { backgroundColor: appearance.foreground },
        };

  return (
    <View style={[styles.card, colors?.card]}>
      <View style={styles.header}>
        <Text style={[styles.label, colors?.label]}>{label}</Text>
        <Text style={[styles.value, colors?.muted]}>{valueLabel}</Text>
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
        <View style={[styles.track, colors?.track]}>
          <View style={[styles.fill, { width: `${progress * 100}%` }]} />
        </View>
        <View style={[styles.thumb, colors?.thumb, { left: `${progress * 100}%` }]} />
      </View>
      <View style={styles.rangeLabels}>
        <Text style={[styles.rangeLabel, colors?.muted]}>{minimumValue.toLocaleString('en-US')}</Text>
        <Text style={[styles.rangeLabel, colors?.muted]}>{maximumValue.toLocaleString('en-US')}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 8,
    borderRadius: GhostexRadii.row,
    backgroundColor: GhostexPalette.CARD,
    borderWidth: GhostexStrokeWidth,
    borderColor: GhostexPalette.BORDER,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    color: GhostexPalette.FOREGROUND,
    fontSize: 14,
  },
  value: {
    color: GhostexPalette.MUTED,
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
    backgroundColor: '#3A3A3A',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: GhostexRadii.pill,
    backgroundColor: GhostexPalette.ACCENT,
  },
  thumb: {
    position: 'absolute',
    width: 20,
    height: 20,
    marginLeft: -10,
    borderRadius: 10,
    backgroundColor: GhostexPalette.FOREGROUND,
    borderWidth: 2,
    borderColor: GhostexPalette.ACCENT,
  },
  rangeLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 4,
  },
  rangeLabel: {
    color: GhostexPalette.MUTED,
    fontSize: 10,
    fontVariant: ['tabular-nums'],
  },
});
