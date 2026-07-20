/**
 * Soft-keyboard visibility + height tracking (terminal-screen.md §2).
 * - iOS: the window never resizes, so the screen must translate its bottom
 *   chrome up by the keyboard height (`bottomInset`). `keyboardWillShow` /
 *   `keyboardWillChangeFrame` keep the height current across QuickType and
 *   orientation changes.
 * - Android: `android.softwareKeyboardLayoutMode` defaults to resize, so the
 *   window itself shrinks and no extra translation is needed (`bottomInset`
 *   stays 0); only `keyboardDidShow`/`keyboardDidHide` visibility is tracked.
 */

import { useEffect, useState } from 'react';
import { Keyboard, Platform, type KeyboardEvent } from 'react-native';

export type KeyboardMetrics = {
  keyboardVisible: boolean;
  /** Extra bottom translation needed to sit above the keyboard (iOS only). */
  bottomInset: number;
};

export function useKeyboardMetrics(): KeyboardMetrics {
  const [metrics, setMetrics] = useState<KeyboardMetrics>({
    keyboardVisible: false,
    bottomInset: 0,
  });

  useEffect(() => {
    const onShow = (event: KeyboardEvent): void => {
      const height = event.endCoordinates?.height ?? 0;
      setMetrics({
        keyboardVisible: true,
        bottomInset: Platform.OS === 'ios' ? height : 0,
      });
    };
    const onHide = (): void => {
      setMetrics({ keyboardVisible: false, bottomInset: 0 });
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

  return metrics;
}
