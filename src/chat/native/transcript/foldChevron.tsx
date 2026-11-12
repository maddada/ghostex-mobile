/**
 * A fold's chevron that turns with the fold instead of swapping its icon: a right chevron turns a
 * quarter to point down, or (`half`) a down chevron a half turn to point up, over the fold's 200ms
 * with the desktop's curve (`native_chat/disclosure_motion.rs` `turned_chevron`). Under reduced
 * motion it is drawn at its end at once. `hideWhenShut` fades it out as it turns shut (a Quiet
 * View line shows its chevron only while open).
 *
 * CDXC:SessionChat 2026-11-12 DECISION: the user asked for every fold in the chat to animate; their
 * chevrons turn with the fold.
 */

import { useEffect } from 'react';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { FOLD_MS } from './foldMotion';
import { Glyph } from './icons';

const CURVE = Easing.bezier(0.4, 0, 0.2, 1);

export function FoldChevron({
  open,
  size,
  color,
  half = false,
  hideWhenShut = false,
}: {
  open: boolean;
  size: number;
  color: string;
  half?: boolean;
  hideWhenShut?: boolean;
}) {
  const reduceMotion = useReducedMotion();
  const turn = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    turn.value = reduceMotion ? (open ? 1 : 0) : withTiming(open ? 1 : 0, { duration: FOLD_MS, easing: CURVE });
  }, [open, reduceMotion, turn]);
  const degrees = half ? 180 : 90;
  const style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${turn.value * degrees}deg` }],
    opacity: hideWhenShut ? turn.value : 1,
  }));
  return (
    <Animated.View style={[{ width: size, height: size }, style]}>
      <Glyph name={half ? 'chevron-down' : 'chevron-right'} size={size} color={color} />
    </Animated.View>
  );
}
