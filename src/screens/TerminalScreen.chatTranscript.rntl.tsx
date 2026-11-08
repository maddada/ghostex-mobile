/// <reference types="jest" />
/**
 * Run with `bun run test:jest src/screens/TerminalScreen.chatTranscript.rntl.tsx`. With a chat in a pane beside a
 * terminal, only the chat on screen owns the transcript's
 * scroll state (`bottomStore.ts`: whether the reader left the bottom, and the way back there), which the working card
 * and the pills read. The selected terminal's hidden chat (the screen's preload) never takes it over, also when the
 * person goes to the terminal and back. Real are the screen, the pane host, the stores and the main `NativeTranscript`
 * with its scroll handlers; the chat screen is a stand-in that draws that transcript with the screen's `visible` as its
 * `active` (as `NativeChatScreen` does), and the transcript's row and card renderers are native boundaries.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { AccessibilityInfo, Dimensions, StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';

import type { BarLayout, FoldDivision } from '../../modules/ghostex-native/src/GhostexNative.types';
import { keyboardFixture } from '../components/common/keyboard/keyboardEventFixtures';
import { useBarGeometryStore } from '../components/common/verticalBar/barGeometry';
import VerticalBarArea from '../components/common/verticalBar/VerticalBarArea';
import { parseMobileSummary } from '../contract/mobileSummary';
import { PanesCopy, TerminalHeaderCopy } from '../copy';
import { emptyMachineInventory, useInventoryStore } from '../inventory/store';
import { useMachinesStore, type MachineRecord } from '../machines/store';
import { PANE_FOLD_CLEARANCE, PANE_MIN_USABLE_HEIGHT, PANE_TITLE_HEIGHT } from '../panes/geometry';
import { SINGLE_PANE_DOCUMENT, type PaneLayoutDocument, type PaneSlot } from '../panes/layout';
import { initPaneLayouts, PANE_LAYOUT_STORAGE_KEY, usePaneStore } from '../panes/store';
import { DEFAULT_COMMAND_PAD_KEYS } from '../settings/commandPad';
import { useSettingsStore } from '../settings/store';
import { attachSessionKey, useTerminalStore, type TerminalTab } from '../terminal/sessions';
import TerminalScreen from './TerminalScreen';
// Isolate the actual list state from native-only card/row renderers, not from its scroll or lifecycle handlers.
jest.mock('../chat/native/cards', () => ({ EmptyTranscript: () => null }));
jest.mock('../chat/native/transcript/TranscriptItemRow', () => ({ TranscriptItemView: () => null }));
// The transcript's reply fade-in (commit d78439e) imports Reanimated, which is native and does not load under Jest.
jest.mock('react-native-reanimated', () => {
  const { View: MockView } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: { View: MockView },
    FadeIn: { duration: () => ({}) },
    useReducedMotion: () => true,
  };
});

const mockNative = {
  focusTerminal: jest.fn((_sessionKey: string): Promise<boolean> => Promise.resolve(true)),
  blurTerminal: jest.fn((_sessionKey: string) => Promise.resolve()),
  openTerminal: jest.fn((_sessionKey: string, _machineId: string, _opts: object) => Promise.resolve()),
};
let mockBarLayout: BarLayout | null = null;
let mockReport: ((layout: BarLayout) => void) | null = null;
/** The zmx display policy's last report: the terminal on screen, the chat on screen, the terminal in the other pane. */
let mockMounted: [string | null, string | null, string | null] = [null, null, null];
/** The chat lease's session (`setChatGridSessionKey`). */
let mockChatGrid: string | null = null;

jest.mock('../../modules/ghostex-native/src', () => {
  const { View: MockView } = jest.requireActual('react-native');
  const React = jest.requireActual('react');
  return {
    GhostexNative: {
      addListener: (event: string, listener: (layout: BarLayout) => void) => {
        if (event === 'onBarLayoutChange') mockReport = listener;
        return { remove: () => undefined };
      },
      observeBarLayout: () => Promise.resolve({ id: 1, layout: mockBarLayout }),
      stopObservingBarLayout: () => Promise.resolve(),
      setKeepScreenOn: () => Promise.resolve(),
      scrollToBottom: () => Promise.resolve(),
      refreshTerminalViewport: () => Promise.resolve(),
      sendKey: () => Promise.resolve(),
      sendText: () => Promise.resolve(),
      setKeyModifiers: () => Promise.resolve(),
      pasteFromClipboard: () => Promise.resolve(),
      focusTerminal: (sessionKey: string) => mockNative.focusTerminal(sessionKey),
      blurTerminal: (sessionKey: string) => mockNative.blurTerminal(sessionKey),
      // No hardware keyboard: nothing holds the keyboard's input without a keyboard on screen.
      keyboardInputHeld: () => Promise.resolve(false),
      openTerminal: (...args: [string, string, object]) => mockNative.openTerminal(...args),
      closeTerminal: () => Promise.resolve(),
    },
    GhostexTerminalView: (props: { sessionKey: string }) =>
      React.createElement(MockView, { testID: 'terminal-view', ...props }),
  };
});
jest.mock('../chat/native/NativeChatScreen', () => {
  const { View: MockView } = jest.requireActual('react-native');
  const React = jest.requireActual('react');
  const { NativeTranscript } = jest.requireActual('../chat/native/transcript/Transcript');
  const chat = { state: null, dispatch: () => undefined, measure: () => undefined };
  const items = [{ kind: 'review-row-unknown-to-renderer' }];
  return {
    __esModule: true,
    default: (props: { sessionId: string; visible: boolean }) =>
      React.createElement(
        MockView,
        { testID: `chat:${props.sessionId}`, ...props },
        React.createElement(NativeTranscript, { chat, items, active: props.visible }),
      ),
  };
});

jest.mock('../terminal/zmxDisplay', () => ({
  ...jest.requireActual('../terminal/zmxDisplay'),
  setMountedSessionKeys: (terminal: string | null, chat: string | null, pane: string | null = null) => {
    mockMounted = [terminal, chat, pane];
  },
}));
jest.mock('../terminal/chatGridClaim', () => ({
  setChatGridSessionKey: (sessionKey: string | null) => {
    mockChatGrid = sessionKey;
  },
}));
jest.mock('../inventory/client', () => ({
  ...jest.requireActual('../inventory/client'),
  ensureConnected: () => Promise.resolve(),
}));
jest.mock('../remote/commands', () => ({
  remoteTerminalCommand: (_machineId: string, command: string) => Promise.resolve(command),
  remoteShellCommand: () => Promise.resolve(null),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-haptics', () => ({
  impactAsync: () => Promise.resolve(),
  notificationAsync: () => Promise.resolve(),
  selectionAsync: () => Promise.resolve(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Rigid: 'rigid' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 80, bottom: 20, left: 0, right: 0 }),
}));
jest.mock('../voice/VoiceButton', () => ({ VoiceButton: () => null }));
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  useFocusEffect: () => undefined,
  useNavigation: () => ({ navigate: () => undefined }),
}));

type Window = { width: number; height: number };
type Rect = { x: number; y: number; width: number; height: number };

const UPRIGHT: Window = { width: 669, height: 951 };
const TURNED: Window = { width: 951, height: 669 };
/** The folded Duo's outer display and a regular iPhone: windows without the fold's divisions. */
const FOLDED: Window = { width: 466, height: 678 };
const PHONE: Window = { width: 402, height: 874 };
const HOME = 20;
const AREA_TOP = 82;
const areaOf = (window: Window): Rect => ({
  x: 0,
  y: AREA_TOP,
  width: window.width,
  height: window.height - HOME - AREA_TOP,
});
const FLAT_UPRIGHT: FoldDivision = { x: 0, y: 455.5, width: 669, height: 40, active: false };
const FLAT_TURNED: FoldDivision = { x: 455.5, y: 0, width: 40, height: 669, active: false };
const LAPTOP: FoldDivision = { ...FLAT_UPRIGHT, active: true };
const FOLD_TOP = 455.5;
const KEYBOARD_HEIGHT = 336;
const TOGGLE = 'Command pad';
const HIDDEN_TOO = { hidden: true };

const MACHINE: MachineRecord = {
  id: 'm1',
  name: 'Mac',
  host: 'mac.local',
  username: 'me',
  port: 22,
  savePassword: false,
  lastConnectedAt: null,
};

function attachTab(sessionId: string, title: string): TerminalTab {
  return {
    sessionKey: attachSessionKey('m1', sessionId),
    machineId: 'm1',
    title,
    kind: 'attach',
    ghostexSessionId: sessionId,
    ghostexProjectId: 'p1',
    state: 'open',
  };
}

const ALPHA = attachTab('a', 'Alpha');
const BETA = attachTab('b', 'Beta');
const GAMMA = attachTab('c', 'Gamma');
const A = ALPHA.sessionKey;
const B = BETA.sessionKey;
const C = GAMMA.sessionKey;

function summarySession(sessionId: string, displayTitle: string) {
  return {
    sessionId,
    projectId: 'p1',
    projectName: 'ghostex-mobile',
    displayTitle,
    provider: 'zmx',
    agent: 'Codex',
    agentName: 'Codex',
    activity: 'idle',
    status: 'running',
    isLive: true,
  };
}

const SUMMARY = parseMobileSummary(
  JSON.stringify({
    sessions: [summarySession('a', 'Alpha'), summarySession('b', 'Beta'), summarySession('c', 'Gamma')],
  }),
);

const sessionSlot = (sessionKey: string): PaneSlot => ({ paneType: 'session', sessionKey });

function stacked(first: PaneSlot, second: PaneSlot, dividerRatio = 0.5): PaneLayoutDocument {
  return { schemaVersion: 1, layouts: { stacked: { first, second, dividerRatio } } };
}

function sideBySide(first: PaneSlot, second: PaneSlot, dividerRatio = 0.5): PaneLayoutDocument {
  return { schemaVersion: 1, layouts: { sideBySide: { first, second, dividerRatio } } };
}

const navigation = { setOptions: jest.fn(), popTo: jest.fn(), navigate: jest.fn(), push: jest.fn() };
const keyboard = keyboardFixture(UPRIGHT);
const initialSettings = useSettingsStore.getState().settings;

function barLayout(window: Window, divisions: FoldDivision[]): BarLayout {
  return {
    windowWidth: window.width,
    windowHeight: window.height,
    safeTop: 80,
    safeLeft: 0,
    safeRight: 0,
    marginTop: 88,
    topBar: { x: 0, y: 26, width: 466, height: 44 },
    divisions,
  };
}

type Setup = {
  window?: Window;
  divisions?: FoldDivision[];
  tabs?: TerminalTab[];
  selected?: string;
  /** The sessions whose saved view is their chat. */
  chats?: string[];
  stored?: PaneLayoutDocument;
};

/** The app starting with one content area while the pane layouts load, then the pane store reading storage. */
async function renderScreen({
  window = UPRIGHT,
  divisions = [FLAT_UPRIGHT],
  tabs = [ALPHA, BETA, GAMMA],
  selected = A,
  chats = [A],
  stored,
}: Setup = {}): Promise<void> {
  mockBarLayout = barLayout(window, divisions);
  await act(() => {
    keyboard.setScreen(window.width, window.height);
    Dimensions.set({ window: { ...window, scale: 3, fontScale: 1 }, screen: { ...window, scale: 3, fontScale: 1 } });
  });
  if (stored !== undefined) await AsyncStorage.setItem(PANE_LAYOUT_STORAGE_KEY, JSON.stringify(stored));
  useTerminalStore.setState({
    tabs,
    selectedSessionKey: selected,
    paneSessionKey: null,
    warmOrder: tabs.map((tab) => tab.sessionKey),
    sessionViewModeBySessionKey: Object.fromEntries(chats.map((key) => [key, 'chat'])),
  });
  await render(
    <VerticalBarArea>
      <TerminalScreen
        navigation={navigation as never}
        route={{ key: 'terminal', name: 'Terminal', params: { sessionKey: selected, machineId: 'm1' } }}
      />
    </VerticalBarArea>,
  );
  await act(async () => undefined);
  // The terminal area: the parent of what fills it with one content area, the chat or the terminal.
  const filler = screen.queryByTestId('terminal-view') ?? screen.getByTestId(/^chat:/, HIDDEN_TOO);
  if (filler.parent === null) throw new Error('no terminal area');
  await fireEvent(filler.parent, 'layout', { nativeEvent: { layout: areaOf(window) } });
  await act(() => usePaneStore.getState().hydrate());
  await settle();
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) await act(async () => undefined);
}

async function keyboardWillShow(window: Window = UPRIGHT): Promise<void> {
  await act(() => keyboard.show(window.height - KEYBOARD_HEIGHT, KEYBOARD_HEIGHT, 250));
  await settle();
}

async function keyboardWillHide(): Promise<void> {
  await act(() => keyboard.hide(250));
  await act(() => jest.advanceTimersByTime(1000));
  await settle();
}

function num(instance: TestInstance, key: string): number {
  const value = (StyleSheet.flatten(instance.props.style) as Record<string, unknown> | undefined)?.[key];
  if (typeof value !== 'number') throw new Error(`no numeric ${key}`);
  return value;
}

/** A pane card's frame in the pane container, by what it shows (a session's key, or a pane type). */
function card(key: string): Rect {
  const view = screen.getByTestId(`pane:${key}`);
  return { x: num(view, 'left'), y: num(view, 'top'), width: num(view, 'width'), height: num(view, 'height') };
}

function bottomOf(rect: Rect): number {
  return rect.y + rect.height;
}

function dividerAt(): number {
  const cards = screen
    .getAllByTestId(/^pane:/)
    .map((view) => ({ start: num(view, 'top'), size: num(view, 'height') }))
    .sort((a, b) => a.start - b.start);
  return (cards[0].start + cards[0].size + cards[1].start) / 2;
}

/** The chat screen of a session (`a`, `b`, `c`), wherever it stands. */
function chat(sessionId: string): TestInstance {
  return screen.getByTestId(`chat:${sessionId}`, HIDDEN_TOO);
}

/** The chat screen standing in a pane, by the session's key. */
function chatInPane(sessionKey: string, sessionId: string): TestInstance {
  return within(screen.getByTestId(`pane:${sessionKey}`)).getByTestId(`chat:${sessionId}`, HIDDEN_TOO);
}

function terminalsShown(): string[] {
  return screen.queryAllByTestId('terminal-view', HIDDEN_TOO).map((view) => String(view.props.sessionKey));
}

/** Within a pane: no terminal view. */
function terminalIn(sessionKey: string): TestInstance | null {
  return within(screen.getByTestId(`pane:${sessionKey}`)).queryByTestId('terminal-view', HIDDEN_TOO);
}

function selected(): string | null {
  return useTerminalStore.getState().selectedSessionKey;
}

function savedViews(): Record<string, string> {
  return useTerminalStore.getState().sessionViewModeBySessionKey;
}

function touch() {
  const point = { pageX: 10, pageY: 10, locationX: 0, locationY: 0, identifier: 0, target: 1, timestamp: 0 };
  return { persist: () => undefined, nativeEvent: { ...point, touches: [point], changedTouches: [point] } };
}

/** A touch anywhere in a pane: the card notes every touch that starts in it. */
async function tapPane(sessionKey: string): Promise<void> {
  await fireEvent(screen.getByTestId(`pane:${sessionKey}`), 'touchStart', touch());
  await settle();
}

async function press(label: string | RegExp): Promise<void> {
  await fireEvent.press(screen.getByLabelText(label));
  await settle();
}

beforeAll(() => {
  initPaneLayouts();
});

beforeEach(async () => {
  jest.useFakeTimers();
  Object.values(mockNative).forEach((mock) => mock.mockClear());
  navigation.setOptions.mockClear();
  mockReport = null;
  mockMounted = [null, null, null];
  mockChatGrid = null;
  useSettingsStore.setState({
    settings: {
      ...initialSettings,
      extraKeysToolbarVisible: true,
      commandPadKeys: [...DEFAULT_COMMAND_PAD_KEYS],
      commandPadPosition: {},
      preferredAgentInterface: 'terminal',
    },
  });
  useMachinesStore.setState({ machines: [MACHINE] });
  useInventoryStore.setState({ inventoriesByMachineId: { m1: { ...emptyMachineInventory(), summary: SUMMARY } } });
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(false));
  await AsyncStorage.clear();
  usePaneStore.setState({
    hydrated: false,
    document: SINGLE_PANE_DOCUMENT,
    activeSlot: 0,
    chooser: null,
    shown: null,
    chatSession: null,
    pickedSession: null,
    questionHold: null,
  });
  useBarGeometryStore.setState({ hydrated: false, keyboardHeights: {}, layouts: {} });
  await useBarGeometryStore.getState().hydrate();
});

afterEach(async () => {
  await act(() => keyboard.hide(0));
  jest.restoreAllMocks();
  jest.useRealTimers();
});

test('touching the neighbouring terminal and returning never lets its hidden transcript replace the visible chat scroll control', async () => {
  await renderScreen({ stored: stacked(sessionSlot(A), sessionSlot(B)) });
  const { useTranscriptBottomStore } = jest.requireActual('../chat/native/transcript/bottomStore');
  const list = chatInPane(A, 'a').queryAll((node) => typeof node.props.onScroll === 'function', {
    matchDeepestOnly: true,
  })[0];
  expect(list).toBeTruthy();
  await fireEvent.scroll(list, {
    nativeEvent: {
      contentOffset: { x: 0, y: 400 },
      contentSize: { width: 669, height: 3000 },
      layoutMeasurement: { width: 669, height: 350 },
    },
  });
  await settle();
  expect(useTranscriptBottomStore.getState().awayFromBottom).toBe(true);
  const owner = useTranscriptBottomStore.getState().jumpToBottom;
  await tapPane(B);
  const whileTerminalActive = {
    awayFromBottom: useTranscriptBottomStore.getState().awayFromBottom,
    sameOwner: useTranscriptBottomStore.getState().jumpToBottom === owner,
  };
  await tapPane(A);
  const returnedToChat = {
    awayFromBottom: useTranscriptBottomStore.getState().awayFromBottom,
    sameOwner: useTranscriptBottomStore.getState().jumpToBottom === owner,
  };
  expect(whileTerminalActive).toEqual({ awayFromBottom: true, sameOwner: true });
  expect(returnedToChat).toEqual({ awayFromBottom: true, sameOwner: true });
});
