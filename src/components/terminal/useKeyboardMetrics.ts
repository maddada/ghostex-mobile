/**
 * Soft-keyboard visibility + overlap tracking (terminal-screen.md §2).
 * Android devices do not all honor adjustResize once edge-to-edge layout is
 * active. Measure how much of the keyboard the viewport resize already
 * handled, then inset only the remaining overlap. iOS keeps its full-height
 * viewport, so its remaining overlap is the keyboard height.
 */

import { useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, useWindowDimensions, type KeyboardEvent } from 'react-native';

import { GhostexNative } from '../../../modules/ghostex-native/src';

export type KeyboardMetrics = {
  keyboardVisible: boolean;
  /** Bottom overlap not already handled by a native viewport resize. */
  bottomInset: number;
  /** Android's actual unobscured window boundary, including IME candidate/tool rows. */
  visibleWindowBottom: number | null;
};

export function useKeyboardMetrics(): KeyboardMetrics {
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const restingViewport = useRef({ width: viewportWidth, height: viewportHeight });
  const [keyboard, setKeyboard] = useState({
    keyboardVisible: false,
    height: 0,
  });
  const [visibleWindowBottom, setVisibleWindowBottom] = useState<number | null>(null);

  // Keep the pre-keyboard viewport height. A same-width height reduction may
  // arrive before Android's keyboardDidShow event, so never adopt that smaller
  // value as the resting height. Width changes identify a real orientation
  // change while the keyboard is hidden.
  if (!keyboard.keyboardVisible) {
    const resting = restingViewport.current;
    if (viewportWidth !== resting.width || viewportHeight > resting.height) {
      restingViewport.current = { width: viewportWidth, height: viewportHeight };
    }
  }

  useEffect(() => {
    const onShow = (event: KeyboardEvent): void => {
      const height = event.endCoordinates?.height ?? 0;
      setKeyboard({ keyboardVisible: true, height });
    };
    const onHide = (): void => {
      setKeyboard({ keyboardVisible: false, height: 0 });
    };

    const subscriptions =
      Platform.OS === 'ios'
        ? [
            Keyboard.addListener('keyboardWillShow', onShow),
            Keyboard.addListener('keyboardWillChangeFrame', onShow),
            Keyboard.addListener('keyboardWillHide', onHide),
          ]
        : [
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

  const viewportResize =
    Platform.OS === 'android'
      ? Math.max(0, restingViewport.current.height - viewportHeight)
      : 0;

  return {
    keyboardVisible: keyboard.keyboardVisible,
    bottomInset: keyboard.keyboardVisible ? Math.max(0, keyboard.height - viewportResize) : 0,
    visibleWindowBottom,
  };
}
