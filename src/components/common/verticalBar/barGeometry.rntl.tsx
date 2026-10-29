/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. What the side bar keeps across launches (`barGeometry.ts`). The
 * keyboard reserve only grows, and what one launch learned is what the next one reads, also when
 * measuring started before the stored geometry was read. A failed read or write of the stored geometry
 * is not silent: it goes to the app log (Logs sheet) and the chrome measures again.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { act } from '@testing-library/react-native';

import { useAppLogStore } from '../../../app/appLog';
import { useBarGeometryStore } from './barGeometry';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const STORAGE_KEY = 'verticalBar.geometry.v1';
const LAYOUT = {
  windowWidth: 466,
  windowHeight: 678,
  safeTop: 0,
  safeLeft: 0,
  safeRight: 84,
  edge: 'trailing' as const,
  sideBar: { x: 395, y: 174, width: 46, height: 470 },
};

const logged = () => useAppLogStore.getState().entries.map((entry) => entry.message);

/** What the next launch reads. */
async function nextLaunchReads(): Promise<unknown> {
  const raw = await AsyncStorage.getItem(STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

beforeEach(async () => {
  jest.restoreAllMocks();
  await AsyncStorage.clear();
  jest.clearAllMocks();
  useAppLogStore.setState({ entries: [] });
  useBarGeometryStore.setState({ hydrated: false, keyboardHeights: {}, layouts: {} });
});

test('a failed read is logged, and the chrome starts from nothing and measures again', async () => {
  jest.spyOn(AsyncStorage, 'getItem').mockRejectedValueOnce(new Error('storage unavailable'));
  await useBarGeometryStore.getState().hydrate();
  expect(useBarGeometryStore.getState()).toMatchObject({ hydrated: true, keyboardHeights: {}, layouts: {} });
  expect(logged()).toEqual(['Reading the stored side bar geometry failed, measuring again: storage unavailable']);
});

test('stored geometry that is not JSON is logged like a failed read', async () => {
  await AsyncStorage.setItem(STORAGE_KEY, '{not json');
  await useBarGeometryStore.getState().hydrate();
  expect(useBarGeometryStore.getState().hydrated).toBe(true);
  expect(logged()).toHaveLength(1);
  expect(logged()[0]).toMatch(/^Reading the stored side bar geometry failed, measuring again: /);
});

test('a failed write is logged, and this launch keeps what it measured', async () => {
  await useBarGeometryStore.getState().hydrate();
  jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
  await act(async () => {
    useBarGeometryStore.getState().recordLayout(LAYOUT);
  });
  expect(useBarGeometryStore.getState().layouts['466x678:trailing']).toEqual(LAYOUT);
  expect(logged()).toEqual(['Saving the side bar geometry failed: disk full']);
});

test('the reserve per window size grows with a taller keyboard and a lower one writes nothing', async () => {
  await useBarGeometryStore.getState().hydrate();
  const write = jest.spyOn(AsyncStorage, 'setItem');
  const { recordKeyboardHeight } = useBarGeometryStore.getState();
  recordKeyboardHeight('466x678', 265);
  recordKeyboardHeight('466x678', 230);
  recordKeyboardHeight('466x678', 265);
  expect(useBarGeometryStore.getState().keyboardHeights).toEqual({ '466x678': 265 });
  expect(write).toHaveBeenCalledTimes(1);
  recordKeyboardHeight('466x678', 300);
  expect(useBarGeometryStore.getState().keyboardHeights).toEqual({ '466x678': 300 });
  expect(write).toHaveBeenCalledTimes(2);
});

test('measured while the stored geometry is read, the next launch still reads the taller height', async () => {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ keyboardHeights: { '466x678': 300 }, layouts: {} }));
  // The stored geometry arrives only after a keyboard and a layout were measured.
  const read = Promise.withResolvers<string | null>();
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  jest.spyOn(AsyncStorage, 'getItem').mockReturnValueOnce(read.promise);
  const write = jest.spyOn(AsyncStorage, 'setItem');
  // Only what the store writes from here on counts (the stored geometry above was written by the test).
  write.mockClear();
  const hydrating = useBarGeometryStore.getState().hydrate();
  useBarGeometryStore.getState().recordKeyboardHeight('466x678', 265);
  useBarGeometryStore.getState().recordLayout(LAYOUT);
  expect(write).not.toHaveBeenCalled();
  read.resolve(stored);
  await hydrating;
  expect(useBarGeometryStore.getState().keyboardHeights).toEqual({ '466x678': 300 });
  expect(await nextLaunchReads()).toEqual({
    keyboardHeights: { '466x678': 300 },
    layouts: { '466x678:trailing': LAYOUT },
  });
});
