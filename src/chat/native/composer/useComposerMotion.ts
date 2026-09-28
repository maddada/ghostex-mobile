/**
 * The chat box's motion, desktop's `apps/desktop/src/app/native_chat/composer_animation.rs`.
 *
 * The card tweens its height whenever its content changes shape (a collapse, an expansion, the
 * field growing a line, a queue or attachment strip arriving): the content keeps its natural
 * height and the card clips it while the height walks there. An interrupted tween continues from
 * the value on screen. A collapse closes the card over the expanded content first and switches to
 * the one-line row when it lands; an expansion switches at once and opens the card over the
 * expanded content, fading the option pills and toolbar in over the second half.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { LayoutChangeEvent } from 'react-native';
import {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

/** `packages/gx-chat-core/visual/composer-animation.json`. */
const MOTION = {
  durationMs: 280,
  minDeltaPx: 0.5,
  arrivalDelayFraction: 0.5,
  arrivalDurationFraction: 0.5,
  arrivalTranslateYPx: 4,
};
const EASING = Easing.bezier(0.32, 0.72, 0, 1);
const TWEEN = { duration: MOTION.durationMs, easing: EASING };

/**
 * CDXC:SessionChat 2026-09-28 DECISION: User: the collapsed composer shows one line of the draft or placeholder, and the text is never faded; the line animates into place instead. A collapse closes the card over the expanded content, so the lines below the first slide out of view under its edge, and the one-line row takes over when the card lands. An expansion opens the card over the expanded content, revealing them.
 * CDXC:SessionChat 2026-09-28 SEE-ALSO: `apps/desktop/src/app/native_chat/composer_animation.rs` runs the same sequence in the GPUI chat.
 *
 * `requested` is the core's `composerCollapsed`; `collapsed` is the shape to draw, which trails a
 * collapse until the card has closed. `border` is the card's border width, outside the measured
 * content; `collapsedEstimate` is the collapsed card's height before the first collapse measured it.
 */
export function useComposerMotion(requested: boolean, border: number, collapsedEstimate: number) {
  const reduceMotion = useReducedMotion();
  const [collapsed, setCollapsed] = useState(requested);
  const shown = useRef(collapsed);
  shown.current = collapsed;
  const height = useSharedValue(-1);
  const controls = useSharedValue(1);
  const measured = useRef(false);
  const target = useRef(-1);
  const natural = useRef({ expanded: -1, collapsed: -1 });
  const closing = useRef(false);

  const walkTo = useCallback(
    (value: number) => {
      target.current = value;
      height.value = withTiming(value, TWEEN);
    },
    [height]
  );

  useEffect(() => {
    if (requested === collapsed) {
      // Reversed before the card closed: it opens again over the same content.
      if (closing.current) {
        closing.current = false;
        walkTo(natural.current.expanded);
      }
      return;
    }
    if (!requested) {
      // Set before the controls mount, so they never paint a frame at full opacity.
      if (!reduceMotion) {
        controls.value = withSequence(
          withTiming(0, { duration: 0 }),
          withDelay(
            MOTION.durationMs * MOTION.arrivalDelayFraction,
            withTiming(1, { duration: MOTION.durationMs * MOTION.arrivalDurationFraction, easing: EASING })
          )
        );
      }
      setCollapsed(false);
      return;
    }
    // The first layout of a chat has nothing to move from.
    if (reduceMotion || !measured.current) {
      setCollapsed(true);
      return;
    }
    closing.current = true;
    walkTo(natural.current.collapsed > 0 ? natural.current.collapsed : collapsedEstimate);
    const timer = setTimeout(() => {
      closing.current = false;
      setCollapsed(true);
    }, MOTION.durationMs);
    return () => clearTimeout(timer);
  }, [collapsed, collapsedEstimate, controls, reduceMotion, requested, walkTo]);

  const onContentLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const next = event.nativeEvent.layout.height + border * 2;
      if (shown.current) natural.current.collapsed = next;
      else natural.current.expanded = next;
      // The expanded content stays under a closing card; only the row it lands on is measured anew.
      if (closing.current) return;
      if (Math.abs(next - target.current) < MOTION.minDeltaPx) return;
      if (!measured.current || reduceMotion) {
        measured.current = true;
        target.current = next;
        cancelAnimation(height);
        height.value = next;
        return;
      }
      walkTo(next);
    },
    [border, height, reduceMotion, walkTo]
  );

  const cardStyle = useAnimatedStyle(() => (height.value < 0 ? {} : { height: height.value }));
  const controlsStyle = useAnimatedStyle(() => ({
    opacity: controls.value,
    transform: [{ translateY: MOTION.arrivalTranslateYPx * (1 - controls.value) }],
  }));

  return { collapsed, onContentLayout, cardStyle, controlsStyle };
}
