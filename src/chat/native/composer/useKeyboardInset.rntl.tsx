/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. REQ-NFR-001 AC1 (the chat composer stays above the keyboard as before). The
 * chat composer's lift follows the keyboard as a synchronous consumer of the
 * shared keyboard store (owner 2026-10-28, "Ja, in S1"; recordings of the installed build: the composer jumped
 * before the keyboard on show and before its sibling row on hide): the lift changes in the render the store
 * publishes in, the animation request is the store's single one (show = spring 1.8 / 580 ms, hide = ease-out /
 * 250 ms; keyboardMotion.ts), the composer registers no keyboard listener and requests none; FL-A11Y-05: nothing
 * with Reduce Motion on. Geometry: padding = lift + 8, else the larger of the safe area's bottom (34 here) and 12.
 * Frames: window 402x874, keyboard top 538, height 336.
 */

import { AccessibilityInfo, Dimensions, DeviceEventEmitter, LayoutAnimation, Platform } from 'react-native';
import { act, render, renderHook } from '@testing-library/react-native';

import { keyboardFixture } from '../../../components/common/keyboard/keyboardEventFixtures';
import { KeyboardLiftedView } from './KeyboardLiftedView';
import { useKeyboardInset } from './useKeyboardInset';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));

let reduceMotion = false;
const SHOW_MOTION = { duration: 580, update: { type: 'spring', springDamping: 1.8 } };
const HIDE_MOTION = { duration: 250, update: { type: 'easeOut' } };

beforeEach(async () => {
  Platform.OS = 'ios';
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(reduceMotion));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation((() => ({ remove: () => undefined })) as never);
  await act(() => {
    Dimensions.set({
      window: { width: 402, height: 874, scale: 3, fontScale: 1 },
      screen: { width: 402, height: 874, scale: 3, fontScale: 1 },
    });
  });
});

afterEach(async () => {
  // The keyboard store is app-wide module state: every test leaves the keyboard away.
  await act(() => keyboard.hide(0));
  reduceMotion = false;
  jest.restoreAllMocks();
});

/** The notifications iOS posts, with their start and end frames (keyboardEventFixtures.ts). */
const keyboard = keyboardFixture();
const show = (top: number, height: number, duration = 250): void => keyboard.show(top, height, duration);
const hide = (duration = 250): void => keyboard.hide(duration);

/** A composer frame that records the padding it was rendered with, render by render. */
async function mountComposer() {
  const paddings: number[] = [];
  const requestedAtPadding: number[] = [];
  const configureNext = jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => {
    requestedAtPadding.push(paddings[paddings.length - 1]);
  });
  await render(
    <KeyboardLiftedView>
      {(bottom) => {
        paddings.push(bottom);
        return null;
      }}
    </KeyboardLiftedView>,
  );
  await act(async () => undefined);
  return { paddings, requestedAtPadding, configureNext };
}

describe("the chat composer lifts in the store's commit with the store's one motion", () => {
  test('a show: the padding is the lift + 8 in the render after the store publishes, one request, the show motion, asked before that render', async () => {
    const { paddings, requestedAtPadding, configureNext } = await mountComposer();
    expect(paddings[paddings.length - 1]).toBe(34);
    const before = paddings.length;
    await act(() => show(538, 336));
    expect(paddings.slice(before)).toEqual([344]);
    expect(configureNext.mock.calls).toEqual([[SHOW_MOTION]]);
    // Asked while the composer still stood at the home-indicator padding: the commit after it moves it.
    expect(requestedAtPadding).toEqual([34]);
  });

  test('a hide: the padding falls back to the home inset in one render, one request, the hide motion', async () => {
    const { paddings, configureNext } = await mountComposer();
    await act(() => show(538, 336));
    configureNext.mockClear();
    const before = paddings.length;
    await act(() => hide());
    expect(paddings.slice(before)).toEqual([34]);
    expect(configureNext.mock.calls).toEqual([[HIDE_MOTION]]);
  });

  test('a taller keyboard while up lifts further in one render, with one show motion', async () => {
    const { paddings, configureNext } = await mountComposer();
    await act(() => show(538, 336));
    configureNext.mockClear();
    const before = paddings.length;
    await act(() => show(498, 376));
    expect(paddings.slice(before)).toEqual([384]);
    expect(configureNext.mock.calls).toEqual([[SHOW_MOTION]]);
  });

  test('the composer registers no keyboard listener of its own', async () => {
    await mountComposer();
    expect(DeviceEventEmitter.listenerCount('keyboardWillShow')).toBe(1);
    expect(DeviceEventEmitter.listenerCount('keyboardWillChangeFrame')).toBe(1);
    expect(DeviceEventEmitter.listenerCount('keyboardWillHide')).toBe(1);
  });

  test('with Reduce Motion on nothing is requested, the padding is the same', async () => {
    reduceMotion = true;
    const { paddings, configureNext } = await mountComposer();
    await act(() => show(538, 336));
    expect(paddings[paddings.length - 1]).toBe(344);
    expect(configureNext).not.toHaveBeenCalled();
  });

  test('an event without a duration requests nothing, the padding is the same', async () => {
    const { paddings, configureNext } = await mountComposer();
    await act(() => show(538, 336, 0));
    expect(paddings[paddings.length - 1]).toBe(344);
    expect(configureNext).not.toHaveBeenCalled();
  });
});

describe('the lift is the cached resting bottom edge less the keyboard top', () => {
  const anchorWithBottom = (bottom: number) => ({
    current: {
      measureInWindow: (callback: (x: number, y: number, w: number, h: number) => void) =>
        callback(0, bottom - 100, 402, 100),
    },
  });

  test('a view that ends 74 pt above the window bottom (a tab bar) is lifted 74 pt less: 262', async () => {
    const hook = await renderHook(() => useKeyboardInset(anchorWithBottom(800) as never));
    await act(async () => undefined);
    await act(() => show(538, 336));
    expect(hook.result.current.inset).toBe(262);
  });

  test('before any measurement the window bottom stands in: 336', async () => {
    const hook = await renderHook(() => useKeyboardInset({ current: null }));
    await act(() => show(538, 336));
    expect(hook.result.current.inset).toBe(336);
  });

  test('a keyboard that does not reach the view lifts nothing', async () => {
    const hook = await renderHook(() => useKeyboardInset(anchorWithBottom(500) as never));
    await act(async () => undefined);
    await act(() => show(538, 336));
    expect(hook.result.current.inset).toBe(0);
  });
});
