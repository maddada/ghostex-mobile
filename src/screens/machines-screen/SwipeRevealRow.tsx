/**
 * Swipe-left reveal row for the Machines cards, matching the mockup's
 * `.mach.swiped .mach-card { margin-right: 176px }`: the actions panel sits
 * under the card's right edge at a fixed width, and swiping shrinks the card
 * from the right instead of sliding it away, so the icon, name and badge stay
 * in place while the detail text truncates. `ReanimatedSwipeable` cannot do
 * this — it always translates its children by the actions' width — hence a
 * small Pan gesture of our own on the same gesture-handler + reanimated stack.
 */

import { forwardRef, useImperativeHandle, useState, type ReactNode } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

export const SWIPE_REVEAL_WIDTH = 176;

const SNAP_DURATION_MS = 180;
/** Flick speed that opens/closes regardless of how far the finger travelled. */
const FLICK_VELOCITY = 400;

export type SwipeRevealRowMethods = { close: () => void };

type Props = {
  /** The panel revealed at the right; laid out at `SWIPE_REVEAL_WIDTH`. */
  actions: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Fires when the row finishes opening or closing, for the parent's tap handling. */
  onOpenChange?: (open: boolean) => void;
};

const SwipeRevealRow = forwardRef<SwipeRevealRowMethods, Props>(function SwipeRevealRow(
  { actions, children, style, onOpenChange },
  ref,
) {
  const reveal = useSharedValue(0);
  const startReveal = useSharedValue(0);
  const [open, setOpen] = useState(false);

  const settle = (nextOpen: boolean): void => {
    'worklet';
    reveal.value = withTiming(nextOpen ? SWIPE_REVEAL_WIDTH : 0, { duration: SNAP_DURATION_MS });
    runOnJS(setOpen)(nextOpen);
    if (onOpenChange !== undefined) runOnJS(onOpenChange)(nextOpen);
  };

  useImperativeHandle(ref, () => ({ close: () => settle(false) }), [settle]);

  const pan = Gesture.Pan()
    // A mostly-horizontal drag; vertical movement stays with the ScrollView.
    .activeOffsetX([-12, 12])
    .failOffsetY([-10, 10])
    .onStart(() => {
      startReveal.value = reveal.value;
    })
    .onUpdate((event) => {
      reveal.value = Math.min(
        SWIPE_REVEAL_WIDTH,
        Math.max(0, startReveal.value - event.translationX),
      );
    })
    .onEnd((event) => {
      const nextOpen =
        event.velocityX < -FLICK_VELOCITY
          ? true
          : event.velocityX > FLICK_VELOCITY
            ? false
            : reveal.value > SWIPE_REVEAL_WIDTH / 2;
      settle(nextOpen);
    });

  /* The card shrinks from the right; the panel underneath is exposed as it goes. */
  const cardStyle = useAnimatedStyle(() => ({ marginRight: reveal.value }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.row, style]}>
        <Animated.View
          accessibilityElementsHidden={!open}
          importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
          pointerEvents={open ? 'auto' : 'none'}
          style={styles.actions}
        >
          {actions}
        </Animated.View>
        <Animated.View style={[styles.card, cardStyle]}>{children}</Animated.View>
      </Animated.View>
    </GestureDetector>
  );
});

export default SwipeRevealRow;

const styles = StyleSheet.create({
  row: {
    overflow: 'hidden',
  },
  actions: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    right: 0,
    width: SWIPE_REVEAL_WIDTH,
    flexDirection: 'row',
  },
  card: {
    minWidth: 0,
  },
});
