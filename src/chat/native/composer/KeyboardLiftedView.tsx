/**
 * The chat composer's frame at the bottom of the chat view: it lifts what it holds above the software
 * keyboard and keeps the home indicator's inset without one (the bottom inset counted once). It follows the shared keyboard store synchronously, so its lift is expected to land in the commit the
 * keyboard's motion is requested for (basis and limit: `keyboardMotion.ts`; the device decides), and it measures
 * its resting bottom edge when its own layout changes (`onLayout`) and the window's height does
 * (`useKeyboardInset`), so the composer cannot lose either hookup. In the iPhone Duo's laptop pose it stands
 * `LAPTOP_CLEAR` above the fold with the keyboard below it, as the approved mockup shows. In one of the Duo's pane
 * slots (`chatPlacement`) the pane already ends at the keyboard or above the fold and away from the home indicator:
 * the composer keeps only its least space below, with the keyboard or without.
 *
 * Android: the terminal screen already ends at the keyboard's top while it is up (its bottom padding,
 * `TerminalScreen.tsx`), so the composer keeps only `KEYBOARD_GAP` below it there, not the home indicator's
 * inset, which the keyboard covers.
 *
 * CDXC:SessionChat 2026-11-12 WHY:
 * User (screenshot of the phone's chat with the keyboard open, status line off): an empty band stood between the
 * chat box and the keyboard's suggestion bar (about 50 points on a Pixel-sized emulator: the gesture bar's 24 twice,
 * plus 3). It was not a status line: on Android the composer kept the gesture bar's inset below it with the keyboard
 * up, and the screen's bottom spacer kept it a second time, both under a keyboard that already covers that bar. With the keyboard up the chat box now sits
 * `KEYBOARD_GAP` above the keyboard, as on the iPhone; with it down nothing changes (the 2026-10-29 spacer decision
 * in `TerminalScreen.tsx`).
 */

import { useRef, type ReactNode } from 'react';
import { Platform, View, type StyleProp, type ViewInstance, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useKeyboardFrame } from '../../../components/common/keyboard/keyboardFrame';
import { LAPTOP_CLEAR } from '../../../components/common/verticalBar/layout';
import { useLaptopFold } from '../../../components/common/verticalBar/laptopFold';
import { useChatPlacement } from '../chatPlacement';
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
  // In the laptop pose the lift ends at the fold's top: keep the knick's clearance there.
  const gap = useLaptopFold() === null ? KEYBOARD_GAP : LAPTOP_CLEAR;
  // Android reports the keyboard only while it is up (`keyboardDidShow` to `keyboardDidHide`).
  const androidKeyboardUp = useKeyboardFrame() !== null && Platform.OS === 'android';
  const bottom = useChatPlacement().inPane
    ? MIN_BOTTOM
    : inset > 0
      ? inset + gap
      : androidKeyboardUp
        ? KEYBOARD_GAP
        : Math.max(insets.bottom, MIN_BOTTOM);
  return (
    <View ref={anchor} style={[style, { paddingBottom: bottom }]} onLayout={onAnchorLayout}>
      {typeof children === 'function' ? children(bottom) : children}
    </View>
  );
}
