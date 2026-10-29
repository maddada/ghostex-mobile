/**
 * Where the software keyboard's top edge is in the app's window, shared by every keyboard-aware container,
 * and the keyboard's last reported frame, from which the iPhone Duo's side bar learns the keyboard
 * height of a window (`useKeyboardFrame`).
 *
 * Android: a React Native `Modal` is its own edge-to-edge dialog window, which the system does not
 * resize for the keyboard (the activity's `adjustResize` only covers the main window, and not on
 * every build once edge-to-edge is on; see useKeyboardMetrics). So containers measure their own
 * frame and compare it with the keyboard's top instead of trusting a resize: a window that did
 * shrink ends above the keyboard and gets no extra room, one that did not gets exactly the overlap.
 *
 * iOS: this store is also the one place that requests the keyboard's layout animation, for everything that
 * follows it (the app chrome, the sheets, the terminal through `useKeyboardState`, the chat composer through
 * `useKeyboardTop`), and the one model of keyboard visibility (below).
 */

import { useSyncExternalStore } from 'react';
import { Keyboard, Platform, useWindowDimensions, type KeyboardEvent } from 'react-native';

import { subscribeReduceMotion } from '../reduceMotion';
import { configureKeyboardMotion, keyboardMoveDirection } from './keyboardMotion';
import { keyboardFrameOf, keyboardTopInWindow, type KeyboardFrame } from './keyboardTop';

/**
 * What the store knows. `visible` (iOS) is the keyboard's own visibility: true from the `keyboardWillShow`
 * until the `keyboardWillHide` (or a frame-only hide: a change-frame whose end frame is off the screen); `appearances` counts those hidden-to-shown transitions, so a consumer that mounts
 * late sees no false one; `duration` is the last processed event's reported duration (0: nothing animated).
 */
type KeyboardState = {
  readonly frame: KeyboardFrame | null;
  readonly visible: boolean;
  readonly appearances: number;
  readonly duration: number;
};

/** The keyboard's last reported frame; whether it reaches into the window is the hooks' call (Android). */
let state: KeyboardState = { frame: null, visible: false, appearances: 0, duration: 0 };
const listeners = new Set<() => void>();
let subscribed = false;

function publish(next: Partial<KeyboardState>): void {
  const merged = { ...state, ...next };
  const a = merged.frame;
  const b = state.frame;
  const sameFrame = a?.top === b?.top && a?.height === b?.height && a?.width === b?.width;
  if (
    sameFrame &&
    merged.visible === state.visible &&
    merged.appearances === state.appearances &&
    merged.duration === state.duration
  ) {
    return;
  }
  state = { ...merged, frame: sameFrame ? state.frame : merged.frame };
  for (const listener of listeners) listener();
}

function frameFromEvent(event: KeyboardEvent): KeyboardFrame | null {
  const { screenY, height, width } = event.endCoordinates;
  return keyboardFrameOf(screenY, height, width);
}

/** The frame the keyboard moves from in this notification (iOS only), in the same space as its end frame. */
function startFrameFromEvent(event: KeyboardEvent): KeyboardFrame | null {
  const start = 'startCoordinates' in event ? event.startCoordinates : undefined;
  return start == null ? null : keyboardFrameOf(start.screenY, start.height, start.width);
}

/**
 * Whether a change-frame notification takes the keyboard off the screen: its end frame starts at or below
 * the bottom edge of its start frame. Decided from the one notification (`startCoordinates` and
 * `endCoordinates` share a coordinate space, so a turn or fold cannot skew it, and no window or screen size
 * is needed); only when the notification has no start frame, from the stored frame.
 */
function leavesScreen(event: KeyboardEvent, end: KeyboardFrame): boolean {
  const from = startFrameFromEvent(event) ?? state.frame;
  return from !== null && end.top >= from.top + from.height;
}

function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  const metrics = Keyboard.metrics();
  const initial = metrics != null ? keyboardFrameOf(metrics.screenY, metrics.height, metrics.width) : null;
  // Keyboard.metrics() reports a frame only while the keyboard is shown.
  if (initial !== null) state = { ...state, frame: initial, visible: Platform.OS === 'ios' };
  if (Platform.OS === 'ios') {
    // The one model of iOS keyboard visibility, and the one writer of the keyboard's layout animation
    // (keyboardMotion.ts): the keyboard is visible between `keyboardWillShow` (iOS posts it for every
    // appearance) and `keyboardWillHide`. A frame change updates the frame and moves things only while it is
    // visible; one that arrives while hidden (the end frame of a hide) is no appearance and no move. A frame
    // change whose end frame is off the screen ends the visibility like a hide does, once: the
    // `keyboardWillHide` after it finds the keyboard hidden already.
    const hide = (event: KeyboardEvent): void => {
      if (!state.visible) return;
      configureKeyboardMotion('hide', event.duration);
      publish({ frame: null, visible: false, duration: event.duration ?? 0 });
    };
    // Moves a visible keyboard to the frame of this notification, once per change. `motion` is the show motion
    // for a `keyboardWillShow`; for a frame change it is read off the notification's own start and end frames
    // (the stored frame when it has no start frame): a rising top is a show, a lowering one a hide.
    const move = (event: KeyboardEvent, next: KeyboardFrame, appears: boolean, motion: 'show' | 'move'): void => {
      if (appears || next.top !== state.frame?.top) {
        const fromTop = startFrameFromEvent(event)?.top ?? state.frame?.top ?? null;
        configureKeyboardMotion(motion === 'show' ? 'show' : keyboardMoveDirection(fromTop, next.top), event.duration);
      }
      publish({
        frame: next,
        visible: true,
        appearances: appears ? state.appearances + 1 : state.appearances,
        duration: event.duration ?? 0,
      });
    };
    // A `keyboardWillShow` always means the keyboard is visible (iOS posts it for every appearance); it is an
    // appearance only if the store held it hidden: a re-layout of a keyboard that is up (a turn, a fold) is none.
    Keyboard.addListener('keyboardWillShow', (event) => {
      const next = frameFromEvent(event);
      if (next === null) hide(event);
      else move(event, next, !state.visible, 'show');
    });
    // A frame change moves or resizes a visible keyboard, or is its frame-only hide; while hidden it is ignored
    // (the end frame of a hide arrives after `keyboardWillHide`).
    Keyboard.addListener('keyboardWillChangeFrame', (event) => {
      if (!state.visible) return;
      const next = frameFromEvent(event);
      if (next === null || leavesScreen(event, next)) hide(event);
      else move(event, next, false, 'move');
    });
    Keyboard.addListener('keyboardWillHide', hide);
  } else {
    // Android only reports after the fact; keyboardDidShow re-fires when the keyboard's height changes.
    Keyboard.addListener('keyboardDidShow', (event) => publish({ frame: frameFromEvent(event) }));
    Keyboard.addListener('keyboardDidHide', () => publish({ frame: null }));
  }
}

function subscribe(listener: () => void): () => void {
  ensureSubscribed();
  listeners.add(listener);
  // The animation (keyboardMotion.ts) follows Reduce Motion for as long as anything consumes the frame.
  const stopFollowingReduceMotion = subscribeReduceMotion(() => undefined);
  return () => {
    listeners.delete(listener);
    stopFollowingReduceMotion();
  };
}

function snapshot(): KeyboardFrame | null {
  return state.frame;
}

function topSnapshot(): number | null {
  return state.frame?.top ?? null;
}

function stateSnapshot(): KeyboardState {
  return state;
}

/**
 * iOS: the keyboard's visibility, appearance count and last event duration, for the terminal's metrics
 * (`useKeyboardMetrics`), whose layout change is expected to land in the commit this store's animation is
 * requested for (basis and limit: `keyboardMotion.ts`).
 */
export function useKeyboardState(): KeyboardState {
  return useSyncExternalStore(subscribe, stateSnapshot, stateSnapshot);
}

/** The keyboard's last reported frame, or null while it is hidden; the same object until it changes. */
export function useKeyboardFrame(): KeyboardFrame | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** The keyboard's top edge in window points, or null while it is hidden. */
export function useKeyboardTop(): number | null {
  const top = useSyncExternalStore(subscribe, topSnapshot, topSnapshot);
  return keyboardTopInWindow(top, useWindowDimensions().height);
}
