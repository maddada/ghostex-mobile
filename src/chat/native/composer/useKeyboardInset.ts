/**
 * How far the software keyboard reaches over a view that sits at the bottom of the screen, so the
 * composer can lift itself above it. iOS only: Android resizes the window for the keyboard
 * (Expo's default `softwareKeyboardLayoutMode: resize`), so the composer is already above it there.
 *
 * A synchronous consumer of the shared keyboard store (`useKeyboardTop`), like the terminal: it registers no
 * keyboard listener and requests no animation of its own. Expected: the lift changes in the render the store's
 * publish causes, which carries the store's fitted motion (`keyboardMotion.ts`) with the rest of the screen.
 * Basis and limit: React flushes that sync-lane render in a microtask after the keyboard event, so a JS-driven
 * `Animated` frame (a later task) should not land in between; a `setNativeProps` or `Animated` update made
 * synchronously inside another keyboard listener could still consume the pending config (none exists in `src`:
 * the store holds the only iOS keyboard listeners). Only a hand test on the device decides. The lift is the view's resting bottom edge (in window points, cached from its
 * layout, never measured at keyboard time) less the keyboard's top edge. The lift is padding inside the view,
 * so its bottom edge stays put with and without it. The resting bottom edge is measured again when the view's
 * own layout changes (`onAnchorLayout` for its `onLayout`) and when the window's height does (a fold, an
 * unfold or a rotation: FL-LAY-11); until the first measurement the window's bottom stands in for it.
 */

import { useCallback, useEffect, useState, type RefObject } from 'react';
import { Platform, useWindowDimensions, type ViewInstance } from 'react-native';

import { useKeyboardTop } from '../../../components/common/keyboard/keyboardFrame';

export type KeyboardInset = {
  /** The lift in points: how far the keyboard reaches over the view, 0 without one. */
  readonly inset: number;
  /** For the view's `onLayout`: its frame changed, so its resting bottom edge is measured again. */
  readonly onAnchorLayout: () => void;
};

export function useKeyboardInset(anchor: RefObject<ViewInstance | null>): KeyboardInset {
  const windowHeight = useWindowDimensions().height;
  const keyboardTop = useKeyboardTop();
  const [anchorBottom, setAnchorBottom] = useState<number | null>(null);
  const ios = Platform.OS === 'ios';

  const measure = useCallback((): void => {
    anchor.current?.measureInWindow((_x, y, _width, height) => setAnchorBottom(y + height));
  }, [anchor]);

  // The window's height changed, with or without a keyboard: the view's bottom edge may have moved.
  useEffect(() => {
    if (ios) measure();
  }, [ios, windowHeight, measure]);

  const onAnchorLayout = useCallback(() => {
    if (ios) measure();
  }, [ios, measure]);

  const inset = ios && keyboardTop !== null ? Math.max(0, (anchorBottom ?? windowHeight) - keyboardTop) : 0;
  return { inset, onAnchorLayout };
}
