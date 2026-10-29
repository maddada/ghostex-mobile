/**
 * The chat composer's frame at the bottom of the chat view: it lifts what it holds above the software
 * keyboard and keeps the home indicator's inset without one (owner S1-8: the bottom inset counted
 * once). It follows the shared keyboard store synchronously, so its lift is expected to land in the commit the
 * keyboard's motion is requested for (basis and limit: `keyboardMotion.ts`; the device decides), and it measures
 * its resting bottom edge when its own layout changes (`onLayout`) and the window's height does
 * (`useKeyboardInset`, FL-LAY-11), so the composer cannot lose either hookup.
 */

import { useRef, type ReactNode } from 'react';
import { View, type StyleProp, type ViewInstance, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyboardInset } from './useKeyboardInset';

/** Space between the composer and the keyboard's top edge. */
const KEYBOARD_GAP = 8;
/** The least space below the composer without a keyboard, where the window has no bottom inset. */
const MIN_BOTTOM = 12;

export function KeyboardLiftedView({
  style,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  /** A function child gets the padding below it (the lift or the inset) in the render it changes. */
  children: ReactNode | ((bottom: number) => ReactNode);
}) {
  const insets = useSafeAreaInsets();
  const anchor = useRef<ViewInstance>(null);
  const { inset, onAnchorLayout } = useKeyboardInset(anchor);
  const bottom = inset > 0 ? inset + KEYBOARD_GAP : Math.max(insets.bottom, MIN_BOTTOM);
  return (
    <View ref={anchor} style={[style, { paddingBottom: bottom }]} onLayout={onAnchorLayout}>
      {typeof children === 'function' ? children(bottom) : children}
    </View>
  );
}
