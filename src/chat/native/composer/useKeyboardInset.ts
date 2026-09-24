/**
 * How far the software keyboard reaches over a view that sits at the bottom of the screen, so the
 * composer can lift itself above it. iOS only: Android resizes the window for the keyboard
 * (Expo's default `softwareKeyboardLayoutMode: resize`), so the composer is already above it there.
 *
 * `gap` is the distance from the view's bottom edge to the bottom of the window with no keyboard
 * (a tab bar or a home indicator strip below the chat); the lift is the keyboard height minus it.
 */

import { useEffect, useRef, useState, type RefObject } from 'react';
import { Dimensions, Keyboard, LayoutAnimation, Platform, type View } from 'react-native';

export function useKeyboardInset(anchor: RefObject<View | null>): number {
  const [inset, setInset] = useState(0);
  const insetRef = useRef(0);
  useEffect(() => {
    if (Platform.OS !== 'ios') return undefined;
    const apply = (next: number, duration: number): void => {
      if (next === insetRef.current) return;
      insetRef.current = next;
      if (duration > 0) {
        LayoutAnimation.configureNext({
          duration,
          update: { type: LayoutAnimation.Types.keyboard },
        });
      }
      setInset(next);
    };
    const show = Keyboard.addListener('keyboardWillChangeFrame', (event) => {
      const keyboardTop = event.endCoordinates.screenY;
      const windowHeight = Dimensions.get('window').height;
      if (keyboardTop >= windowHeight) {
        apply(0, event.duration);
        return;
      }
      const view = anchor.current;
      if (view === null) {
        apply(windowHeight - keyboardTop, event.duration);
        return;
      }
      view.measureInWindow((_x, y, _width, height) => {
        // The view's bottom without the lift it already has.
        const bottom = y + height - insetRef.current;
        apply(Math.max(0, bottom - keyboardTop), event.duration);
      });
    });
    const hide = Keyboard.addListener('keyboardWillHide', (event) => apply(0, event.duration));
    return () => {
      show.remove();
      hide.remove();
    };
  }, [anchor]);
  return inset;
}
