/**
 * Edge-swipe tab switching (terminal-screen.md §6): 32-wide strips on both
 * edges of the terminal area. Any drag more sideways than vertical (past slop)
 * activates on the UI thread and switches to the next/previous tab on release
 * past the distance threshold or on a fast flick.
 */

import { useCallback, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { GestureDetector, GestureStateManager, usePanGesture } from 'react-native-gesture-handler';
import { runOnJS, useSharedValue } from 'react-native-reanimated';

import { SWIPE_FLICK_MIN_DISTANCE, SWIPE_FLICK_VELOCITY } from '../common/HorizontalSwipe';

const STRIP_WIDTH = 32;
const ACTIVATE_SLOP = 10;
const ACTIVATE_SLOP_SQ = ACTIVATE_SLOP * ACTIVATE_SLOP;
const SWITCH_DISTANCE = 48;
/**
 * On iOS a rightward drag on the left strip is the stack's swipe back to Sessions: the old JS strip always lost that
 * drag to it (seen on the iOS 27 simulator from 3, 14 and 26 pt in), so the left strip there takes only leftward drags
 * and back keeps working. Android's back gesture is the system's own and never reaches the app.
 */
const LEFT_STRIP_YIELDS_RIGHTWARD = Platform.OS === 'ios';

export type EdgeSwipeZonesProps = {
  /** Swipe rightwards → previous tab. */
  onPrev: () => void;
  /** Swipe leftwards → next tab. */
  onNext: () => void;
};

function EdgeStrip({
  side,
  onPrev,
  onNext,
}: {
  side: 'left' | 'right';
  onPrev: () => void;
  onNext: () => void;
}) {
  const callbacksRef = useRef({ onPrev, onNext });
  callbacksRef.current = { onPrev, onNext };
  const switchTab = useCallback((direction: -1 | 1) => {
    if (direction < 0) callbacksRef.current.onPrev();
    else callbacksRef.current.onNext();
  }, []);

  const touchStartX = useSharedValue(0);
  const touchStartY = useSharedValue(0);
  const touchLastX = useSharedValue(0);
  const touchDecided = useSharedValue(false);
  const yieldsRightward = side === 'left' && LEFT_STRIP_YIELDS_RIGHTWARD;

  const pan = usePanGesture({
    manualActivation: true,
    shouldCancelWhenOutside: false,
    maxPointers: 1,
    onTouchesDown: (event) => {
      'worklet';
      if (event.numberOfTouches > 1) {
        touchDecided.value = true;
        GestureStateManager.fail(event.handlerTag);
        return;
      }
      const touch = event.changedTouches[0] ?? event.allTouches[0];
      if (touch === undefined) return;
      touchStartX.value = touch.absoluteX;
      touchStartY.value = touch.absoluteY;
      touchLastX.value = touch.absoluteX;
      touchDecided.value = false;
    },
    onTouchesMove: (event) => {
      'worklet';
      if (event.numberOfTouches > 1) {
        if (!touchDecided.value) {
          touchDecided.value = true;
          GestureStateManager.fail(event.handlerTag);
        }
        return;
      }
      const touch = event.changedTouches[0] ?? event.allTouches[0];
      if (touch === undefined) return;
      touchLastX.value = touch.absoluteX;
      if (touchDecided.value) return;
      const dx = touch.absoluteX - touchStartX.value;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(touch.absoluteY - touchStartY.value);
      if (absDx * absDx + absDy * absDy < ACTIVATE_SLOP_SQ) return;
      touchDecided.value = true;
      if (absDx > absDy && !(yieldsRightward && dx > 0)) GestureStateManager.activate(event.handlerTag);
      else GestureStateManager.fail(event.handlerTag);
    },
    onDeactivate: (event) => {
      'worklet';
      if (event.canceled) return;
      const dx = event.translationX;
      const totalDx = touchLastX.value - touchStartX.value;
      const far = Math.abs(dx) >= SWITCH_DISTANCE;
      const flick =
        Math.abs(event.velocityX) >= SWIPE_FLICK_VELOCITY &&
        Math.abs(totalDx) >= SWIPE_FLICK_MIN_DISTANCE &&
        Math.sign(event.velocityX) === Math.sign(dx);
      if (!far && !flick) return;
      runOnJS(switchTab)(dx > 0 ? -1 : 1);
    },
    onFinalize: () => {
      'worklet';
      touchDecided.value = false;
    },
  });

  return (
    <GestureDetector gesture={pan}>
      <View collapsable={false} style={[styles.strip, side === 'left' ? styles.left : styles.right]} />
    </GestureDetector>
  );
}

export default function EdgeSwipeZones({ onPrev, onNext }: EdgeSwipeZonesProps) {
  return (
    <>
      <EdgeStrip side="left" onPrev={onPrev} onNext={onNext} />
      <EdgeStrip side="right" onPrev={onPrev} onNext={onNext} />
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
