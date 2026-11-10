/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. Nothing on the fold in lists (the designs: "half folded, nothing on the fold in
 * lists"; the laptop pose only, the book pose has no layout of its own), in the two ways the laptop-pose decision for
 * lists sets: a list whose rows take their state from the screen or a store runs across the fold (the Sessions
 * screen's classic list, the work-link picker): the list ends at the fold's top and a copy of it, hidden from
 * accessibility, fills the frame from the fold's bottom, continuing where the list ends (the band not counted), and a
 * drag on either moves the other; a Settings page and the Unified list (its cards keep their swipe state) end 8 pt
 * above the fold's top (447.5) with no copy, as a running list does while the keyboard is up or while its content
 * fits above the fold. Flat and in the book pose nothing changes. Real lists under the real `VerticalBarArea`: a
 * Settings page (`SettingsPageScrollView` with its shared row controls), the Sessions screen's classic list
 * (`DrawerBlockView` project cards) and Unified list (`useUnifiedList`'s cards) in the screen's own `SessionList`, the
 * switch between the two, and the work-link picker's list. The list's frame comes from the jest preset's
 * `measureInWindow`: the whole 669 x 951 window of the iPhone Duo in the laptop pose, whose fold's band is
 * 455.5-495.5; the content height and the scrolls are the platform's events, fired here.
 *
 * Not reached here: the rest of `SessionsScreen` (the screen needs a computer's inventory to render; its list is
 * `SessionList`, rendered here), the scroll views' clipping and their native scrolling (the jest preset's scroll view
 * records `scrollTo` and moves nothing), and the device's real frames.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState, type ReactNode } from 'react';
import { Dimensions, RefreshControl, ScrollView, StyleSheet, Text, TextInput } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';

import type { BarLayout, FoldDivision } from '../../../modules/ghostex-native/src/GhostexNative.types';
import type { ProjectHeaderItem } from '../../contract/grouping';
import { parseMobileSummary } from '../../contract/mobileSummary';
import type { MachineInventory } from '../../inventory/store';
import type { MachineRecord } from '../../machines/store';
import type { DrawerBlock } from '../sessions/drawerModel';
import DrawerBlockView, { type DrawerBlockActions } from '../../screens/sessions-screen/DrawerBlockView';
import WorkLinkPicker, { type WorkLinkCandidates } from '../../screens/sessions-screen/work-link-picker';
import { SessionList } from '../../screens/sessions-screen/session-list';
import { useUnifiedList } from '../../screens/sessions-screen/use-unified-list';
import { Caption, SettingsPageScrollView } from '../../screens/settings/SettingsControls';
import { FoldListFrame } from './foldGap';
import { keyboardFixture } from './keyboard/keyboardEventFixtures';
import { useBarGeometryStore } from './verticalBar/barGeometry';
import VerticalBarArea from './verticalBar/VerticalBarArea';

const mockNativeMethods = jest.requireActual<{ default: { measureInWindow: jest.Mock } }>(
  '@react-native/jest-preset/jest/MockNativeMethods',
).default;
let mockBarLayout: BarLayout | null = null;
/** The system's bar layout reports after the first answer (a fold, an unfold, a turn). */
let mockReport: ((layout: BarLayout) => void) | null = null;

jest.mock('../../../modules/ghostex-native/src', () => ({
  GhostexNative: {
    addListener: (_event: string, listener: (layout: BarLayout) => void) => {
      mockReport = listener;
      return { remove: () => undefined };
    },
    observeBarLayout: () => Promise.resolve({ id: 1, layout: mockBarLayout }),
    stopObservingBarLayout: () => Promise.resolve(),
  },
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return {
    useSafeAreaInsets: () => ({ top: 80, bottom: 20, left: 0, right: 0 }),
    SafeAreaView: View,
  };
});
// The Unified cards' swipe (gesture handler and Reanimated, not set up under jest) is not what is measured here: the
// row shows its card as a plain View.
jest.mock('../../screens/machines-screen/SwipeRevealRow', () => {
  const { createElement } = jest.requireActual('react');
  const { View } = jest.requireActual('react-native');
  return { __esModule: true, default: ({ children }: { children?: ReactNode }) => createElement(View, null, children) };
});

const PORTRAIT = { width: 669, height: 951 };
const LANDSCAPE = { width: 951, height: 669 };
const LAPTOP: FoldDivision = { x: 0, y: 455.5, width: 669, height: 40, active: true };
const FLAT: FoldDivision = { ...LAPTOP, active: false };
const BOOK: FoldDivision = { x: 455.5, y: 0, width: 40, height: 669, active: true };
const FOLD = { top: 455.5, bottom: 495.5 };
/** Where the list's visible part must end in the laptop pose: 8 pt above the fold's top. */
const ABOVE_FOLD = FOLD.top - 8;
/** The window frame `measureInWindow` answers: the whole window unless a test moves it. */
let listFrame = { top: 0, height: PORTRAIT.height };
/** The scroll command the jest preset's scroll view records (one function for every scroll view; `this` tells which). */
const nativeScrollTo = jest.mocked(ScrollView.prototype.scrollTo);
const keyboard = keyboardFixture(PORTRAIT);
/** The keyboard's top in the laptop pose: in the lower half. */
const KEYBOARD_TOP = 600;

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

function setWindow(window: { width: number; height: number }): void {
  Dimensions.set({ window: { ...window, scale: 3, fontScale: 1 }, screen: { ...window, scale: 3, fontScale: 1 } });
}

async function renderIn(
  content: ReactNode,
  division: FoldDivision = LAPTOP,
  window: { width: number; height: number } = PORTRAIT,
): Promise<void> {
  mockBarLayout = barLayout(division, window);
  await act(() => setWindow(window));
  await render(<VerticalBarArea>{content}</VerticalBarArea>);
  await advance();
}

async function advance(): Promise<void> {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(50);
  });
}

/** The system reports a new pose: React Native's window first, then the bar layout with its division. */
async function reportPose(division: FoldDivision, window: { width: number; height: number }): Promise<void> {
  await act(() => {
    setWindow(window);
    mockReport?.(barLayout(division, window));
  });
  await advance();
}

/** The scroll view a row showing `text` scrolls in. */
function scrollViewOf(text: string): TestInstance {
  let node: TestInstance | null = screen.getByText(text);
  while (node !== null && node.type !== 'RCTScrollView') node = node.parent;
  if (node === null) throw new Error(`${text} is in no scroll view`);
  return node;
}

/**
 * The window y where the scroll view holding `text` ends: its frame's bottom less the room the frame keeps below it
 * (the scroll view clips its rows there).
 */
function visibleBottom(text: string): number {
  const frame = scrollViewOf(text).parent;
  const padding = frame === null ? undefined : StyleSheet.flatten(frame.props.style)?.paddingBottom;
  return listFrame.top + listFrame.height - (typeof padding === 'number' ? padding : 0);
}

/** A scroll event at offset `y`; `target`: where a drag that ends there will come to rest. */
function scrollEvent(y: number, target?: number) {
  return {
    nativeEvent: {
      contentOffset: { x: 0, y },
      contentSize: { width: 640, height: 1600 },
      layoutMeasurement: { width: 640, height: ABOVE_FOLD },
      ...(target === undefined ? {} : { targetContentOffset: { x: 0, y: target } }),
    },
  };
}

/** The list's scroll view reports a scroll to `y`. */
async function scrollTo(text: string, y: number): Promise<void> {
  await fireEvent.scroll(scrollViewOf(text), scrollEvent(y));
  await advance();
}

/** The list holding `text` reports its content's height, as the platform does once its rows are laid out. */
async function reportContent(text: string, height = 1600): Promise<void> {
  await fireEvent(scrollViewOf(text), 'contentSizeChange', 640, height);
  await advance();
}

/** The scroll view of the list's copy below the fold's band (hidden from accessibility), or null without a copy. */
function copyOf(text: string): TestInstance | null {
  const list = scrollViewOf(text);
  for (const row of screen.queryAllByText(text, { includeHiddenElements: true })) {
    let node: TestInstance | null = row;
    while (node !== null && node.type !== 'RCTScrollView') node = node.parent;
    if (node !== null && node !== list) return node;
  }
  return null;
}

/** The window band the copy's scroll view fills: from its place's top in the list's frame, as tall as that place. */
function copyWindow(copy: TestInstance): { top: number; bottom: number } {
  const place = StyleSheet.flatten(copy.parent?.props.style);
  const top = listFrame.top + Number(place?.top);
  return { top, bottom: top + Number(place?.height) };
}

/**
 * Where React Native's iOS scroll command sets a scroll view asked for offset `y` (`scrollTo:y:animated:` in
 * `RCTScrollViewComponentView.mm` of the installed react-native): without `scrollToOverflowEnabled` it clamps `y` to
 * `min(-inset.top, 0)` … that plus `max(content - visible + inset.bottom + max(inset.top, 0), 0.01)`; with it, `y`
 * stands. The jest preset's scroll view only records the command, so these tests apply that native rule, copied from
 * the source, to the props the scroll view got (`content` and `visible` are the heights the device would report).
 */
function nativeLanding(scroll: TestInstance, y: number, content: number, visible: number): number {
  if (scroll.props.scrollToOverflowEnabled === true) return y;
  const top = Number(scroll.props.contentInset?.top ?? 0);
  const bottom = Number(scroll.props.contentInset?.bottom ?? 0);
  const min = Math.min(-top, 0);
  const max = min + Math.max(content - visible + bottom + Math.max(top, 0), 0.01);
  return Math.min(Math.max(y, min), max);
}

/** In the laptop pose, at rest and scrolled: the list ends above the fold, with no copy, so no row is drawn on it. */
async function expectEndsAboveFold(text: string): Promise<void> {
  await reportContent(text);
  expect(copyOf(text)).toBeNull();
  expect(visibleBottom(text)).toBe(ABOVE_FOLD);
  await scrollTo(text, 300);
  expect(visibleBottom(text)).toBe(ABOVE_FOLD);
  expect(copyOf(text)).toBeNull();
}

/**
 * In the laptop pose, at rest and scrolled: the list ends at the fold's top and its copy fills the frame from the
 * fold's bottom, at the offset where the list's upper part ends, so its rows continue below the band and none is
 * drawn on it; the band adds no scroll distance (the list's range loses the lower part's height, nothing more).
 */
async function expectRunsAcross(text: string): Promise<void> {
  const frameBottom = listFrame.top + listFrame.height;
  const upper = FOLD.top - listFrame.top;
  await reportContent(text);
  expect(visibleBottom(text)).toBe(FOLD.top);
  const copy = copyOf(text);
  if (copy === null) throw new Error(`${text}: no copy below the fold`);
  expect(copyWindow(copy)).toEqual({ top: FOLD.bottom, bottom: frameBottom });
  expect(scrollViewOf(text).props.contentInset).toEqual({ top: 0, bottom: -(frameBottom - FOLD.bottom) });
  expect(copy.props.contentInset).toEqual({ top: -upper, bottom: 0 });
  // The copy starts where the list's upper part ends, and follows the list's scroll.
  expect(nativeScrollTo).toHaveBeenLastCalledWith({ animated: false, y: upper });
  await scrollTo(text, 300);
  expect(nativeScrollTo).toHaveBeenLastCalledWith({ animated: false, y: 300 + upper });
  expect(visibleBottom(text)).toBe(FOLD.top);
  expect(copyWindow(copy)).toEqual({ top: FOLD.bottom, bottom: frameBottom });
}

const OTHER_POSES: [string, FoldDivision, { width: number; height: number }][] = [
  ['flat', FLAT, PORTRAIT],
  ['book pose', BOOK, LANDSCAPE],
];

beforeEach(async () => {
  jest.useFakeTimers();
  listFrame = { top: 0, height: PORTRAIT.height };
  mockNativeMethods.measureInWindow.mockImplementation((onFrame: (...frame: number[]) => void) =>
    onFrame(0, listFrame.top, PORTRAIT.width, listFrame.height),
  );
  nativeScrollTo.mockClear();
  keyboard.setScreen(PORTRAIT.width, PORTRAIT.height);
  await act(() => keyboard.hide(0));
  await AsyncStorage.clear();
  useBarGeometryStore.setState({ hydrated: false, keyboardHeights: {}, layouts: {} });
  await useBarGeometryStore.getState().hydrate();
});

afterEach(async () => {
  await act(() => keyboard.hide(0));
  mockNativeMethods.measureInWindow.mockReset();
  jest.useRealTimers();
});

describe('Settings (SettingsPageScrollView and the shared row controls)', () => {
  const LABELS = Array.from({ length: 30 }, (_, index) => `Setting ${index}`);
  const page = (
    <SettingsPageScrollView>
      {LABELS.map((label) => (
        <Caption key={label}>{label}</Caption>
      ))}
    </SettingsPageScrollView>
  );

  test('laptop pose: the page ends above the fold, also scrolled', async () => {
    await renderIn(page);
    await expectEndsAboveFold('Setting 0');
  });

  test.each(OTHER_POSES)('%s: the page keeps its whole frame and nothing is measured', async (_pose, division, window) => {
    listFrame = { top: 0, height: window.height };
    await renderIn(page, division, window);
    expect(visibleBottom('Setting 0')).toBe(window.height);
    expect(mockNativeMethods.measureInWindow).not.toHaveBeenCalled();
  });

  test.each(OTHER_POSES)('leaving the laptop pose for %s gives the page its whole frame, coming back ends it above the fold', async (_pose, division, window) => {
    await renderIn(page);
    expect(visibleBottom('Setting 0')).toBe(ABOVE_FOLD);
    listFrame = { top: 0, height: window.height };
    await reportPose(division, window);
    expect(visibleBottom('Setting 0')).toBe(window.height);
    listFrame = { top: 0, height: PORTRAIT.height };
    await reportPose(LAPTOP, PORTRAIT);
    expect(visibleBottom('Setting 0')).toBe(ABOVE_FOLD);
  });
});

describe("the Sessions screen's classic list (DrawerBlockView blocks in SessionList)", () => {
  const PROJECTS = Array.from({ length: 20 }, (_, index) => `Project ${index}`);
  const header = (title: string): ProjectHeaderItem => ({
    type: 'PROJECT_HEADER',
    key: `project:${title}`,
    machineId: 'm1',
    projectKey: title,
    projectId: title,
    legacyGroupId: '',
    title,
    projectPath: `/work/${title}`,
    collapsed: true,
    sessionCount: 0,
    workingCount: 0,
    attentionCount: 0,
    questionCount: 0,
    approvalCount: 0,
    backgroundWorkCount: 0,
    sleepingCount: 0,
    awakeCount: 0,
    containsActive: false,
    icon: { imageDataUrl: '', discoveredIconDataUrl: '', glyph: '', glyphColor: '', isWorktree: false },
    themeColor: '',
    agents: [],
    quickActions: [],
  });
  const blocks: DrawerBlock[] = PROJECTS.map((title) => ({
    kind: 'project',
    listKey: title,
    machineId: 'm1',
    card: { header: header(title), children: [] },
  }));
  const noAction = new Proxy({}, { get: () => () => undefined }) as DrawerBlockActions;
  const appearance = {
    background: '#121212',
    foreground: '#ffffff',
    muted: '#888888',
    mutedGlyph: '#888888',
    card: '#1c1c1c',
    cardActive: '#262626',
    border: '#333333',
    projectCard: '#1a1a1a',
    projectBorder: '#2a2a2a',
  };
  const classic = (
    <SessionList
      unified={null}
      classic={{
        data: blocks,
        keyExtractor: (block) => block.listKey,
        renderItem: ({ item }) => (
          <DrawerBlockView
            block={item}
            selectedSessionKey={null}
            appearance={appearance}
            rowSurface="#1c1c1c"
            groupsOpacityPercent={100}
            summary={null}
            voiceCallSessionKey={null}
            primaryAgent={() => null}
            hideStateCard={() => false}
            actions={noAction}
          />
        ),
        // As the screen's list has them: pull to refresh, and a header (the screen's is the folded triage).
        refreshControl: <RefreshControl refreshing={false} onRefresh={() => undefined} />,
        ListHeaderComponent: <TextInput accessibilityLabel="Filter projects" />,
      }}
    />
  );

  test('laptop pose: the list runs across the fold, its rows continuing below the band and none on it, also scrolled', async () => {
    await renderIn(classic);
    await expectRunsAcross('Project 0');
    // The copy draws the same rows below the band.
    expect(screen.getAllByText('Project 5', { includeHiddenElements: true })).toHaveLength(2);
  });

  test('laptop pose: the copy is hidden from accessibility, so each row is there once for VoiceOver', async () => {
    await renderIn(classic);
    await reportContent('Project 0');
    const copy = copyOf('Project 0');
    expect(copy?.parent?.props).toMatchObject({
      accessibilityElementsHidden: true,
      importantForAccessibility: 'no-hide-descendants',
    });
    for (const title of ['Project 0', 'Project 5']) expect(screen.getAllByText(title)).toHaveLength(1);
    expect(screen.getAllByLabelText('Filter projects')).toHaveLength(1);
  });

  test("laptop pose: the copy has no pull to refresh, and its list header takes no touches (the list's does)", async () => {
    await renderIn(classic);
    await reportContent('Project 0');
    const copy = copyOf('Project 0');
    expect(scrollViewOf('Project 0').props.refreshControl).toBeDefined();
    expect(copy?.props.refreshControl).toBeUndefined();
    /** The nearest view up to the scroll view that takes no touches, or null. */
    const untouchable = (field: TestInstance | undefined): TestInstance | null => {
      let node: TestInstance | null = field ?? null;
      while (node !== null && node.type !== 'RCTScrollView') {
        if (StyleSheet.flatten(node.props.style)?.pointerEvents === 'none') return node;
        node = node.parent;
      }
      return null;
    };
    const shown = screen.getByLabelText('Filter projects');
    const fields = screen.getAllByLabelText('Filter projects', { includeHiddenElements: true });
    expect(fields).toHaveLength(2);
    expect(untouchable(shown)).toBeNull();
    expect(untouchable(fields.find((field) => field !== shown))).not.toBeNull();
  });

  test('laptop pose: a drag on either part moves the other, and the follower sends nothing back', async () => {
    await renderIn(classic);
    await reportContent('Project 0');
    const upper = FOLD.top - listFrame.top;
    const copy = copyOf('Project 0');
    if (copy === null) throw new Error('no copy below the fold');
    // The list scrolls: the copy follows to the matching offset.
    nativeScrollTo.mockClear();
    await scrollTo('Project 0', 300);
    expect(nativeScrollTo.mock.calls).toEqual([[{ animated: false, y: 300 + upper }]]);
    const copyInstance = nativeScrollTo.mock.contexts[0];
    // The user drags the copy: the list follows to the matching offset, and the list's own report of that scroll
    // moves the copy no further.
    nativeScrollTo.mockClear();
    await fireEvent(copy, 'scrollBeginDrag', scrollEvent(300 + upper));
    await fireEvent.scroll(copy, scrollEvent(900));
    await advance();
    expect(nativeScrollTo.mock.calls).toEqual([[{ animated: false, y: 900 - upper }]]);
    expect(nativeScrollTo.mock.contexts[0]).not.toBe(copyInstance);
    nativeScrollTo.mockClear();
    await scrollTo('Project 0', 900 - upper);
    expect(nativeScrollTo).not.toHaveBeenCalled();
    // The drag ends where it rests: the list leads again, and the copy's own reports move the list no further.
    await fireEvent(copy, 'scrollEndDrag', scrollEvent(900, 900));
    await fireEvent.scroll(copy, scrollEvent(900));
    await advance();
    expect(nativeScrollTo).not.toHaveBeenCalled();
    await scrollTo('Project 0', 500);
    expect(nativeScrollTo.mock.calls).toEqual([[{ animated: false, y: 500 + upper }]]);
    expect(nativeScrollTo.mock.contexts[0]).toBe(copyInstance);
  });

  describe("the native scroll command takes the offsets past either part's own range", () => {
    // A frame from 100 to 931: upper part 100-455.5 (A = 355.5), band, lower part 495.5-931 (C = 435.5).
    const A = FOLD.top - 100;
    const C = 931 - FOLD.bottom;
    beforeEach(() => {
      listFrame = { top: 100, height: 831 };
    });

    test('content longer than the upper part but shorter than both (A < L < A + C) continues below the band without repeating a row', async () => {
      await renderIn(classic);
      // Before the content is known the list keeps its own setting.
      expect(scrollViewOf('Project 0').props.scrollToOverflowEnabled).toBeUndefined();
      await reportContent('Project 0', 600);
      const copy = copyOf('Project 0');
      if (copy === null) throw new Error('no copy below the fold');
      // The copy is asked to start where the upper part ends (offset 0 + A), and it lands there.
      expect(nativeScrollTo).toHaveBeenLastCalledWith({ animated: false, y: A });
      expect(nativeLanding(copy, A, 600, C)).toBe(A);
    });

    test('a pull past the top in the copy is mirrored in the list', async () => {
      await renderIn(classic);
      await reportContent('Project 0', 2000);
      const copy = copyOf('Project 0');
      if (copy === null) throw new Error('no copy below the fold');
      nativeScrollTo.mockClear();
      await fireEvent(copy, 'scrollBeginDrag', scrollEvent(A));
      await fireEvent.scroll(copy, scrollEvent(A - 50));
      await advance();
      expect(nativeScrollTo).toHaveBeenLastCalledWith({ animated: false, y: -50 });
      expect(nativeLanding(scrollViewOf('Project 0'), -50, 2000, A)).toBe(-50);
    });

    test('a pull past the end in the list is mirrored in the copy', async () => {
      await renderIn(classic);
      await reportContent('Project 0', 2000);
      const copy = copyOf('Project 0');
      if (copy === null) throw new Error('no copy below the fold');
      const end = 2000 - A - C;
      nativeScrollTo.mockClear();
      await scrollTo('Project 0', end + 50);
      expect(nativeScrollTo).toHaveBeenLastCalledWith({ animated: false, y: 2000 - C + 50 });
      expect(nativeLanding(copy, 2000 - C + 50, 2000, C)).toBe(2000 - C + 50);
    });
  });

  test('laptop pose: a fling of the copy leads until its motion ends', async () => {
    await renderIn(classic);
    await reportContent('Project 0');
    const upper = FOLD.top - listFrame.top;
    const copy = copyOf('Project 0');
    if (copy === null) throw new Error('no copy below the fold');
    await fireEvent(copy, 'scrollBeginDrag', scrollEvent(upper));
    // Released moving: it will come to rest further on.
    await fireEvent(copy, 'scrollEndDrag', scrollEvent(700, 1100));
    nativeScrollTo.mockClear();
    await fireEvent.scroll(copy, scrollEvent(1000));
    await advance();
    expect(nativeScrollTo.mock.calls).toEqual([[{ animated: false, y: 1000 - upper }]]);
    await fireEvent(copy, 'momentumScrollEnd', scrollEvent(1100));
    nativeScrollTo.mockClear();
    await scrollTo('Project 0', 400);
    expect(nativeScrollTo.mock.calls).toEqual([[{ animated: false, y: 400 + upper }]]);
  });

  test('laptop pose with the keyboard up (it lies in the lower half): the list ends above the fold, without a copy', async () => {
    await renderIn(classic);
    await reportContent('Project 0');
    expect(copyOf('Project 0')).not.toBeNull();
    await act(() => keyboard.show(KEYBOARD_TOP, PORTRAIT.height - KEYBOARD_TOP));
    await advance();
    expect(copyOf('Project 0')).toBeNull();
    expect(visibleBottom('Project 0')).toBe(ABOVE_FOLD);
    await scrollTo('Project 0', 300);
    expect(copyOf('Project 0')).toBeNull();
    // The keyboard goes: the copy comes back, in step with the list's offset.
    nativeScrollTo.mockClear();
    await act(() => keyboard.hide(0));
    await advance();
    expect(copyOf('Project 0')).not.toBeNull();
    expect(visibleBottom('Project 0')).toBe(FOLD.top);
    expect(nativeScrollTo).toHaveBeenLastCalledWith({ animated: false, y: 300 + FOLD.top - listFrame.top });
  });

  test('laptop pose: content that fits above the fold has no copy and ends above it', async () => {
    await renderIn(classic);
    await reportContent('Project 0', ABOVE_FOLD - listFrame.top);
    expect(copyOf('Project 0')).toBeNull();
    expect(visibleBottom('Project 0')).toBe(ABOVE_FOLD);
  });

  test.each(OTHER_POSES)('%s: the list keeps its whole frame, without a copy', async (_pose, division, window) => {
    listFrame = { top: 0, height: window.height };
    await renderIn(classic, division, window);
    await reportContent('Project 0');
    expect(visibleBottom('Project 0')).toBe(window.height);
    expect(copyOf('Project 0')).toBeNull();
  });
});

describe("the Unified sessions list (useUnifiedList cards in the screen's SessionList)", () => {
  const TITLES = Array.from({ length: 20 }, (_, index) => `Session ${index}`);
  const MACHINE: MachineRecord = {
    id: 'm1',
    name: 'studio',
    host: 'studio.local',
    username: 'me',
    port: 22,
    savePassword: false,
    lastConnectedAt: null,
  };
  const MACHINES = [MACHINE];
  const NO_WORKSPACES: Record<string, string> = {};
  /** One computer asking for the Unified sidebar: one project, twenty idle sessions, newest first. */
  const inventory = (): MachineInventory => {
    const now = Date.now();
    const summary = parseMobileSummary(
      JSON.stringify({
        ok: true,
        sidebarView: 'unified',
        unifiedGroupByProject: false,
        projects: [{ projectId: 'P1', name: 'Ghostex', path: '/work/Ghostex' }],
        sessions: TITLES.map((title, index) => ({
          sessionId: `s${index}`,
          projectId: 'P1',
          title,
          status: 'idle',
          activity: 'idle',
          isLive: true,
          provider: 'zmx',
          createdAt: new Date(now - 86_400_000).toISOString(),
          lastInteractionAt: new Date(now - (index + 1) * 60_000).toISOString(),
        })),
      }),
    );
    return {
      summary,
      serverSummary: summary,
      lastError: null,
      lastErrorCode: null,
      hasLoaded: true,
      loadedAt: now,
      refreshing: false,
      retrying: false,
      fingerprint: null,
    };
  };
  /** Built once, so every render reads the same summaries (as the screen's inventory store hands them out). */
  const INVENTORIES = { [MACHINE.id]: inventory() };

  function UnifiedList() {
    const unified = useUnifiedList({
      machines: MACHINES,
      selectedMachine: MACHINE,
      inventoriesByMachineId: INVENTORIES,
      selectedWorkspaceIdByMachine: NO_WORKSPACES,
      selectedSessionKey: null,
      sidebarBackground: '#121212',
      focused: true,
      setOverlay: () => undefined,
      attach: () => Promise.resolve(),
      runBulkSessionActions: () => Promise.resolve(),
      snoozeSession: () => Promise.resolve(),
      openAddProject: () => undefined,
      notify: () => undefined,
    });
    return (
      <SessionList
        unified={{ data: unified.items, keyExtractor: unified.keyExtractor, renderItem: unified.renderItem }}
        classic={{ data: [], renderItem: () => null }}
      />
    );
  }

  test('laptop pose: the list ends above the fold with no copy below it (its cards keep their swipe state), also scrolled', async () => {
    await renderIn(<UnifiedList />);
    await expectEndsAboveFold('Session 0');
  });

  test.each(OTHER_POSES)('%s: the list keeps its whole frame', async (_pose, division, window) => {
    listFrame = { top: 0, height: window.height };
    await renderIn(<UnifiedList />, division, window);
    expect(visibleBottom('Session 0')).toBe(window.height);
  });
});

describe("switching between the classic and the Unified list (the screen's SessionList)", () => {
  const CLASSIC = Array.from({ length: 10 }, (_, index) => `Project ${index}`);
  const UNIFIED = Array.from({ length: 10 }, (_, index) => `Card ${index}`);
  const unit = ({ item }: { item: string }) => <Text>{item}</Text>;
  let lists = { mounted: 0, unmounted: 0 };
  /** Mounted with the list it heads, so it counts the list's own mounts. */
  function ListLife() {
    useEffect(() => {
      lists.mounted += 1;
      return () => {
        lists.unmounted += 1;
      };
    }, []);
    return null;
  }
  let showUnified: ((on: boolean) => void) | null = null;
  /** The computer's sidebar setting (or the selected machine tab) switching the screen between its two lists. */
  function SwitchingList() {
    const [on, setOn] = useState(false);
    showUnified = setOn;
    // Keyed by row as the screen's lists are (`listKey`, the Unified row id), so no row stands in for another.
    const list = { renderItem: unit, keyExtractor: (item: string) => item, ListHeaderComponent: ListLife };
    return <SessionList unified={on ? { ...list, data: UNIFIED } : null} classic={{ ...list, data: CLASSIC }} />;
  }
  async function switchTo(unified: boolean): Promise<void> {
    await act(() => showUnified?.(unified));
    await advance();
  }

  beforeEach(() => {
    lists = { mounted: 0, unmounted: 0 };
  });

  test('flat: a switch mounts the other list, and switching back mounts the first one again', async () => {
    await renderIn(<SwitchingList />, FLAT);
    expect(lists).toEqual({ mounted: 1, unmounted: 0 });
    await switchTo(true);
    expect(lists).toEqual({ mounted: 2, unmounted: 1 });
    await switchTo(false);
    expect(lists).toEqual({ mounted: 3, unmounted: 2 });
  });

  test('laptop pose: after scrolling, the classic list runs across the fold, the Unified list switched to ends above it, and the classic list switched back runs across again from its top', async () => {
    await renderIn(<SwitchingList />);
    await expectRunsAcross('Project 0');
    await switchTo(true);
    await expectEndsAboveFold('Card 0');
    await switchTo(false);
    await expectRunsAcross('Project 0');
  });
});

describe('the work-link picker (a full-screen view with a list)', () => {
  const LABELS = Array.from({ length: 20 }, (_, index) => `#${index + 100}`);
  const candidates: WorkLinkCandidates = {
    multiSelect: false,
    linked: [],
    notice: '',
    candidates: LABELS.map((label) => ({ value: label, label, title: '', detail: '', linked: false })),
  };
  const picker = (
    <WorkLinkPicker
      kind="pullRequest"
      sessionTitle="build"
      load={() => Promise.resolve(candidates)}
      onPick={() => undefined}
      onCancel={() => undefined}
    />
  );

  test('laptop pose: the candidate list runs across the fold, also scrolled', async () => {
    // Below the picker's header and search field.
    listFrame = { top: 150, height: PORTRAIT.height - 170 };
    await renderIn(picker);
    await advance();
    await expectRunsAcross('#100');
  });

  test('flat: the candidate list keeps its whole frame', async () => {
    listFrame = { top: 150, height: PORTRAIT.height - 170 };
    await renderIn(picker, FLAT);
    await advance();
    expect(visibleBottom('#100')).toBe(PORTRAIT.height - 20);
  });
});

describe('a window change with the same fold', () => {
  const LABEL = 'Row';
  function FixedFoldList() {
    return (
      <FoldListFrame fold={FOLD}>
        <ScrollView>
          <Text>{LABEL}</Text>
        </ScrollView>
      </FoldListFrame>
    );
  }

  test('a list an ancestor stretched over the fold, without a layout of its own, then ends above it', async () => {
    await act(() => setWindow(PORTRAIT));
    listFrame = { top: 100, height: 300 };
    await render(<FixedFoldList />);
    await advance();
    expect(visibleBottom(LABEL)).toBe(400);
    // The new window stretches the list to 100-600, across the band; its own layout event does not come.
    listFrame = { top: 100, height: 500 };
    await act(() => setWindow({ ...PORTRAIT, height: PORTRAIT.height + 50 }));
    await advance();
    expect(visibleBottom(LABEL)).toBe(ABOVE_FOLD);
  });
});
