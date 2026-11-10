/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. The Settings pages with rows of their own under the app's list fold gap (nothing on
 * the fold in lists; the laptop pose only, `components/common/foldGap.tsx`), measured as `foldGap.rntl.tsx` measures
 * the shared Settings page: Settings › Notifications (its switch rows and the "Blocked in iOS Settings" card),
 * Settings › Live Activity (its preview card), Settings › Licences (its list of components), Settings › Interface
 * (the presets' scroller, Appearance's cards, a mode colour's squares and its custom tint) and its terminal palette
 * picker (its list of palettes). The page's frame comes from the jest preset's `measureInWindow`: the
 * whole 669 x 951 window of the iPhone Duo in the laptop pose, whose fold's band is 455.5-495.5; a list's content
 * height and its scrolls are the platform's events, fired here. Expected, by the laptop-pose decision for lists: a
 * page's scroll view ends 8 pt above the fold's top (447.5), before and after a scroll; the Licences and palette
 * lists, whose rows take their state from the page, run across the fold: the list ends at the fold's top and a copy
 * of it, hidden from accessibility, fills the frame from the fold's bottom, starting where the list ends and
 * following its scroll, and the copy's search field takes no touches. None of a page's own rows carries a gap of its
 * own; flat (inactive division) and in the book pose the page keeps its whole frame and its frame measures nothing.
 * The real pages, shared controls and stores under the real `VerticalBarArea`; stand-ins: navigation, the safe area,
 * storage, the native chrome, expo-notifications and the bundled notices file's native read (it returns the real
 * THIRD_PARTY_NOTICES.md).
 *
 * Not reached here: the scroll views' clipping and native scrolling (the jest preset's scroll view records `scrollTo`
 * and moves nothing) and the device's real frames.
 */

import { readFileSync } from 'node:fs';

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReactNode } from 'react';
import { Dimensions, ScrollView, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';

import type { BarLayout, FoldDivision } from '../../../modules/ghostex-native/src/GhostexNative.types';
import { useBarGeometryStore } from '../../components/common/verticalBar/barGeometry';
import VerticalBarArea from '../../components/common/verticalBar/VerticalBarArea';
import { LicencesCopy, LiveActivityCopy, NotificationsCopy } from '../../copy';
import { useInventoryStore } from '../../inventory/store';
import { useMachinesStore } from '../../machines/store';
import { useAttentionFeedStore } from '../../notifications/feedStore';
import { useSettingsStore } from '../../settings/store';
import { terminalPaletteLabel, terminalPaletteNames } from '../../theme/terminalPalettes';
import LicencesPage from './LicencesPage';
import LiveActivityPage from './LiveActivityPage';
import NotificationsPage from './NotificationsPage';
import TerminalPalettePage from './TerminalPalettePage';
import ThemePage from './ThemePage';

const mockNativeMethods = jest.requireActual<{ default: { measureInWindow: jest.Mock } }>(
  '@react-native/jest-preset/jest/MockNativeMethods',
).default;
let mockBarLayout: BarLayout | null = null;

jest.mock('../../../modules/ghostex-native/src', () => ({
  GhostexNative: {
    addListener: () => ({ remove: () => undefined }),
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
// The Notifications page reads the iOS permission when it comes into view; the tests set it in the store instead.
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ setOptions: () => undefined }),
  useFocusEffect: () => undefined,
  useIsFocused: () => true,
}));
const mockNotices = readFileSync(`${__dirname}/../../../THIRD_PARTY_NOTICES.md`, 'utf8');
jest.mock('../../../THIRD_PARTY_NOTICES.md', () => 1);
jest.mock('expo-asset', () => ({
  Asset: { fromModule: () => ({ downloadAsync: () => Promise.resolve({ localUri: 'file:///notices.md' }) }) },
}));
jest.mock('expo-file-system', () => ({
  File: class {
    text(): Promise<string> {
      return Promise.resolve(mockNotices);
    }
  },
}));

const PORTRAIT = { width: 669, height: 951 };
const LANDSCAPE = { width: 951, height: 669 };
const LAPTOP: FoldDivision = { x: 0, y: 455.5, width: 669, height: 40, active: true };
const FLAT: FoldDivision = { ...LAPTOP, active: false };
const BOOK: FoldDivision = { x: 455.5, y: 0, width: 40, height: 669, active: true };
const FOLD = { top: 455.5, bottom: 495.5 };
/** Where the page's visible part must end in the laptop pose: 8 pt above the fold's top. */
const ABOVE_FOLD = FOLD.top - 8;
const OTHER_POSES: [string, FoldDivision, { width: number; height: number }][] = [
  ['flat', FLAT, PORTRAIT],
  ['book pose', BOOK, LANDSCAPE],
];
/** The window frame `measureInWindow` answers: the whole window. */
let listFrame = { top: 0, height: PORTRAIT.height };
/** The scroll command the jest preset's scroll view records (one function for every scroll view). */
const nativeScrollTo = jest.mocked(ScrollView.prototype.scrollTo);

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

async function advance(): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(50);
  });
}

async function renderPage(
  page: ReactNode,
  division: FoldDivision = LAPTOP,
  window: { width: number; height: number } = PORTRAIT,
): Promise<void> {
  mockBarLayout = barLayout(division, window);
  await act(() => {
    Dimensions.set({ window: { ...window, scale: 3, fontScale: 1 }, screen: { ...window, scale: 3, fontScale: 1 } });
  });
  await render(<VerticalBarArea>{page}</VerticalBarArea>);
  await advance();
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

/** The page's scroll view reports a scroll to `y`. */
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

/** In the laptop pose, at rest and scrolled: the page ends above the fold, so none of `rows` is drawn on it. */
async function expectEndsAboveFold(rows: () => TestInstance[]): Promise<void> {
  const [first] = rows();
  expect(visibleBottom(first)).toBe(ABOVE_FOLD);
  for (const row of rows()) expect(gapAbove(row)).toBe(0);
  await scrollTo(first, 300);
  expect(visibleBottom(rows()[0])).toBe(ABOVE_FOLD);
  for (const row of rows()) expect(gapAbove(row)).toBe(0);
}

/** The scroll view of the list's copy below the fold's band (in the list's frame, after the list), or null. */
function copyOf(node: TestInstance): TestInstance | null {
  const list = scrollViewOf(node);
  for (const child of list.parent?.children ?? []) {
    if (typeof child === 'string' || child === list) continue;
    const [copy] = child.queryAll((candidate) => candidate.type === 'RCTScrollView');
    if (copy !== undefined) return copy;
  }
  return null;
}

/**
 * In the laptop pose, at rest and scrolled: the list ends at the fold's top and its copy, hidden from accessibility,
 * fills the frame from the fold's bottom at the offset where the list ends and follows its scroll, so its rows
 * continue below the band and none of `rows` is drawn on it.
 */
async function expectRunsAcross(rows: () => TestInstance[]): Promise<void> {
  const [first] = rows();
  const upper = FOLD.top - listFrame.top;
  nativeScrollTo.mockClear();
  await fireEvent(scrollViewOf(first), 'contentSizeChange', 640, 1600);
  await advance();
  expect(visibleBottom(first)).toBe(FOLD.top);
  const copy = copyOf(first);
  if (copy === null) throw new Error('no copy below the fold');
  const place = copy.parent;
  expect(place?.props).toMatchObject({
    accessibilityElementsHidden: true,
    importantForAccessibility: 'no-hide-descendants',
  });
  const placed = StyleSheet.flatten(place?.props.style);
  expect(listFrame.top + Number(placed?.top)).toBe(FOLD.bottom);
  expect(listFrame.top + Number(placed?.top) + Number(placed?.height)).toBe(listFrame.top + listFrame.height);
  expect(nativeScrollTo).toHaveBeenLastCalledWith({ animated: false, y: upper });
  for (const row of rows()) expect(gapAbove(row)).toBe(0);
  await scrollTo(first, 300);
  expect(nativeScrollTo).toHaveBeenLastCalledWith({ animated: false, y: 300 + upper });
  expect(visibleBottom(rows()[0])).toBe(FOLD.top);
  for (const row of rows()) expect(gapAbove(row)).toBe(0);
}

/**
 * How many views other than scroll views were measured: the fold frame is a plain View. The pages' keyboard-aware
 * scroll view measures itself for its own keyboard handling, in every pose.
 */
function measuredViews(): number {
  const scrollView = (context: unknown): boolean => {
    if (typeof context !== 'object' || context === null || !('props' in context)) return false;
    const { props } = context;
    return typeof props === 'object' && props !== null && 'contentContainerStyle' in props;
  };
  return mockNativeMethods.measureInWindow.mock.contexts.filter((context: unknown) => !scrollView(context)).length;
}

beforeEach(async () => {
  jest.useFakeTimers();
  listFrame = { top: 0, height: PORTRAIT.height };
  nativeScrollTo.mockClear();
  mockNativeMethods.measureInWindow.mockImplementation((onFrame: (...frame: number[]) => void) =>
    onFrame(0, listFrame.top, PORTRAIT.width, listFrame.height),
  );
  await AsyncStorage.clear();
  useBarGeometryStore.setState({ hydrated: false, keyboardHeights: {}, layouts: {} });
  await useBarGeometryStore.getState().hydrate();
});

afterEach(() => {
  mockNativeMethods.measureInWindow.mockReset();
  jest.useRealTimers();
});

describe('Settings › Notifications (its switch rows and the blocked card)', () => {
  const copy = NotificationsCopy.settings;
  const SWITCHES = [copy.master, copy.finished, copy.waiting, copy.error];

  function seed(permission: 'granted' | 'denied'): void {
    useSettingsStore.setState((state) => ({
      settings: {
        ...state.settings,
        notifications: { enabled: true, finished: true, waiting: true, error: true, askedAt: new Date().toISOString() },
      },
    }));
    // The measured caption describes a running app: the saved push record has loaded with no accepted computers.
    useAttentionFeedStore.setState({ permission, pushComputers: [] });
  }
  const switchRows = () => SWITCHES.map((name) => screen.getByRole('switch', { name }));

  test('laptop pose: the page ends above the fold, also scrolled, and no switch row carries a gap', async () => {
    seed('granted');
    await renderPage(<NotificationsPage />);
    await expectEndsAboveFold(switchRows);
  });

  test('laptop pose: with the blocked card the page ends above the fold, also scrolled, and the card carries no gap', async () => {
    seed('denied');
    await renderPage(<NotificationsPage />);
    await expectEndsAboveFold(() => [
      screen.getByText(copy.blockedTitle),
      screen.getByRole('button', { name: copy.openSettings }),
      ...switchRows(),
    ]);
  });

  test.each(OTHER_POSES)('%s: the page keeps its whole frame and its frame measures nothing', async (_pose, division, window) => {
    seed('denied');
    listFrame = { top: 0, height: window.height };
    await renderPage(<NotificationsPage />, division, window);
    expect(visibleBottom(screen.getByText(copy.blockedTitle))).toBe(window.height);
    for (const row of switchRows()) expect(gapAbove(row)).toBe(0);
    expect(measuredViews()).toBe(0);
  });
});

describe('Settings › Live Activity (its preview card)', () => {
  beforeEach(() => {
    useSettingsStore.setState((state) => ({ settings: { ...state.settings, liveActivityEnabled: true } }));
    useMachinesStore.setState({ machines: [] });
    useInventoryStore.setState({ inventoriesByMachineId: {} });
  });
  const units = () => [
    screen.getByText(LiveActivityCopy.previewTitle),
    screen.getByLabelText(LiveActivityCopy.previewLabel),
  ];

  test('laptop pose: the page ends above the fold, also scrolled, and the preview carries no gap', async () => {
    await renderPage(<LiveActivityPage />);
    await expectEndsAboveFold(units);
  });

  test.each(OTHER_POSES)('%s: the page keeps its whole frame and its frame measures nothing', async (_pose, division, window) => {
    listFrame = { top: 0, height: window.height };
    await renderPage(<LiveActivityPage />, division, window);
    expect(visibleBottom(screen.getByLabelText(LiveActivityCopy.previewLabel))).toBe(window.height);
    expect(gapAbove(screen.getByLabelText(LiveActivityCopy.previewLabel))).toBe(0);
    expect(measuredViews()).toBe(0);
  });
});

describe('Settings › Licences (its list of components)', () => {
  const units = () => [screen.getByText('FreeType'), screen.getByText('Ghostty')];

  test('laptop pose: the list runs across the fold, also scrolled, and no component row carries a gap', async () => {
    await renderPage(<LicencesPage />);
    await expectRunsAcross(units);
  });

  test("laptop pose: the copy's search field, hidden from accessibility, takes no touches; the list's does", async () => {
    await renderPage(<LicencesPage />);
    await fireEvent(scrollViewOf(units()[0]), 'contentSizeChange', 640, 1600);
    await advance();
    expect(copyOf(units()[0])).not.toBeNull();
    /** The nearest view up to the scroll view that takes no touches, or null. */
    const untouchable = (field: TestInstance | undefined): TestInstance | null => {
      for (
        let node: TestInstance | null = field ?? null;
        node !== null && node.type !== 'RCTScrollView';
        node = node.parent
      ) {
        if (StyleSheet.flatten(node.props.style)?.pointerEvents === 'none') return node;
      }
      return null;
    };
    const shown = screen.getByLabelText(LicencesCopy.searchPlaceholder);
    const fields = screen.getAllByLabelText(LicencesCopy.searchPlaceholder, { includeHiddenElements: true });
    expect(fields).toHaveLength(2);
    expect(untouchable(shown)).toBeNull();
    expect(untouchable(fields.find((field) => field !== shown))).not.toBeNull();
    expect(screen.getAllByText('Ghostty')).toHaveLength(1);
  });

  test.each(OTHER_POSES)('%s: the list keeps its whole frame and its frame measures nothing', async (_pose, division, window) => {
    listFrame = { top: 0, height: window.height };
    await renderPage(<LicencesPage />, division, window);
    expect(visibleBottom(screen.getByText('Ghostty'))).toBe(window.height);
    for (const row of units()) expect(gapAbove(row)).toBe(0);
    expect(measuredViews()).toBe(0);
  });
});

describe('Settings › Interface › Terminal palette (its list of palettes)', () => {
  const rows = () => [2, 3].map((index) => screen.getByRole('radio', { name: terminalPaletteLabel(terminalPaletteNames()[index]!) }));

  test('laptop pose: the list runs across the fold, also scrolled, and no palette row carries a gap', async () => {
    await renderPage(<TerminalPalettePage dark />);
    await expectRunsAcross(rows);
  });

  test.each(OTHER_POSES)('%s: the list keeps its whole frame and its frame measures nothing', async (_pose, division, window) => {
    listFrame = { top: 0, height: window.height };
    await renderPage(<TerminalPalettePage dark />, division, window);
    expect(visibleBottom(rows()[0]!)).toBe(window.height);
    for (const row of rows()) expect(gapAbove(row)).toBe(0);
    expect(measuredViews()).toBe(0);
  });
});

describe('Settings › Interface (its presets, Appearance and mode colour blocks)', () => {
  const initialSettings = useSettingsStore.getState().settings;
  afterEach(async () => {
    await act(() => {
      useSettingsStore.setState({ settings: initialSettings });
    });
  });
  // The presets' scroller is a horizontal scroll view of its own: measured from the view around it in the page.
  const units = () => [
    ...['System appearance', 'Light appearance', 'Dark appearance'].map((name) => screen.getByRole('radio', { name })),
    screen.getByRole('radio', { name: 'Custom, dark mode colour' }),
    screen.getByLabelText('Presets').parent!,
  ];

  test("laptop pose: the page ends above the fold, also scrolled, and neither the presets' scroller, Appearance's cards nor a mode colour's squares carry a gap", async () => {
    await renderPage(<ThemePage />);
    await expectEndsAboveFold(units);
  });

  test('laptop pose: with the custom tint field the page ends above the fold, also scrolled, and the field carries no gap', async () => {
    useSettingsStore.setState((state) => ({ settings: { ...state.settings, darkThemePreset: 'custom' } }));
    await renderPage(<ThemePage />);
    await expectEndsAboveFold(() => [screen.getByLabelText('Custom tint, hex colour'), ...units()]);
  });

  test.each(OTHER_POSES)('%s: the page keeps its whole frame and its frame measures nothing', async (_pose, division, window) => {
    listFrame = { top: 0, height: window.height };
    await renderPage(<ThemePage />, division, window);
    expect(visibleBottom(screen.getByRole('radio', { name: 'Light appearance' }))).toBe(window.height);
    for (const row of units()) expect(gapAbove(row)).toBe(0);
    expect(measuredViews()).toBe(0);
  });
});
