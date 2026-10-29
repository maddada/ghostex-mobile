/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. REQ-NFR-001 AC1 (the chat composer stays above the keyboard as before)
 * with owner S1-8 (the bottom inset counted once) and FL-LAY-11 (review s1-floor-r1 #12, s1-floor-r2
 * #12): the composer's frame (`KeyboardLiftedView`, NativeComposer's root) lifts it from the keyboard's
 * last reported frame, again when the window's height changes without a keyboard event (a fold, unfold or
 * rotation) and when its own layout changes. Frames in window points: the folded display 466x678 with
 * the keyboard's top at 413 (owner's device session), the home indicator inset 20.
 */

import { Dimensions, StyleSheet, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { keyboardFixture } from '../../../components/common/keyboard/keyboardEventFixtures';
import { KeyboardLiftedView } from './KeyboardLiftedView';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 20, left: 0, right: 0 }),
}));

/** The native methods React Native's Jest preset gives every View (`measureInWindow` measures nothing). */
const mockNativeMethods = jest.requireActual<{ default: { measureInWindow: jest.Mock } }>(
  '@react-native/jest-preset/jest/MockNativeMethods',
).default;

/** The composer's frame in the window, as the composer measures itself: its bottom on the window's. */
let composer = { y: 578, height: 100 };

async function setWindow(width: number, height: number): Promise<void> {
  await act(() => {
    Dimensions.set({
      window: { width, height, scale: 3, fontScale: 1 },
      screen: { width, height, scale: 3, fontScale: 1 },
    });
  });
}

/** The notifications iOS posts, with their start and end frames (keyboardEventFixtures.ts). */
const keyboard = keyboardFixture({ width: 466, height: 678 });

async function keyboardAt(top: number, height: number): Promise<void> {
  await act(() => keyboard.show(top, height, 0));
}

/** The space below the composer's content: the lift above the keyboard, or the bottom inset. */
function bottomPadding(): number | undefined {
  const frame = screen.getByText('composer').parent;
  return StyleSheet.flatten(frame?.props.style)?.paddingBottom;
}

beforeEach(async () => {
  composer = { y: 578, height: 100 };
  mockNativeMethods.measureInWindow.mockImplementation(
    (onFrame: (x: number, y: number, width: number, height: number) => void) =>
      onFrame(0, composer.y, 466, composer.height),
  );
  await setWindow(466, 678);
  await act(() => keyboard.hide(0));
  await render(
    <KeyboardLiftedView>
      <Text>composer</Text>
    </KeyboardLiftedView>,
  );
});

afterEach(() => {
  mockNativeMethods.measureInWindow.mockReset();
});

test('REQ-NFR-001 AC1, owner S1-8: the bottom inset once without a keyboard, 8 pt above the keyboard with one', async () => {
  expect(bottomPadding()).toBe(20);
  await keyboardAt(413, 265);
  expect(bottomPadding()).toBe(678 - 413 + 8);
});

test('REQ-NFR-001 AC1, FL-LAY-11: a window height change without a keyboard event lifts it from the last keyboard frame', async () => {
  await keyboardAt(413, 265);
  // Unfolded in landscape: the window is 669 pt tall, the composer still on its bottom.
  composer = { y: 569, height: 100 };
  await setWindow(951, 669);
  expect(bottomPadding()).toBe(669 - 413 + 8);
});

test("REQ-NFR-001 AC1, FL-LAY-11: the composer's own layout change measures the overlap again", async () => {
  await keyboardAt(413, 265);
  // The composer's bottom moves up 40 pt (a bar under it appeared): 40 pt less to lift.
  composer = { y: 538, height: 100 };
  const frame = screen.getByText('composer').parent;
  if (frame === null) throw new Error('the composer frame holds its content');
  await act(() => {
    fireEvent(frame, 'layout', { nativeEvent: { layout: { x: 0, y: 538, width: 466, height: 100 } } });
  });
  expect(bottomPadding()).toBe(225 + 8);
});

test('a function child gets the padding in the same render the keyboard height changes (the composer sizes its field by it)', async () => {
  const rendered: number[] = [];
  await screen.unmount();
  await render(
    <KeyboardLiftedView>
      {(bottom) => {
        rendered.push(bottom);
        return <Text>composer</Text>;
      }}
    </KeyboardLiftedView>,
  );
  expect(rendered.at(-1)).toBe(bottomPadding());
  rendered.length = 0;
  await keyboardAt(413, 265);
  // Every render after the keyboard's frame arrived already carries the new padding: no render holds the old one.
  expect(rendered.length).toBeGreaterThan(0);
  expect(rendered.every((bottom) => bottom === 678 - 413 + 8)).toBe(true);
  // The padding drawn is the padding handed over.
  expect(bottomPadding()).toBe(rendered.at(-1));
});
