/**
 * Soft-keyboard visibility + overlap tracking (terminal-screen.md §2).
 * Android devices do not all honor adjustResize once edge-to-edge layout is
 * active. Measure how much of the keyboard the viewport resize already
 * handled, then inset only the remaining overlap. iOS keeps its full-height
 * viewport; its overlap is the window's bottom minus the keyboard's top edge.
 * iOS reads the shared keyboard store (`keyboardFrame.ts`), which also requests
 * the layout animation this hook's layout change is expected to land in (basis and limit: `keyboardMotion.ts`; the
 * motion fitted to the measured keyboard, `keyboardMotion.ts`: a spring for a
 * show, an ease-out for a hide; an approximation, Fabric has no keyboard curve;
 * nothing with Reduce Motion on: then everything goes to its end position at
 * once). This hook registers no keyboard listener of its own there. Also reports the keyboard coming up (`onAppear`).
 */

import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { Keyboard, Platform, useWindowDimensions, type KeyboardEvent } from 'react-native';

import { GhostexNative } from '../../../modules/ghostex-native/src';
import { useKeyboardState } from '../common/keyboard/keyboardFrame';
import { KEYBOARD_HIDE_MOTION } from '../common/keyboard/keyboardMotion';
import { useReduceMotion } from '../common/reduceMotion';
import { keyboardTopInWindow } from '../common/keyboard/keyboardTop';

export type KeyboardMetrics = {
  keyboardVisible: boolean;
  /** Bottom overlap not already handled by a native viewport resize. */
  bottomInset: number;
  /** Android's actual unobscured window boundary, including IME candidate/tool rows. */
  visibleWindowBottom: number | null;
  /** Milliseconds a hide is animated over, which the key bar dock stays mounted for (0 with Reduce Motion on or no animation). */
  hideMotionMs: number;
};

export type KeyboardMetricsOptions = {
  /** The iOS terminal: its layout moves with the keyboard. */
  slides?: boolean;
  /** The keyboard came up (it was hidden before), `slides` only. */
  onAppear?: () => void;
};

export function useKeyboardMetrics({ slides = false, onAppear }: KeyboardMetricsOptions = {}): KeyboardMetrics {
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const restingViewport = useRef({ width: viewportWidth, height: viewportHeight });
  const reduceMotion = useReduceMotion();
  // iOS: the shared keyboard store is the one source (visibility, frame, and the one writer of the layout
  // animation; the terminal's layout change is expected to land in the commit it is requested for, see keyboardMotion.ts).
  const shared = useKeyboardState();
  // Android: its own events (viewport-resize logic below).
  const [android, setAndroid] = useState<{ keyboardVisible: boolean; height: number }>({
    keyboardVisible: false,
    height: 0,
  });
  const [visibleWindowBottom, setVisibleWindowBottom] = useState<number | null>(null);
  const reportAppear = useEffectEvent(() => onAppear?.());
  const ios = Platform.OS === 'ios';
  // iOS: the window decides how far the keyboard reaches into it, also after a window size change
  // without a keyboard event. A frame the store still holds that no longer reaches into this window
  // (an end frame after a turn or fold, before its keyboardWillHide) is a hidden keyboard here.
  const windowTop = keyboardTopInWindow(shared.frame?.top ?? null, viewportHeight);
  const keyboardVisible = ios ? shared.visible && windowTop !== null : android.keyboardVisible;

  // Keep the pre-keyboard viewport height. A same-width height reduction may
  // arrive before Android's keyboardDidShow event, so never adopt that smaller
  // value as the resting height. Width changes identify a real orientation
  // change while the keyboard is hidden.
  if (!keyboardVisible) {
    const resting = restingViewport.current;
    if (viewportWidth !== resting.width || viewportHeight > resting.height) {
      restingViewport.current = { width: viewportWidth, height: viewportHeight };
    }
  }

  // The keyboard came up (hidden to shown) since this hook last looked: a late mount sees none.
  const seenAppearances = useRef(shared.appearances);
  useEffect(() => {
    if (seenAppearances.current === shared.appearances) return;
    seenAppearances.current = shared.appearances;
    if (slides && ios) reportAppear();
  }, [shared.appearances, slides, ios]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const onShow = (event: KeyboardEvent): void => {
      setAndroid({ keyboardVisible: true, height: event.endCoordinates?.height ?? 0 });
    };
    const onHide = (): void => setAndroid({ keyboardVisible: false, height: 0 });
    const subscriptions = [
      Keyboard.addListener('keyboardDidShow', onShow),
      Keyboard.addListener('keyboardDidHide', onHide),
    ];
    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const subscription = GhostexNative.addListener('onVisibleWindowFrameChange', (event) => {
      setVisibleWindowBottom(event.bottom);
    });
    return () => subscription.remove();
  }, []);

  const viewportResize = Platform.OS === 'android' ? Math.max(0, restingViewport.current.height - viewportHeight) : 0;
  const overlap = ios ? (windowTop === null ? 0 : viewportHeight - windowTop) : android.height - viewportResize;

  return {
    keyboardVisible,
    bottomInset: keyboardVisible ? Math.max(0, overlap) : 0,
    visibleWindowBottom,
    // The dock keeps the key bar mounted for the hide motion's length; with nothing animating it leaves at once.
    hideMotionMs: !ios || reduceMotion || shared.duration <= 0 ? 0 : (KEYBOARD_HIDE_MOTION.duration ?? 0),
  };
}
