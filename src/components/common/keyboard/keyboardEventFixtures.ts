/**
 * Test fixtures: the notifications iOS posts for the software keyboard, with `startCoordinates` and
 * `endCoordinates` as iOS carries them (one coordinate space: the screen's). A hide ends below the screen
 * with the keyboard's own height; a show starts there. Used by the keyboard-following component tests only.
 */

import { DeviceEventEmitter } from 'react-native';

type Frame = { readonly top: number; readonly height: number };

export type KeyboardFixture = {
  /** The screen the keyboard is in (a turn changes it). */
  setScreen: (width: number, height: number) => void;
  /** `keyboardWillShow` and `keyboardWillChangeFrame` for one appearance or resize, as iOS posts them. */
  show: (top: number, height: number, duration?: number) => void;
  /** A lone `keyboardWillChangeFrame`; `from` overrides the start frame (default: the keyboard's last frame). */
  changeFrame: (top: number, height: number, duration?: number, from?: Frame) => void;
  /** `keyboardWillHide`: the keyboard goes below the screen. */
  hide: (duration?: number) => void;
};

export function keyboardFixture(
  initialScreen: { width: number; height: number } = { width: 402, height: 874 },
): KeyboardFixture {
  let screen = initialScreen;
  let current: Frame | null = null;
  const coordinates = (frame: Frame) => ({ screenX: 0, screenY: frame.top, width: screen.width, height: frame.height });
  const below = (height: number): Frame => ({ top: screen.height, height });
  return {
    // After a turn the keyboard's earlier frame is in another space: the next notification starts below the new screen.
    setScreen: (width, height) => {
      screen = { width, height };
      current = null;
    },
    show: (top, height, duration = 250) => {
      const start = current ?? below(height);
      const end = { top, height };
      const event = {
        duration,
        easing: 'keyboard',
        startCoordinates: coordinates(start),
        endCoordinates: coordinates(end),
      };
      DeviceEventEmitter.emit('keyboardWillShow', event);
      DeviceEventEmitter.emit('keyboardWillChangeFrame', event);
      current = end;
    },
    changeFrame: (top, height, duration = 250, from) => {
      const start = from ?? current ?? below(height);
      const end = { top, height };
      DeviceEventEmitter.emit('keyboardWillChangeFrame', {
        duration,
        easing: 'keyboard',
        startCoordinates: coordinates(start),
        endCoordinates: coordinates(end),
      });
      current = end;
    },
    hide: (duration = 250) => {
      const start = current ?? below(336);
      DeviceEventEmitter.emit('keyboardWillHide', {
        duration,
        easing: 'keyboard',
        startCoordinates: coordinates(start),
        endCoordinates: coordinates(below(start.height)),
      });
      current = null;
    },
  };
}
