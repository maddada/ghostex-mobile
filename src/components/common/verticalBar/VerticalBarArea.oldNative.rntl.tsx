/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. An over-the-air update can meet an app binary built before
 * `observeBarLayout` existed: its native module simply has no such function. `VerticalBarArea` must then
 * keep the headers on top and render the app, not throw on launch. The same holds on an iPad, which never
 * has the iPhone Duo's bars and so never observes them.
 */

import { Platform, Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import VerticalBarArea, { canObserveBarLayout, useHeaderPlacement } from './VerticalBarArea';

// The module of an older binary: the events and calls it had, without `observeBarLayout` and
// `stopObservingBarLayout`. The iPad test installs an `observeBarLayout` only to prove it stays unused.
jest.mock('../../../../modules/ghostex-native/src', () => ({
  GhostexNative: { addListener: jest.fn(() => ({ remove: () => undefined })) },
}));
const mockNative = jest.requireMock<{ GhostexNative: Record<string, unknown> }>(
  '../../../../modules/ghostex-native/src',
).GhostexNative;
const mockAddListener = mockNative.addListener as jest.Mock;
const mockObserve = jest.fn();
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('../../../theme/useAppearance', () => ({
  useAppearance: () => ({ background: 'black', foreground: 'white', border: 'gray' }),
}));

function Placement() {
  return <Text>{`placement ${useHeaderPlacement().kind}`}</Text>;
}

function setIsPad(isPad: boolean): void {
  Object.defineProperty(Platform, 'isPad', { configurable: true, get: () => isPad });
}

beforeEach(() => {
  delete mockNative.observeBarLayout;
  mockAddListener.mockClear();
  mockObserve.mockClear();
  setIsPad(false);
});

test('an iPhone binary without observeBarLayout renders the app with the header on top', async () => {
  expect(Platform.OS).toBe('ios');
  expect(mockNative.observeBarLayout).toBeUndefined();
  expect(canObserveBarLayout()).toBe(false);
  await render(
    <VerticalBarArea>
      <Placement />
    </VerticalBarArea>,
  );
  expect(screen.getByText('placement top')).toBeTruthy();
  expect(mockAddListener).not.toHaveBeenCalled();
});

test('an iPad never observes the bars, even with a binary that has the call', async () => {
  mockNative.observeBarLayout = mockObserve;
  setIsPad(true);
  expect(canObserveBarLayout()).toBe(false);
  await render(
    <VerticalBarArea>
      <Placement />
    </VerticalBarArea>,
  );
  expect(screen.getByText('placement top')).toBeTruthy();
  expect(mockObserve).not.toHaveBeenCalled();
  expect(mockAddListener).not.toHaveBeenCalled();
});
