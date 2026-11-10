/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. Both bottom sheets, the generic one and the chat composer's, follow a
 * downward drag on their grabber and close when it goes far enough or ends in a quick flick; a shorter,
 * slower drag springs the panel back and keeps the sheet open, and so does a long one whose owner keeps
 * the sheet open (busy). The grabber's touch area is at least 44 pt tall, reaching above the panel,
 * where a tap still closes the sheet as the backdrop's tap does.
 */

import { useState, type ComponentType, type ReactNode } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { Sheet } from '../../chat/native/composer/Sheet';
import BottomSheet from './BottomSheet';
import { GRABBER_CLOSE_DISTANCE } from './useGrabberDrag';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('../../../modules/ghostex-native/src', () => ({ GhostexNative: {} }));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

type SheetUnderTest = ComponentType<{ visible: boolean; onClose: () => void; children: ReactNode }>;

/**
 * Puts one finger on the grabber's touch area, `locationY` from its top (negative: above the panel, in
 * the area's reach). `move` drags it to `dy` below where it started over `ms`, `release` lifts it.
 */
async function grabGrabber(locationY = 5) {
  const grabber = screen.getByTestId('sheet-grabber');
  let time = 10_000;
  let pageY = 0;
  const touch = (nextY: number, active: boolean, ms: number) => {
    const previousY = pageY;
    const previousTime = time;
    pageY = nextY;
    time += ms;
    return {
      nativeEvent: {
        touches: active ? [{}] : [],
        changedTouches: [{}],
        pageX: 0,
        pageY,
        locationY: locationY + pageY,
        timestamp: time,
      },
      touchHistory: {
        numberActiveTouches: active ? 1 : 0,
        indexOfSingleActiveTouch: 0,
        mostRecentTimeStamp: time,
        touchBank: [
          {
            touchActive: active,
            startPageX: 0,
            startPageY: 0,
            startTimeStamp: 10_000,
            currentPageX: 0,
            currentPageY: pageY,
            currentTimeStamp: time,
            previousPageX: 0,
            previousPageY: previousY,
            previousTimeStamp: previousTime,
          },
        ],
      },
    };
  };
  expect(grabber.props.onStartShouldSetResponder(touch(0, true, 0))).toBe(true);
  await fireEvent(grabber, 'responderGrant', touch(0, true, 0));
  return {
    move: (dy: number, ms: number) => fireEvent(grabber, 'responderMove', touch(dy, true, ms)),
    release: () => fireEvent(grabber, 'responderRelease', touch(pageY, false, 16)),
  };
}

/** A deliberate drag to `dy`: two steps of 200 ms each, so the finger is slow when it lets go. */
async function drag(dy: number) {
  const finger = await grabGrabber();
  await finger.move(dy / 2, 200);
  await finger.move(dy, 200);
  await finger.release();
}

function panelOffset(): number {
  const { transform } = StyleSheet.flatten(screen.getByTestId('sheet-panel').props.style) as {
    transform: { translateY: number }[];
  };
  return transform[0]!.translateY;
}

/** The sheet as a screen holds it: open until its `onClose` runs, unless the screen is busy; Open shows it again. */
function Owner({ Component, onClose, busy }: { Component: SheetUnderTest; onClose: () => void; busy: boolean }) {
  const [visible, setVisible] = useState(true);
  return (
    <>
      <Pressable onPress={() => setVisible(true)}>
        <Text>Open</Text>
      </Pressable>
      <Component
        visible={visible}
        onClose={() => {
          onClose();
          if (!busy) setVisible(false);
        }}
      >
        <Text>Inside</Text>
      </Component>
    </>
  );
}

/** Lets the sheet finish opening (both slide up once their panel is measured); its panel sits in place. */
async function letOpen() {
  await fireEvent(screen.getByTestId('sheet-panel'), 'layout', { nativeEvent: { layout: { height: 300 } } });
  await act(() => jest.advanceTimersByTime(1000));
  expect(panelOffset()).toBe(0);
}

async function openSheet(Component: SheetUnderTest, { busy = false } = {}) {
  const onClose = jest.fn();
  await render(<Owner Component={Component} onClose={onClose} busy={busy} />);
  await letOpen();
  return onClose;
}

beforeEach(() => {
  jest.useFakeTimers();
  // Native-driven animations do not run under Jest; the same animations run on the JS driver here, so
  // the panel's position can be read.
  const { timing, spring } = Animated;
  jest
    .spyOn(Animated, 'timing')
    .mockImplementation((value, config) => timing(value, { ...config, useNativeDriver: false }));
  jest
    .spyOn(Animated, 'spring')
    .mockImplementation((value, config) => spring(value, { ...config, useNativeDriver: false }));
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe.each<[string, SheetUnderTest]>([
  ['the generic bottom sheet', BottomSheet],
  ["the chat composer's sheet", Sheet],
])('%s', (_name, Component) => {
  test('the panel follows the grabber down, and not up above where it sits', async () => {
    await openSheet(Component);
    const finger = await grabGrabber();
    await finger.move(30, 200);
    expect(panelOffset()).toBe(30);
    await finger.move(-20, 200);
    expect(panelOffset()).toBe(0);
  });

  test("the grabber's touch area is at least 44 pt tall, reaching above the panel", async () => {
    await openSheet(Component);
    const grabber = screen.getByTestId('sheet-grabber');
    const strip = StyleSheet.flatten(grabber.props.style) as {
      paddingTop?: number;
      paddingBottom?: number;
      paddingVertical?: number;
    };
    const pill = StyleSheet.flatten((grabber.children[0] as typeof grabber).props.style) as { height: number };
    const stripHeight =
      (strip.paddingTop ?? strip.paddingVertical ?? 0) +
      pill.height +
      (strip.paddingBottom ?? strip.paddingVertical ?? 0);
    const { top = 0, bottom = 0 } = (grabber.props.hitSlop ?? {}) as { top?: number; bottom?: number };
    expect(bottom).toBe(0);
    expect(stripHeight + top).toBeGreaterThanOrEqual(44);
  });

  test('a quick flick down closes the sheet even short of the distance', async () => {
    const onClose = await openSheet(Component);
    const finger = await grabGrabber();
    await finger.move(10, 200);
    await finger.move(40, 16);
    await finger.release();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("a tap just above the panel, in the grabber's reach, closes the sheet as the backdrop's tap does", async () => {
    const onClose = await openSheet(Component);
    await (await grabGrabber(-10)).release();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test('a tap on the grabber itself keeps the sheet open', async () => {
    const onClose = await openSheet(Component);
    await (await grabGrabber(5)).release();
    expect(onClose).not.toHaveBeenCalled();
    expect(panelOffset()).toBe(0);
  });

  test('dragging the grabber down far enough closes the sheet', async () => {
    const onClose = await openSheet(Component);
    await drag(GRABBER_CLOSE_DISTANCE);
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(() => jest.advanceTimersByTime(1000));
    expect(screen.queryByText('Inside')).toBeNull();
  });

  test('a drag short of the distance springs the panel back and keeps the sheet open', async () => {
    const onClose = await openSheet(Component);
    await drag(GRABBER_CLOSE_DISTANCE - 1);
    expect(onClose).not.toHaveBeenCalled();
    expect(panelOffset()).toBeGreaterThan(0);
    await act(() => jest.advanceTimersByTime(1000));
    expect(panelOffset()).toBe(0);
    expect(screen.getByText('Inside')).toBeTruthy();
  });

  test('a long drag on a sheet its owner keeps open (busy) springs back', async () => {
    const onClose = await openSheet(Component, { busy: true });
    await drag(GRABBER_CLOSE_DISTANCE + 40);
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(() => jest.advanceTimersByTime(1000));
    expect(panelOffset()).toBe(0);
    expect(screen.getByText('Inside')).toBeTruthy();
  });

  test('opened again after a drag closed it, the panel sits in place', async () => {
    await openSheet(Component);
    await drag(GRABBER_CLOSE_DISTANCE + 20);
    await act(() => jest.advanceTimersByTime(1000));
    await fireEvent.press(screen.getByText('Open'));
    await letOpen();
  });
});
