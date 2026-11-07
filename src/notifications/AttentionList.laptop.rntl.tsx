/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. The attention list (`AttentionList`) under the app's list fold gap (nothing on the
 * fold in lists; the laptop pose only, `components/common/foldGap.tsx`), measured as `foldGap.rntl.tsx` measures the
 * Settings, Sessions and work-link lists: the list's frame comes from the jest preset's `measureInWindow`, the whole
 * 669 x 951 window of the iPhone Duo in the laptop pose, whose fold's band is 455.5-495.5. Expected: the list's scroll
 * view ends 8 pt above the fold's top (447.5), before and after a scroll, with rows, section titles, a computer's notice
 * or the empty state, and none of them carries a gap of its own; flat (inactive division) and in the book pose the
 * list keeps its whole frame and nothing is measured. An open row menu stays at its row while the device folds into
 * the laptop pose, because the gap moves no row. The real list, row model and stores under the real
 * `VerticalBarArea`; stand-ins: the native chrome, expo-notifications, storage, the safe area and the computer's feed
 * endpoint.
 *
 * Not reached here: the scroll view's clipping of its rows (the platform's) and the device's real frames.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Dimensions, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';

import type { BarLayout, FoldDivision } from '../../modules/ghostex-native/src/GhostexNative.types';
import { useBarGeometryStore } from '../components/common/verticalBar/barGeometry';
import VerticalBarArea from '../components/common/verticalBar/VerticalBarArea';
import { NotificationsCopy } from '../copy';
import { useInventoryStore } from '../inventory/store';
import { machineDisplayLabel, useMachinesStore, type MachineRecord } from '../machines/store';
import { useSettingsStore } from '../settings/store';
import AttentionList from './AttentionList';
import type { FeedRow } from './feedContract';
import { useAttentionFeedStore } from './feedStore';

const mockNativeMethods = jest.requireActual<{ default: { measureInWindow: jest.Mock } }>(
  '@react-native/jest-preset/jest/MockNativeMethods',
).default;
let mockBarLayout: BarLayout | null = null;
/** The native bar layout listener: a later report is the device folding or unfolding with the list open. */
let mockReport: ((layout: BarLayout) => void) | undefined;

jest.mock('../../modules/ghostex-native/src', () => ({
  GhostexNative: {
    addListener: (name: string, listener: (layout: BarLayout) => void) => {
      if (name === 'onBarLayoutChange') mockReport = listener;
      return { remove: () => undefined };
    },
    observeBarLayout: () => Promise.resolve({ id: 1, layout: mockBarLayout }),
    stopObservingBarLayout: () => Promise.resolve(),
  },
}));
jest.mock('expo-notifications', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { useSafeAreaInsets: () => ({ top: 80, bottom: 20, left: 0, right: 0 }), SafeAreaView: View };
});
jest.mock('./feedStore', () => ({
  ...jest.requireActual('./feedStore'),
  updateAttentionFeed: jest.fn(() => Promise.resolve(true)),
  refreshAttentionFeeds: jest.fn(() => Promise.resolve()),
}));

const PORTRAIT = { width: 669, height: 951 };
const LANDSCAPE = { width: 951, height: 669 };
const LAPTOP: FoldDivision = { x: 0, y: 455.5, width: 669, height: 40, active: true };
const FLAT: FoldDivision = { ...LAPTOP, active: false };
const BOOK: FoldDivision = { x: 455.5, y: 0, width: 40, height: 669, active: true };
const FOLD = { top: 455.5, bottom: 495.5 };
/** Where the list's visible part must end in the laptop pose: 8 pt above the fold's top. */
const ABOVE_FOLD = FOLD.top - 8;
const OTHER_POSES: [string, FoldDivision, { width: number; height: number }][] = [
  ['flat', FLAT, PORTRAIT],
  ['book pose', BOOK, LANDSCAPE],
];

const MACHINE: MachineRecord = {
  id: 'm1',
  name: 'Mac mini',
  host: 'mac-mini.local',
  username: 'owner',
  port: 22,
  savePassword: false,
  lastConnectedAt: null,
};
const OFFLINE: MachineRecord = { ...MACHINE, id: 'm2', name: 'MacBook', host: 'macbook.local' };

/**
 * Ten unread finished rows of ten sessions, newest first: ten rows under Done, below Needs you's "Nothing needs you".
 * Each session's id is its row's, so a row's test id names both.
 */
const FEED: FeedRow[] = Array.from({ length: 10 }, (_, index) => ({
  id: `n${index}`,
  projectId: 'p1',
  sessionId: `n${index}`,
  kind: 'finished',
  title: '',
  subtitle: 'ghostex',
  agentName: 'claude',
  createdAt: new Date(Date.now() - (index + 1) * 60_000).toISOString(),
  read: false,
}));
const IDS = FEED.map((row) => row.id);

/** The window frame `measureInWindow` answers for the list: the whole window unless a test moves it. */
let listFrame = { top: 0, height: PORTRAIT.height };
/** A row's window frame by its id (what a long press measures), 44 pt tall, 8 pt apart from 120. */
const rowTop = (id: string) => 120 + IDS.indexOf(id) * 52;

function barLayout(division: FoldDivision, window: { width: number; height: number }): BarLayout {
  return {
    windowWidth: window.width,
    windowHeight: window.height,
    safeTop: 80,
    safeLeft: 0,
    safeRight: 0,
    marginTop: 88,
    topBar: { x: 0, y: 26, width: 466, height: 44 },
    divisions: [division],
  };
}

const row = (id: string) => screen.getByTestId(`attention-row-${id}`);
const title = (name: string) => screen.getByRole('header', { name });

async function advance(): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(50);
  });
}

async function renderList(
  division: FoldDivision = LAPTOP,
  window: { width: number; height: number } = PORTRAIT,
): Promise<void> {
  mockBarLayout = barLayout(division, window);
  await act(() => {
    Dimensions.set({ window: { ...window, scale: 3, fontScale: 1 }, screen: { ...window, scale: 3, fontScale: 1 } });
  });
  await render(
    <VerticalBarArea>
      <AttentionList onOpenSession={() => undefined} />
    </VerticalBarArea>,
  );
  await advance();
}

/** The device folds into or out of a pose with the list open. */
async function reportPose(division: FoldDivision): Promise<void> {
  await act(async () => {
    mockReport?.(barLayout(division, PORTRAIT));
    await jest.advanceTimersByTimeAsync(50);
  });
}

/** The scroll view `node` scrolls in. */
function scrollViewOf(node: TestInstance): TestInstance {
  let current: TestInstance | null = node;
  while (current !== null && current.type !== 'RCTScrollView') current = current.parent;
  if (current === null) throw new Error('the node is in no scroll view');
  return current;
}

/**
 * The window y where the scroll view holding `node` ends: its frame's bottom less the room the frame keeps below it
 * (the scroll view clips its rows there).
 */
function visibleBottom(node: TestInstance): number {
  const frame = scrollViewOf(node).parent;
  const padding = frame === null ? undefined : StyleSheet.flatten(frame.props.style)?.paddingBottom;
  return listFrame.top + listFrame.height - (typeof padding === 'number' ? padding : 0);
}

/** The list's scroll view reports a scroll to `y`. */
async function scrollTo(node: TestInstance, y: number): Promise<void> {
  await fireEvent.scroll(scrollViewOf(node), {
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { width: 640, height: 1600 },
      layoutMeasurement: { width: 640, height: ABOVE_FOLD },
    },
  });
  await advance();
}

/** A top margin of fold-gap size (the band's 40 pt or more) on `node` or a view around it inside its scroll view. */
function gapAbove(node: TestInstance): number {
  for (let current: TestInstance | null = node; current !== null; current = current.parent) {
    if (current.type === 'RCTScrollView') return 0;
    const marginTop = StyleSheet.flatten(current.props.style)?.marginTop;
    if (typeof marginTop === 'number' && marginTop >= 40) return marginTop;
  }
  return 0;
}

/** In the laptop pose, at rest and scrolled: the list ends above the fold, and none of `units` carries a gap. */
async function expectEndsAboveFold(units: () => TestInstance[]): Promise<void> {
  const [first] = units();
  expect(visibleBottom(first)).toBe(ABOVE_FOLD);
  for (const unit of units()) expect(gapAbove(unit)).toBe(0);
  await scrollTo(first, 300);
  expect(visibleBottom(units()[0])).toBe(ABOVE_FOLD);
  for (const unit of units()) expect(gapAbove(unit)).toBe(0);
}

/** The window top of `id`'s copy lifted above the dimmed screen (the one button with its label and a top). */
function liftedTop(id: string): unknown {
  const tops = screen
    .getAllByRole('button', { name: row(id).props.accessibilityLabel })
    .map((node) => StyleSheet.flatten(node.props.style)?.top)
    .filter((top) => top !== undefined);
  expect(tops).toHaveLength(1);
  return tops[0];
}

const rowsAndTitles = () => [
  ...IDS.map(row),
  title(NotificationsCopy.section.needsYou),
  title(NotificationsCopy.section.done),
];

beforeEach(async () => {
  jest.useFakeTimers();
  listFrame = { top: 0, height: PORTRAIT.height };
  mockNativeMethods.measureInWindow.mockImplementation(function (
    this: { props: { testID?: unknown } },
    onFrame: (...frame: number[]) => void,
  ) {
    const id = typeof this.props.testID === 'string' ? this.props.testID.replace('attention-row-', '') : '';
    if (IDS.includes(id)) onFrame(12, rowTop(id), 640, 44);
    else onFrame(0, listFrame.top, PORTRAIT.width, listFrame.height);
  });
  await AsyncStorage.clear();
  useBarGeometryStore.setState({ hydrated: false, keyboardHeights: {}, layouts: {} });
  await useBarGeometryStore.getState().hydrate();
  // The stored settings (none here) are loaded, as the app does before Done and Failed rows show.
  useSettingsStore.setState({ hydrated: false });
  await useSettingsStore.getState().hydrate();
  useMachinesStore.setState({ machines: [MACHINE] });
  useInventoryStore.setState({ inventoriesByMachineId: {} });
  useAttentionFeedStore.setState({ feeds: { m1: { status: 'ready', rows: FEED } }, permission: 'granted' });
});

afterEach(() => {
  mockNativeMethods.measureInWindow.mockReset();
  jest.useRealTimers();
});

describe('the attention list', () => {
  test('laptop pose: the list ends above the fold, also scrolled, and no row or section title carries a gap', async () => {
    await renderList();
    await expectEndsAboveFold(rowsAndTitles);
  });

  test("laptop pose: with a computer's notice the list ends above the fold, also scrolled", async () => {
    useMachinesStore.setState({ machines: [MACHINE, OFFLINE] });
    useAttentionFeedStore.setState({
      feeds: { m1: { status: 'ready', rows: FEED }, m2: { status: 'unreachable', rows: [] } },
      permission: 'granted',
    });
    const notice = NotificationsCopy.offline(machineDisplayLabel(OFFLINE));
    await renderList();
    await expectEndsAboveFold(() => [screen.getByText(notice), ...rowsAndTitles()]);
  });

  test('laptop pose: the empty list ends above the fold, so its message is not drawn on it', async () => {
    useAttentionFeedStore.setState({ feeds: { m1: { status: 'ready', rows: [] } }, permission: 'granted' });
    await renderList();
    await expectEndsAboveFold(() => [screen.getByText(NotificationsCopy.emptyTitle)]);
  });

  test.each(OTHER_POSES)('%s: the list keeps its whole frame and nothing is measured', async (_pose, division, window) => {
    listFrame = { top: 0, height: window.height };
    await renderList(division, window);
    expect(visibleBottom(row('n0'))).toBe(window.height);
    for (const unit of rowsAndTitles()) expect(gapAbove(unit)).toBe(0);
    expect(mockNativeMethods.measureInWindow).not.toHaveBeenCalled();
  });

  test('leaving the laptop pose gives the list its whole frame, coming back ends it above the fold', async () => {
    await renderList();
    expect(visibleBottom(row('n0'))).toBe(ABOVE_FOLD);
    await reportPose(FLAT);
    expect(visibleBottom(row('n0'))).toBe(PORTRAIT.height);
    await reportPose(LAPTOP);
    expect(visibleBottom(row('n0'))).toBe(ABOVE_FOLD);
  });
});

describe('an open row menu while the device folds', () => {
  test('the lifted row stays at its row: folding into the laptop pose moves no row', async () => {
    await renderList(FLAT);
    await fireEvent(row('n6'), 'longPress');
    expect(liftedTop('n6')).toBe(rowTop('n6'));
    await reportPose(LAPTOP);
    expect(visibleBottom(row('n6'))).toBe(ABOVE_FOLD);
    expect(gapAbove(row('n6'))).toBe(0);
    expect(liftedTop('n6')).toBe(rowTop('n6'));
  });
});
