/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. REQ-NFR-001 AC1 (the terminal keeps working with the keyboard as before). The
 * keyboard store (`keyboardFrame.ts`) and its terminal consumer
 * (`useKeyboardMetrics`) against the notifications iOS posts, each with its start and end frame
 * (keyboardEventFixtures.ts): the one writer of the layout animation (spring 1.8 / 580 ms for a show,
 * ease-out / 250 ms for a hide), the visibility model (`keyboardWillShow` always visible, a frame change
 * only while visible, a frame-only hide when its end frame starts at or below its start frame's bottom edge),
 * appearances, and both turn directions. Frames in screen points: portrait 402x874 (keyboard 538/336),
 * landscape 874x402 (keyboard 202/200).
 */

import { AccessibilityInfo, Dimensions, LayoutAnimation, Platform } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';

import { useKeyboardMetrics } from '../../terminal/useKeyboardMetrics';
import { keyboardFixture } from './keyboardEventFixtures';
import { useKeyboardFrame, useKeyboardState, useKeyboardTop } from './keyboardFrame';

jest.mock('../../../../modules/ghostex-native/src', () => ({
  GhostexNative: { addListener: () => ({ remove: () => undefined }) },
}));

const SHOW = { duration: 580, update: { type: 'spring', springDamping: 1.8 } };
const HIDE = { duration: 250, update: { type: 'easeOut' } };

const keyboard = keyboardFixture();
let motion: jest.SpyInstance;
let reduceMotion = false;

const turn = (width: number, height: number) =>
  act(() => {
    Dimensions.set({
      window: { width, height, scale: 3, fontScale: 1 },
      screen: { width, height, scale: 3, fontScale: 1 },
    });
    keyboard.setScreen(width, height);
  });

beforeEach(async () => {
  Platform.OS = 'ios';
  reduceMotion = false;
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(reduceMotion));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => ({ remove: () => undefined })) as never);
  motion = jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => undefined);
  await act(() => keyboard.hide(0));
  await turn(402, 874);
  motion.mockClear();
});

afterEach(async () => {
  await act(() => keyboard.hide(0));
  jest.restoreAllMocks();
});

function mount(onAppear?: () => void) {
  return renderHook(() => ({
    metrics: useKeyboardMetrics({ slides: true, onAppear }),
    top: useKeyboardTop(),
    shared: useKeyboardState(),
  }));
}

test.each(['hide-first', 'frame-first'])(
  'hide ordering %s: one hide motion, hidden, no new appearance',
  async (order) => {
    const appeared = jest.fn();
    const hook = await mount(appeared);
    await act(async () => undefined);
    await act(() => keyboard.show(538, 336));
    expect(appeared).toHaveBeenCalledTimes(1);
    motion.mockClear();
    if (order === 'hide-first') {
      await act(() => keyboard.hide());
      await act(() => keyboard.changeFrame(874, 336, 250, { top: 538, height: 336 }));
    } else {
      await act(() => keyboard.changeFrame(874, 336, 250, { top: 538, height: 336 }));
      await act(() => keyboard.hide());
    }
    expect(motion.mock.calls).toEqual([[HIDE]]);
    expect(hook.result.current.metrics.keyboardVisible).toBe(false);
    expect(hook.result.current.metrics.bottomInset).toBe(0);
    expect(appeared).toHaveBeenCalledTimes(1);
  },
);

test('a terminal that mounts while the keyboard is up sees no appearance; a lowering frame is one hide motion', async () => {
  const owner = await renderHook(() => useKeyboardFrame());
  await act(() => keyboard.show(498, 376));
  const appeared = jest.fn();
  const hook = await mount(appeared);
  await act(async () => undefined);
  expect(appeared).not.toHaveBeenCalled();
  motion.mockClear();
  await act(() => keyboard.changeFrame(538, 336));
  expect(motion.mock.calls).toEqual([[HIDE]]);
  expect(hook.result.current.metrics.bottomInset).toBe(336);
  expect(appeared).not.toHaveBeenCalled();
  await owner.unmount();
});

test('a rising frame is a show motion, a lowering one a hide motion, a repeated one none; Reduce Motion and duration 0 none', async () => {
  const hook = await mount();
  await act(async () => undefined);
  await act(() => keyboard.show(538, 336));
  expect(motion.mock.calls).toEqual([[SHOW]]);
  motion.mockClear();
  await act(() => keyboard.changeFrame(498, 376));
  expect(motion.mock.calls).toEqual([[SHOW]]);
  motion.mockClear();
  await act(() => keyboard.changeFrame(498, 376));
  expect(motion).not.toHaveBeenCalled();
  await act(() => keyboard.changeFrame(538, 336));
  expect(motion.mock.calls).toEqual([[HIDE]]);
  await act(() => keyboard.hide());
  motion.mockClear();
  await act(() => keyboard.show(538, 336, 0));
  await act(() => keyboard.hide(0));
  expect(motion).not.toHaveBeenCalled();
  await hook.unmount();
  reduceMotion = true;
  const reduced = await mount();
  await act(async () => undefined);
  await act(() => keyboard.show(538, 336));
  await act(() => keyboard.hide());
  expect(motion).not.toHaveBeenCalled();
  expect(reduced.result.current.metrics.hideMotionMs).toBe(0);
});

test('turn 874 to 402: the hidden end frame in the small window is one hide motion and no show, not visible', async () => {
  const hook = await mount();
  await act(async () => undefined);
  await act(() => keyboard.show(538, 336));
  await turn(874, 402);
  motion.mockClear();
  // Start: the keyboard in the landscape screen (202/200); end: below it (402).
  await act(() => keyboard.changeFrame(402, 200, 250, { top: 202, height: 200 }));
  expect(motion.mock.calls).toEqual([[HIDE]]);
  expect(hook.result.current.metrics.keyboardVisible).toBe(false);
  expect(hook.result.current.top).toBeNull();
  expect(hook.result.current.metrics.bottomInset).toBe(0);
});

test('turn 402 to 874: a portrait show is not discarded: visible, the right overlap, no appearance', async () => {
  await turn(874, 402);
  const appeared = jest.fn();
  const hook = await mount(appeared);
  await act(async () => undefined);
  await act(() => keyboard.show(202, 200));
  expect(hook.result.current.metrics.keyboardVisible).toBe(true);
  expect(appeared).toHaveBeenCalledTimes(1);
  await turn(402, 874);
  motion.mockClear();
  await act(() => keyboard.show(538, 336));
  expect(hook.result.current.metrics.keyboardVisible).toBe(true);
  expect(hook.result.current.metrics.bottomInset).toBe(336);
  expect(hook.result.current.top).toBe(538);
  expect(motion.mock.calls).toEqual([[SHOW]]);
  expect(appeared).toHaveBeenCalledTimes(1);
});

test('a show with the keyboard already up, even a lower one, is a show motion and never a hide: keyboardWillShow is visible', async () => {
  const hook = await mount();
  await act(async () => undefined);
  await act(() => keyboard.show(498, 376));
  motion.mockClear();
  await act(() => keyboard.show(538, 336));
  expect(hook.result.current.metrics.keyboardVisible).toBe(true);
  expect(hook.result.current.metrics.bottomInset).toBe(336);
  expect(motion.mock.calls).toEqual([[SHOW]]);
});
