/**
 * How the app animates what moves with the iOS software keyboard (FL-STR-03): `LayoutAnimation` is app-wide
 * and its pending config is last-writer-wins, so the writers matter. The shared frame store `keyboardFrame.ts`
 * is the one writer for everything that follows it (the app chrome, the sheets, the terminal and the chat
 * composer: their hooks only read the store, synchronously); one request per keyboard move, from here.
 * Expected, not proven: their layout change lands in the render the store's publish causes (a sync-lane render
 * React flushes in a microtask after the keyboard event), so it carries this config; something that requested
 * its own animation at a later commit would find the pending config already consumed. The device decides.
 *
 * React Native's Fabric renderer (0.88) has no keyboard curve (`LayoutAnimation.Types.keyboard` falls through
 * to linear there; `ReactCommon/react/renderer/animations/utils.cpp`), so the system's motion is approximated
 * with interpolators Fabric has. The two configs are fitted to one owner recording (iPhone Duo inner display,
 * iOS 27.2, 60 fps, 6 shows and 5 hides, keyboard offset per frame against the interpolators; owner accepted an
 * approximation, 2026-10-28):
 * - show: spring, `springDamping` 1.8 (Fabric reads it only as a non-integer double), 580 ms; rmse 5.6 pt, worst
 *   14 pt. The same recording against linear over an assumed 250 ms: rmse 20 pt, worst 49 pt.
 * - hide: easeOut, 250 ms; rmse 13 pt, worst 27 pt (a hide is only on screen for about 0.17 s, so this fit is
 *   weaker). Linear over 250 ms: rmse 33 pt, worst 58 pt.
 * Not the system curve, and fitted on one device and one recording. The length is a measured constant, not the
 * event's `duration` (the duration iOS reports was not measured, and the fit needs 580 ms for the show).
 */

import { LayoutAnimation, type LayoutAnimationConfig } from 'react-native';

import { isReduceMotionOn } from '../reduceMotion';

export type KeyboardMotionDirection = 'show' | 'hide';

/** The keyboard comes up or rises: a spring. */
export const KEYBOARD_SHOW_MOTION: LayoutAnimationConfig = {
  duration: 580,
  update: { type: LayoutAnimation.Types.spring, springDamping: 1.8 },
};

/** The keyboard goes away or lowers: an ease-out. */
export const KEYBOARD_HIDE_MOTION: LayoutAnimationConfig = {
  duration: 250,
  update: { type: LayoutAnimation.Types.easeOut },
};

/** Show when the keyboard's top edge appears or rises, hide when it leaves or lowers (null = no keyboard). */
export function keyboardMoveDirection(fromTop: number | null, toTop: number | null): KeyboardMotionDirection {
  if (toTop === null) return 'hide';
  return fromTop === null || toTop < fromTop ? 'show' : 'hide';
}

/**
 * Requests the animation for the next layout commit. Nothing with Reduce Motion on (FL-A11Y-05) or when the
 * event reports no duration (`eventDuration` <= 0: the keyboard does not animate).
 */
export function configureKeyboardMotion(direction: KeyboardMotionDirection, eventDuration: number | undefined): void {
  if ((eventDuration ?? 0) <= 0 || isReduceMotionOn()) return;
  LayoutAnimation.configureNext(direction === 'show' ? KEYBOARD_SHOW_MOTION : KEYBOARD_HIDE_MOTION);
}
