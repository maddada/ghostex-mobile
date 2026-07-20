/**
 * Edge-swipe tab switching (terminal-screen.md §6): 32-wide strips on both
 * edges of the terminal area. A drag whose horizontal travel exceeds 60 and
 * its vertical travel switches to the next/previous tab.
 */

import { useMemo } from 'react';
import { PanResponder, StyleSheet, View, type GestureResponderHandlers } from 'react-native';

const STRIP_WIDTH = 32;
const ACTIVATE_DISTANCE = 24;
const SWITCH_DISTANCE = 60;

export type EdgeSwipeZonesProps = {
  /** Swipe rightwards (dx ≥ 60) → previous tab. */
  onPrev: () => void;
  /** Swipe leftwards (dx ≤ -60) → next tab. */
  onNext: () => void;
};

export default function EdgeSwipeZones({ onPrev, onNext }: EdgeSwipeZonesProps) {
  const panHandlers: GestureResponderHandlers = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          Math.abs(gesture.dx) > ACTIVATE_DISTANCE && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderRelease: (_event, gesture) => {
          if (Math.abs(gesture.dx) < SWITCH_DISTANCE || Math.abs(gesture.dx) <= Math.abs(gesture.dy)) {
            return;
          }
          if (gesture.dx > 0) onPrev();
          else onNext();
        },
      }).panHandlers,
    [onPrev, onNext],
  );

  return (
    <>
      <View style={[styles.strip, styles.left]} {...panHandlers} />
      <View style={[styles.strip, styles.right]} {...panHandlers} />
    </>
  );
}

const styles = StyleSheet.create({
  strip: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: STRIP_WIDTH,
  },
  left: {
    left: 0,
  },
  right: {
    right: 0,
  },
});
