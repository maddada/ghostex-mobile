/**
 * Where the software keyboard's top edge is on screen, shared by every keyboard-aware container.
 *
 * Android: a React Native `Modal` is its own edge-to-edge dialog window, which the system does not
 * resize for the keyboard (the activity's `adjustResize` only covers the main window, and not on
 * every build once edge-to-edge is on; see useKeyboardMetrics). So containers measure their own
 * frame and compare it with the keyboard's top instead of trusting a resize: a window that did
 * shrink ends above the keyboard and gets no extra room, one that did not gets exactly the overlap.
 *
 * The chat composer keeps its own `useKeyboardInset`; this store is for everything else.
 */

import { useSyncExternalStore } from 'react';
import { Dimensions, Keyboard, LayoutAnimation, Platform, type KeyboardEvent } from 'react-native';

let keyboardTop: number | null = null;
const listeners = new Set<() => void>();
let subscribed = false;

function publish(next: number | null): void {
  if (next === keyboardTop) return;
  keyboardTop = next;
  for (const listener of listeners) listener();
}

function topFromEvent(event: KeyboardEvent): number | null {
  const { screenY, height } = event.endCoordinates;
  if (height <= 0 || screenY >= Dimensions.get('screen').height) return null;
  return screenY;
}

function ensureSubscribed(): void {
  if (subscribed) return;
  subscribed = true;
  const metrics = Keyboard.metrics();
  if (metrics !== undefined && metrics.height > 0) keyboardTop = metrics.screenY;
  if (Platform.OS === 'ios') {
    // iOS reports the frame before it animates, so containers move with the keyboard.
    const animate = (duration: number): void => {
      if (duration > 0) {
        LayoutAnimation.configureNext({ duration, update: { type: LayoutAnimation.Types.keyboard } });
      }
    };
    Keyboard.addListener('keyboardWillChangeFrame', (event) => {
      const next = topFromEvent(event);
      if (next !== keyboardTop) animate(event.duration);
      publish(next);
    });
    Keyboard.addListener('keyboardWillHide', (event) => {
      if (keyboardTop !== null) animate(event.duration);
      publish(null);
    });
  } else {
    // Android only reports after the fact; keyboardDidShow re-fires when the keyboard's height changes.
    Keyboard.addListener('keyboardDidShow', (event) => publish(topFromEvent(event)));
    Keyboard.addListener('keyboardDidHide', () => publish(null));
  }
}

function subscribe(listener: () => void): () => void {
  ensureSubscribed();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): number | null {
  return keyboardTop;
}

/** The keyboard's top edge in window points, or null while it is hidden. */
export function useKeyboardTop(): number | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
