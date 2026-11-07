/// <reference types="jest" />
/**
 * Run with `bun run test:jest src/screens/TerminalScreen.infoPanes.rntl.tsx`. The agents, attention list and usage
 * panes on the terminal screen of the iPhone Duo's inner display, rendered under the real `VerticalBarArea` as
 * `TerminalScreen.paneTypes.rntl.tsx` does. Real are the screen, the pane host, the pane bodies (the agents list, the
 * Notifications screen's `AttentionList`, the usage view and its meters), the deep link route a
 * question takes, the Usage screen, and the pane, terminal, settings, inventory, machine and attention feed stores;
 * mocked are the boundaries only: the native module (its terminal view a stand-in that shows its props), gxserver's
 * answers (`sessionChatRpc`: the accounts and their usage), the hidden core page's bridge answer,
 * the feed's writes and reads on the computer, haptics, storage, the safe area, navigation and the chat screen.
 * The swipe back runs in the app's real navigation container
 * and native stack, only the native screen host a stand-in that keeps what the stack hands each screen.
 *
 * Covered: each type's entry from the chooser and from the title's pane type menu; what each shows; the other slot
 * keeping its content and its terminal; a session from the agents pane or a row of the attention list opening in the
 * session pane; a question opening the chat view full screen and the panes coming back with the terminal view and with
 * the screen's Back control (a chat reached another way keeping Back to Sessions), the stack's swipe back not offered
 * while that chat view stands (also when the pad, lifted as it opened, is let go during it; offered again after it,
 * and for a chat reached another way); the usage pane naming its
 * computer and keeping it while sessions of another computer are selected, its refresh, its unavailable login, its
 * failure, answers and failures slower than its poll, no read after it closes, and saved accounts that are all turned
 * off; the layout stored within version 1 and brought back after a restart; closing; folding with such a pane active
 * opening its content full screen, the agents' Sessions screen on the agents pane's computer; half folded like a book,
 * their rows and the usage head beside the fold.
 *
 * Device-only, not shown here: how the panes look, the edge swipe itself on the device (here the setting the stack hands
 * the native screen and the stack's own dismissal handler), and the numbers next to the chat's own Accounts panel on a
 * computer.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ReactNode } from 'react';
import { AccessibilityInfo, Dimensions, StyleSheet, View } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';

import type { BarLayout, FoldDivision } from '../../modules/ghostex-native/src/GhostexNative.types';
import { sessionDeepLink } from '../app/deepLinkHandler';
import type * as DeepLinksModule from '../app/deepLinks';
import { keyboardFixture } from '../components/common/keyboard/keyboardEventFixtures';
import { AccountsPanel, UsageRow } from '../chat/native/composer/AccountsPanel';
import { transcriptThemeFor } from '../chat/native/transcript/theme';
import { wasmCoreBridge, type WasmCoreRequest } from '../chat/rust/wasm-core/bridge';
import { FoldListFrame } from '../components/common/foldGap';
import { useBarGeometryStore } from '../components/common/verticalBar/barGeometry';
import { LaptopFoldProvider } from '../components/common/verticalBar/laptopFold';
import VerticalBarArea from '../components/common/verticalBar/VerticalBarArea';
import { parseMobileSummary, type GhostexMobileSummary } from '../contract/mobileSummary';
import { DuoChromeCopy, PanesCopy, TerminalHeaderCopy, UsageCopy } from '../copy';
import { emptyMachineInventory, useInventoryStore, type MachineInventory } from '../inventory/store';
import { useMachinesStore, type MachineRecord } from '../machines/store';
import type { RootStackParamList } from '../navigation/types';
import type { FeedRow } from '../notifications/feedContract';
import {
  markAttentionRowsRead,
  refreshAttentionFeeds,
  updateAttentionFeed,
  useAttentionFeedStore,
} from '../notifications/feedStore';
import { PANE_TITLE_HEIGHT } from '../panes/geometry';
import { SINGLE_PANE_DOCUMENT, type PaneLayout, type PaneLayoutDocument } from '../panes/layout';
import type { PaneEntry } from '../panes/resolve';
import { initPaneLayouts, PANE_LAYOUT_STORAGE_KEY, usePaneStore } from '../panes/store';
import { DEFAULT_COMMAND_PAD_KEYS } from '../settings/commandPad';
import { useSettingsStore } from '../settings/store';
import { attachSessionKey, useTerminalStore, type TerminalTab } from '../terminal/sessions';
import TerminalScreen from './TerminalScreen';
import UsageScreen from './UsageScreen';

const mockNative = {
  focusTerminal: jest.fn((_sessionKey: string): Promise<boolean> => Promise.resolve(true)),
  blurTerminal: jest.fn((_sessionKey: string) => Promise.resolve()),
  openTerminal: jest.fn((_sessionKey: string, _machineId: string, _opts: object) => Promise.resolve()),
};
let mockBarLayout: BarLayout | null = null;
let mockReport: ((layout: BarLayout) => void) | null = null;
/** Each terminal view's mount and unmount, in order: a remount shows here. */
const mockMounts: string[] = [];

jest.mock('../../modules/ghostex-native/src', () => {
  const { View: MockView } = jest.requireActual('react-native');
  const React = jest.requireActual('react');
  function MockTerminalView(props: { sessionKey: string }) {
    React.useEffect(() => {
      mockMounts.push(`mount ${props.sessionKey}`);
      return () => {
        mockMounts.push(`unmount ${props.sessionKey}`);
      };
    }, [props.sessionKey]);
    return React.createElement(MockView, { testID: 'terminal-view', ...props });
  }
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
    GhostexTerminalView: MockTerminalView,
  };
});
jest.mock('../inventory/client', () => ({
  ...jest.requireActual('../inventory/client'),
  ensureConnected: () => Promise.resolve(),
}));
jest.mock('../remote/commands', () => ({
  remoteTerminalCommand: (_machineId: string, command: string) => Promise.resolve(command),
  remoteShellCommand: () => Promise.resolve(null),
}));
jest.mock('../machines/credentials', () => ({
  ...jest.requireActual('../machines/credentials'),
  hasPassword: () => Promise.resolve(false),
}));
jest.mock('../webPreview/machineLinks', () => ({
  ...jest.requireActual('../webPreview/machineLinks'),
  holdComputerForward: () => undefined,
  releaseComputerForward: () => Promise.resolve(),
}));
// gxserver's answers: the computer's accounts with their usage (`agentAccounts`), or a failure.
type Answer = { result: unknown; error: { code: string | null; message: string; endpoint: string } | null };
const mockRpcCalls: { machineId: string; method: string; params: Record<string, unknown> }[] = [];
let mockAccounts: Answer = { result: { accounts: [] }, error: null };
/** When set, gives each `agentAccounts` answer instead (for answers that come late, as the wire's can). */
let mockAccountsAnswer: (() => Promise<Answer>) | null = null;
jest.mock('../chat/rust/transport', () => ({
  ...jest.requireActual('../chat/rust/transport'),
  sessionChatRpc: (machine: { id: string }, method: string, params: Record<string, unknown>): Promise<Answer> => {
    mockRpcCalls.push({ machineId: machine.id, method, params });
    if (method === 'agentAccounts') return mockAccountsAnswer?.() ?? Promise.resolve(mockAccounts);
    return Promise.resolve({ result: { entries: [] }, error: null });
  },
}));
// The bundled page owns projection. Return its columns, not a second projection in this fixture.
let mockColumns: unknown = [];
jest.mock('../chat/rust/wasm-core/bridge', () => ({
  wasmCoreBridge: {
    call: jest.fn((request: WasmCoreRequest) => {
      if (request.op !== 'accountUsageColumns') return Promise.reject(new Error(`Unexpected op: ${request.op}`));
      return Promise.resolve(mockColumns);
    }),
  },
}));
// The feed's writes and reads on the computer; the list itself comes from the real feed store.
jest.mock('../notifications/feedStore', () => ({
  ...jest.requireActual('../notifications/feedStore'),
  updateAttentionFeed: jest.fn(() => Promise.resolve(true)),
  markAttentionRowsRead: jest.fn(() => Promise.resolve(true)),
  refreshAttentionFeeds: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-notifications', () => ({}));
jest.mock('../components/sessions/cli', () => ({
  ...jest.requireActual('../components/sessions/cli'),
  runGhostexCli: () => Promise.reject(new Error('no cli')),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-haptics', () => ({
  impactAsync: () => Promise.resolve(),
  notificationAsync: () => Promise.resolve(),
  selectionAsync: () => Promise.resolve(),
  performAndroidHapticsAsync: () => Promise.resolve(),
  AndroidHaptics: { Keyboard_Tap: 'keyboard-tap', Context_Click: 'context-click' },
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy', Rigid: 'rigid' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
jest.mock('react-native-safe-area-context', () => {
  const { View: MockView } = jest.requireActual('react-native');
  return {
    // The library's own test stand-in for what the navigation container reads; the screen's insets as before.
    ...jest.requireActual('react-native-safe-area-context/jest/mock').default,
    SafeAreaView: MockView,
    useSafeAreaInsets: () => ({ top: 80, bottom: 20, left: 0, right: 0 }),
  };
});
jest.mock('../chat/native/NativeChatScreen', () => ({ __esModule: true, default: () => null }));
jest.mock('../voice/VoiceButton', () => ({ VoiceButton: () => null }));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
  useFocusEffect: () => undefined,
  useNavigation: () => ({ navigate: () => undefined, setOptions: () => undefined }),
  useRoute: () => ({ key: 'terminal' }),
}));
/** What the native stack hands each of its screens (its swipe back, its dismissal callback), by route key. */
type NativeScene = {
  screenId: string;
  gestureEnabled?: boolean;
  preventNativeDismiss?: boolean;
  onDismissed: (event: { nativeEvent: { dismissCount: number } }) => void;
  children?: ReactNode;
};
const mockNativeScenes = new Map<string, NativeScene>();
// The native screen host only: the real native stack navigator renders into it.
jest.mock('react-native-screens', () => {
  const React = jest.requireActual('react');
  const { View: MockView } = jest.requireActual('react-native');
  return {
    ...jest.requireActual('react-native-screens'),
    ScreenStack: MockView,
    ScreenStackItem: (props: NativeScene) => {
      mockNativeScenes.set(props.screenId, props);
      React.useEffect(() => () => mockNativeScenes.delete(props.screenId), [props.screenId]);
      return React.createElement(MockView, { testID: `native-scene:${props.screenId}` }, props.children);
    },
  };
});

type Window = { width: number; height: number };
type Rect = { x: number; y: number; width: number; height: number };

const UPRIGHT: Window = { width: 669, height: 951 };
const HOME = 20;
const AREA_TOP = 82;
const areaOf = (window: Window): Rect => ({
  x: 0,
  y: AREA_TOP,
  width: window.width,
  height: window.height - HOME - AREA_TOP,
});
const FLAT_UPRIGHT: FoldDivision = { x: 0, y: 455.5, width: 669, height: 40, active: false };
/** Half folded like a laptop. */
const LAPTOP: FoldDivision = { ...FLAT_UPRIGHT, active: true };
const TOGGLE = 'Command pad';
/** The chat core test's clock (`native_accounts.rs`). */
const NOW = 1_800_000_000_000;
const MINUTE = 60_000;

const MAC: MachineRecord = {
  id: 'm1',
  name: 'Mac',
  host: 'mac.local',
  username: 'me',
  port: 22,
  savePassword: false,
  lastConnectedAt: null,
};
const LINUX: MachineRecord = { ...MAC, id: 'm2', name: 'Linux box', host: 'linux.local' };

function attachTab(machineId: string, sessionId: string, title: string, projectId: string): TerminalTab {
  return {
    sessionKey: attachSessionKey(machineId, sessionId),
    machineId,
    title,
    kind: 'attach',
    ghostexSessionId: sessionId,
    ghostexProjectId: projectId,
    state: 'open',
  };
}

const ALPHA = attachTab('m1', 'a', 'Alpha', 'p1');
const BETA = attachTab('m1', 'b', 'Beta', 'p1');
const XRAY = attachTab('m2', 'x', 'Xray', 'p3');
const A = ALPHA.sessionKey;
const B = BETA.sessionKey;
const C = attachSessionKey('m1', 'c');
const D = attachSessionKey('m1', 'd');
const X = XRAY.sessionKey;

/** A session on the wire, as the computer's summary sends it. */
function summarySession(
  sessionId: string,
  displayTitle: string,
  projectId: string,
  projectName: string,
  state: Partial<{ activity: string; pendingQuestionCount: number; awaitingAnswer: boolean; awaitingApproval: boolean }> = {},
) {
  return {
    sessionId,
    projectId,
    projectName,
    displayTitle,
    provider: 'zmx',
    agent: 'Codex',
    agentName: 'Codex',
    agentIcon: 'codex',
    activity: 'idle',
    status: 'running',
    isLive: true,
    ...state,
  };
}

/** The computer's session list as the inventory reads it (`parseMobileSummary`); no workspaces, as a daemon without. */
function mobileSummary(wire: object): GhostexMobileSummary {
  const summary = parseMobileSummary(JSON.stringify(wire));
  if (summary === null) throw new Error('the fixture is not a mobile summary');
  return summary;
}

function inventory(summary: GhostexMobileSummary): MachineInventory {
  return { ...emptyMachineInventory(), summary };
}

const PROJECTS = [
  { projectId: 'p1', name: 'ghostex-mobile', path: '/Users/me/ghostex-mobile' },
  { projectId: 'p2', name: 'pad-lab', path: '/Users/me/pad-lab' },
];
const SESSIONS = [
  summarySession('a', 'Alpha', 'p1', 'ghostex-mobile'),
  summarySession('b', 'Beta', 'p1', 'ghostex-mobile', { activity: 'working' }),
  summarySession('c', 'Gamma', 'p2', 'pad-lab', { activity: 'attention', pendingQuestionCount: 1 }),
  summarySession('d', 'Delta', 'p2', 'pad-lab', { activity: 'attention' }),
];
const SUMMARY = mobileSummary({ projects: PROJECTS, sessions: SESSIONS });
const LINUX_SUMMARY = mobileSummary({
  projects: [{ projectId: 'p3', name: 'lab', path: '/home/me/lab' }],
  sessions: [summarySession('x', 'Xray', 'p3', 'lab')],
});

/** The Mac's accounts: a Claude login with two usage windows and a Codex login that reports none. */
const ACCOUNTS = {
  accounts: [
    {
      id: 'work',
      provider: 'claude',
      name: 'Work',
      email: 'work@example.com',
      registered: true,
      userDisabled: false,
      status: 'ready',
      usage: [
        {
          id: 'fiveHour',
          label: '5h',
          usedPercent: 16.4,
          limitWindowSeconds: 18_000,
          resetsAt: new Date(NOW + (2 * 60 + 36) * MINUTE).toISOString(),
        },
        {
          id: 'sevenDay',
          label: '7d',
          usedPercent: 40,
          limitWindowSeconds: 604_800,
          resetsAt: new Date(NOW + (5 * 24 + 4) * 60 * MINUTE).toISOString(),
        },
      ],
    },
    {
      id: 'spare',
      provider: 'codex',
      name: 'Spare',
      email: 'spare@example.com',
      registered: true,
      userDisabled: false,
      status: 'unavailable',
      usage: [],
    },
  ],
};

const COLUMNS = [
  {
    id: 'work',
    usage: [
      { label: '5h: 16%', name: '5h', value: '16%', percent: 16.4, reset: 'Resets 2h 36m', resetIn: '2h 36m' },
      { label: '7d: 40%', name: '7d', value: '40%', percent: 40, reset: 'Resets 5d 4h', resetIn: '5d 4h' },
    ],
  },
  { id: 'spare', usage: [] },
];

function feedRow(id: string, sessionId: string, kind: FeedRow['kind'], read = false): FeedRow {
  return {
    id,
    projectId: 'p2',
    sessionId,
    kind,
    title: 'Session',
    subtitle: 'pad-lab',
    agentName: 'codex',
    createdAt: new Date(NOW - Number(id.slice(1)) * MINUTE).toISOString(),
    read,
  };
}

function layout(first: PaneLayout['first'], second: PaneLayout['second'], dividerRatio = 0.5): PaneLayoutDocument {
  return { schemaVersion: 1, layouts: { stacked: { first, second, dividerRatio } } };
}
const session = (sessionKey: string) => ({ paneType: 'session', sessionKey }) as const;
const AGENTS = { paneType: 'agents' } as const;
const ATTENTION = { paneType: 'attention' } as const;
const usage = (origin: string) => ({ paneType: 'usage', sessionKey: origin }) as const;

const navigation = { setOptions: jest.fn(), popTo: jest.fn(), navigate: jest.fn(), push: jest.fn() };
const keyboard = keyboardFixture(UPRIGHT);
const initialSettings = useSettingsStore.getState().settings;
let areaView: TestInstance | null = null;

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

type Setup = { divisions?: FoldDivision[]; tabs?: TerminalTab[]; selected?: string; stored?: PaneLayoutDocument };

/** The app starting with `stored` in storage, as `TerminalScreen.paneTypes.rntl.tsx` renders it. */
async function renderScreen({
  divisions = [FLAT_UPRIGHT],
  tabs = [ALPHA, BETA, XRAY],
  selected = A,
  stored,
}: Setup = {}): Promise<void> {
  mockBarLayout = barLayout(UPRIGHT, divisions);
  await act(() => {
    keyboard.setScreen(UPRIGHT.width, UPRIGHT.height);
    Dimensions.set({ window: { ...UPRIGHT, scale: 3, fontScale: 1 }, screen: { ...UPRIGHT, scale: 3, fontScale: 1 } });
  });
  if (stored !== undefined) await AsyncStorage.setItem(PANE_LAYOUT_STORAGE_KEY, JSON.stringify(stored));
  useTerminalStore.setState({
    tabs,
    selectedSessionKey: selected,
    paneSessionKey: null,
    warmOrder: tabs.map((tab) => tab.sessionKey),
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
  areaView = screen.getAllByTestId('terminal-view')[0].parent;
  await layOut(areaOf(UPRIGHT));
  await act(() => usePaneStore.getState().hydrate());
  await settle();
}

async function layOut(area: Rect): Promise<void> {
  if (areaView === null) throw new Error('no terminal area');
  await fireEvent(areaView, 'layout', { nativeEvent: { layout: area } });
}

/** Folded or unfolded: the bar layout's report of the fold's divisions, the window keeping its size. */
async function changeDivisions(divisions: FoldDivision[]): Promise<void> {
  await act(async () => {
    mockReport?.(barLayout(UPRIGHT, divisions));
  });
  await layOut(areaOf(UPRIGHT));
  await settle();
}

async function settle(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await act(async () => undefined);
}

async function press(label: string | RegExp): Promise<void> {
  await fireEvent.press(screen.getByLabelText(label));
  await settle();
}

/** Time passing in steps of at most 10 s, each one's timers, answers and renders done before the next. */
async function advance(ms: number): Promise<void> {
  for (let left = ms; left > 0; left -= 10_000) {
    await act(async () => {
      jest.advanceTimersByTime(Math.min(10_000, left));
    });
    await settle();
  }
}

/** The accounts' answer `answer` after `ms`, as a slow computer or the route's time limit gives it. */
function answerAfter(ms: number, answer: Answer, onAnswer?: () => void): () => Promise<Answer> {
  return () => {
    const { promise, resolve } = Promise.withResolvers<Answer>();
    setTimeout(() => {
      onAnswer?.();
      resolve(answer);
    }, ms);
    return promise;
  };
}

function shownSessions(): string[] {
  return screen.getAllByTestId('terminal-view').map((view) => String(view.props.sessionKey));
}

function pane(key: string): TestInstance {
  return screen.getByTestId(`pane:${key}`);
}

function storedStacked(): PaneLayout | undefined {
  return usePaneStore.getState().document.layouts.stacked;
}

async function storageHolds(): Promise<unknown> {
  const raw = await AsyncStorage.getItem(PANE_LAYOUT_STORAGE_KEY);
  return raw === null ? null : JSON.parse(raw);
}

/** A touch that starts in a pane: the card notes every touch that starts in it. */
async function touchPane(key: string): Promise<void> {
  const point = { pageX: 10, pageY: 10, locationX: 0, locationY: 0, identifier: 0, target: 1, timestamp: 0 };
  await fireEvent(pane(key), 'touchStart', { nativeEvent: { ...point, touches: [point], changedTouches: [point] } });
  await settle();
}

/**
 * A list in a pane gets no laptop fold (`FoldListFrame` with `fold={null}`, its screen's guard), though the window is
 * half folded like a laptop: each list frame in the pane keeps the pane's whole height (no fold inset) and measures
 * nothing. While `show` runs a frame measurement answers the whole window, which crosses the fold, so a fold passed
 * into the pane would show as an inset. The laptop fold is read where the pane stands (the `LaptopFoldProvider` above
 * it), the frames' fold through React's fiber (the test renderer keeps host views only).
 */
async function expectPaneListsWithoutFold(key: string, show: () => Promise<void>): Promise<void> {
  const nativeMethods = jest.requireActual<{ default: { measureInWindow: jest.Mock } }>(
    '@react-native/jest-preset/jest/MockNativeMethods',
  ).default;
  nativeMethods.measureInWindow.mockImplementation((onFrame: (...frame: number[]) => void) =>
    onFrame(0, 0, UPRIGHT.width, UPRIGHT.height),
  );
  try {
    await show();
    expect(propsAbove(pane(key), LaptopFoldProvider)?.value).toEqual(expect.objectContaining({ top: LAPTOP.y }));
    const frames = pane(key).queryAll((node) => propsAbove(node, FoldListFrame, 3) !== null);
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) {
      expect(propsAbove(frame, FoldListFrame, 3)?.fold).toBeNull();
      expect(StyleSheet.flatten(frame.props.style)?.paddingBottom).toBeUndefined();
      const measured = nativeMethods.measureInWindow.mock.contexts.filter(
        (context: { props?: { onLayout?: unknown } } | undefined) => context?.props?.onLayout === frame.props.onLayout,
      );
      expect(measured).toHaveLength(0);
    }
  } finally {
    nativeMethods.measureInWindow.mockReset();
  }
}

/** The props of the nearest component of `type` above `node` (at most `depth` components up), through React's fiber. */
function propsAbove(node: TestInstance, type: unknown, depth = Infinity): Record<string, unknown> | null {
  let fiber = node.unstable_fiber?.return ?? null;
  for (let step = 0; fiber !== null && step < depth; step += 1, fiber = fiber.return) {
    if (fiber.type === type) return fiber.memoizedProps as Record<string, unknown>;
  }
  return null;
}

/** The title's window frame anchors the type menu (the test renderer measures nothing by itself). */
function measuredTitles(): () => void {
  const nativeMethods = jest.requireActual<{ default: { measureInWindow: jest.Mock } }>(
    '@react-native/jest-preset/jest/MockNativeMethods',
  ).default;
  nativeMethods.measureInWindow.mockImplementation((onFrame: (...frame: number[]) => void) =>
    onFrame(60, 82, 200, PANE_TITLE_HEIGHT),
  );
  return () => nativeMethods.measureInWindow.mockReset();
}

/** A command of the open pane type menu, by its label (a pane's title may show the same words). */
function menuItem(label: string): TestInstance {
  for (const text of screen.getAllByText(label)) {
    for (let node: TestInstance | null = text; node !== null; node = node.parent) {
      const state = node.props.accessibilityState as { disabled?: boolean; expanded?: boolean } | undefined;
      if (state?.disabled !== undefined && state.expanded === undefined) return node;
    }
  }
  throw new Error(`no menu command ${label}`);
}

function barTitle(key: string, title: string, typeLabel: string): TestInstance {
  return within(screen.getByTestId(`pane-bar:${key}`)).getByLabelText(PanesCopy.title(title, typeLabel));
}

/** The chooser in the agents pane's slot, beside the session pane: the agents pane's type menu set to Session. */
async function chooserForAgentsPane(): Promise<void> {
  const restore = measuredTitles();
  try {
    await press(PanesCopy.title(PanesCopy.agentsType, PanesCopy.agentsType));
    await fireEvent.press(menuItem(PanesCopy.sessionType));
    await settle();
  } finally {
    restore();
  }
}

beforeAll(() => {
  initPaneLayouts();
});

beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  Object.values(mockNative).forEach((mock) => mock.mockClear());
  mockMounts.length = 0;
  mockRpcCalls.length = 0;
  mockAccounts = { result: ACCOUNTS, error: null };
  mockAccountsAnswer = null;
  mockColumns = COLUMNS;
  jest.mocked(wasmCoreBridge.call).mockClear();
  mockReport = null;
  areaView = null;
  Object.values(navigation).forEach((mock) => mock.mockClear());
  jest.mocked(updateAttentionFeed).mockClear();
  jest.mocked(markAttentionRowsRead).mockClear();
  jest.mocked(refreshAttentionFeeds).mockClear();
  useSettingsStore.setState({
    hydrated: true,
    settings: {
      ...initialSettings,
      extraKeysToolbarVisible: true,
      commandPadKeys: [...DEFAULT_COMMAND_PAD_KEYS],
      commandPadPosition: {},
      preferredAgentInterface: 'terminal',
    },
  });
  useTerminalStore.setState({ hydrated: true, sessionViewModeBySessionKey: {} });
  useMachinesStore.setState({ hydrated: true, machines: [MAC, LINUX] });
  useInventoryStore.setState({
    inventoriesByMachineId: { m1: inventory(SUMMARY), m2: inventory(LINUX_SUMMARY) },
  });
  useAttentionFeedStore.setState({
    feeds: {
      m1: {
        status: 'ready',
        rows: [feedRow('n1', 'c', 'needsInput'), feedRow('n2', 'd', 'finished'), feedRow('n3', 'b', 'finished', true)],
      },
      m2: { status: 'ready', rows: [] },
    },
    permission: 'granted',
  });
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockImplementation(() => Promise.resolve(false));
  await AsyncStorage.clear();
  usePaneStore.setState({
    hydrated: false,
    document: SINGLE_PANE_DOCUMENT,
    activeSlot: null,
    chooser: null,
    shown: null,
    browserPage: null,
  });
  useBarGeometryStore.setState({ hydrated: false, keyboardHeights: {}, layouts: {} });
  await useBarGeometryStore.getState().hydrate();
});

afterEach(async () => {
  await act(() => keyboard.hide(0));
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('entry: the chooser and the pane type menu offer Agents, Usage and Attention', () => {
  test('the chooser lists them; Agents fills the second pane, the first keeps its terminal', async () => {
    await renderScreen({ stored: undefined });
    await press(PanesCopy.addPane);
    mockMounts.length = 0;
    for (const [type, description] of [
      [PanesCopy.agentsType, PanesCopy.agentsTypeDescription],
      [PanesCopy.usageType, PanesCopy.usageTypeDescription],
      [PanesCopy.attentionType, PanesCopy.attentionTypeDescription],
    ]) {
      expect(screen.getByLabelText(`${type}, ${description}`)).toBeTruthy();
    }
    await press(`${PanesCopy.agentsType}, ${PanesCopy.agentsTypeDescription}`);

    expect(shownSessions()).toEqual([A]);
    expect(mockMounts).toEqual([]);
    expect(storedStacked()).toEqual({ first: session(A), second: AGENTS, dividerRatio: 0.5 });
    expect(await storageHolds()).toEqual(layout(session(A), AGENTS));
    expect(barTitle('agents', PanesCopy.agentsType, PanesCopy.agentsType)).toBeTruthy();
    // The pane picked is the active one: no pad, as its keys would reach no terminal.
    expect(screen.queryByLabelText(TOGGLE)).toBeNull();
  });

  test('the title menu sets the second session pane to Usage of its session’s computer; the first stays', async () => {
    const restore = measuredTitles();
    try {
      await renderScreen({ stored: layout(session(A), session(B)) });
      await touchPane(B);
      mockMounts.length = 0;
      await press(PanesCopy.title('Beta', PanesCopy.sessionType));
      await fireEvent.press(menuItem(PanesCopy.usageType));
      await settle();
    } finally {
      restore();
    }
    expect(shownSessions()).toEqual([A]);
    expect(mockMounts).toEqual([`unmount ${B}`]);
    expect(useTerminalStore.getState().selectedSessionKey).toBe(A);
    expect(storedStacked()).toEqual({ first: session(A), second: usage(B), dividerRatio: 0.5 });
    expect(barTitle(`usage:${B}`, UsageCopy.title('Mac'), PanesCopy.usageType)).toBeTruthy();
  });
});

describe('agents: the computer’s sessions with their status', () => {
  test.each([true, false])('an open question card follows the computer capability (%s) in both pane lists', async (announced) => {
    const summary = mobileSummary({
      capabilities: { awaitingAnswer: announced },
      projects: PROJECTS,
      sessions: [
        ...SESSIONS,
        summarySession('ask', 'Open question', 'p2', 'pad-lab', { awaitingAnswer: true }),
      ],
    });
    useInventoryStore.setState({ inventoriesByMachineId: { [MAC.id]: inventory(summary) } });
    await renderScreen({ stored: layout(session(A), AGENTS) });
    const status = announced ? 'Has a question' : 'Idle';
    expect(within(pane('agents')).getByLabelText(`Open question, Codex · ${status}`)).toBeTruthy();
    expect(within(pane('agents')).getByText(PanesCopy.agentsChip.question(announced ? 2 : 1))).toBeTruthy();
    await chooserForAgentsPane();
    expect(screen.getByLabelText(`Open question, Codex · pad-lab · ${status}`)).toBeTruthy();
  });

  test('approval wins over counted and open-card questions in both pane lists and their counts', async () => {
    const summary = mobileSummary({
      capabilities: { awaitingAnswer: true },
      projects: PROJECTS,
      sessions: [...SESSIONS, summarySession('approve', 'Approval pending', 'p2', 'pad-lab', {
        awaitingApproval: true, awaitingAnswer: true, pendingQuestionCount: 1,
      })],
    });
    useInventoryStore.setState({ inventoriesByMachineId: { [MAC.id]: inventory(summary) } });
    await renderScreen({ stored: layout(session(A), AGENTS) });
    expect(within(pane('agents')).getByLabelText('Approval pending, Codex · Waiting for approval')).toBeTruthy();
    expect(within(pane('agents')).getByText(PanesCopy.agentsChip.question(1))).toBeTruthy();
    await chooserForAgentsPane();
    expect(screen.getByLabelText('Approval pending, Codex · pad-lab · Waiting for approval')).toBeTruthy();
  });

  test('the counts, the sessions by project with their status in words', async () => {
    await renderScreen({ stored: layout(session(A), AGENTS) });
    const agents = within(pane('agents'));
    expect(agents.getByLabelText(PanesCopy.agentsSummary)).toBeTruthy();
    for (const chip of [
      PanesCopy.agentsChip.question(1),
      PanesCopy.agentsChip.working(1),
      PanesCopy.agentsChip.done(1),
    ]) {
      expect(agents.getByText(chip)).toBeTruthy();
    }
    expect(agents.queryByText(PanesCopy.agentsChip.failed(0))).toBeNull();
    expect(agents.getByText('ghostex-mobile')).toBeTruthy();
    expect(agents.getByText('pad-lab')).toBeTruthy();
    for (const label of [
      'Alpha, Codex · Idle',
      'Beta, Codex · Working',
      'Gamma, Codex · Has a question',
      'Delta, Codex · Done',
    ]) {
      expect(agents.getByLabelText(label)).toBeTruthy();
    }
    expect(shownSessions()).toEqual([A]);
  });

  test('a session tapped opens in the session pane as a terminal; the agents pane stays', async () => {
    useTerminalStore.setState({ sessionViewModeBySessionKey: { [D]: 'chat' } });
    await renderScreen({ stored: layout(session(A), AGENTS) });
    await fireEvent.press(within(pane('agents')).getByLabelText('Delta, Codex · Done'));
    await settle();
    expect(useTerminalStore.getState().selectedSessionKey).toBe(D);
    // The terminal is the pane's only: the session's own saved view stays.
    expect(useTerminalStore.getState().sessionViewModeBySessionKey[D]).toBe('chat');
    expect(shownSessions()).toEqual([D]);
    expect(storedStacked()).toEqual({ first: session(D), second: AGENTS, dividerRatio: 0.5 });
    expect(pane('agents')).toBeTruthy();
  });

  test('it lists the selected session’s computer, also after a session of another computer is selected', async () => {
    await renderScreen({ stored: layout(session(A), AGENTS) });
    await act(() => useTerminalStore.getState().selectTab(X, { scrollToBottom: false }));
    await settle();
    expect(shownSessions()).toEqual([X]);
    expect(within(pane('agents')).getByLabelText('Xray, Codex · Idle')).toBeTruthy();
    expect(within(pane('agents')).queryByLabelText('Alpha, Codex · Idle')).toBeNull();
  });
});

describe('attention: the Notifications screen’s list beside the session', () => {
  test('the list is read when the pane comes into view; a row opens its session in the pane beside', async () => {
    await renderScreen({ stored: layout(session(A), ATTENTION) });
    expect(refreshAttentionFeeds).toHaveBeenCalled();
    const list = within(pane('attention'));
    // One row per session that needs the user (c has a question, d waits); b's read row shows nothing.
    expect(list.getByTestId('attention-row-c')).toBeTruthy();
    expect(list.getByTestId('attention-row-d')).toBeTruthy();
    expect(list.queryByTestId('attention-row-b')).toBeNull();

    await fireEvent.press(list.getByTestId('attention-row-d'));
    await settle();
    expect(markAttentionRowsRead).toHaveBeenCalledWith('m1', ['n2']);
    expect(useTerminalStore.getState().selectedSessionKey).toBe(D);
    expect(shownSessions()).toEqual([D]);
    expect(storedStacked()).toEqual({ first: session(D), second: ATTENTION, dividerRatio: 0.5 });
  });

  test('a question opens the chat view full screen at once; back in the terminal view the panes are as before', async () => {
    await renderScreen({ stored: layout(session(A), ATTENTION, 0.4) });
    await fireEvent.press(within(pane('attention')).getByTestId('attention-row-c'));
    // At once: the session is in the computer's list, so no question card can come late.
    expect(useTerminalStore.getState().selectedSessionKey).toBe(C);
    expect(useTerminalStore.getState().sessionViewModeBySessionKey[C]).toBe('chat');
    await settle();
    expect(screen.queryByTestId('pane:attention')).toBeNull();
    expect(storedStacked()).toEqual({ first: session(A), second: ATTENTION, dividerRatio: 0.4 });

    // The chat view's switch to the terminal (`onSwitchToTerminal`).
    await act(() => useTerminalStore.getState().setSessionViewMode(C, 'terminal'));
    await settle();
    expect(pane('attention')).toBeTruthy();
    expect(shownSessions()).toEqual([C]);
    expect(storedStacked()).toEqual({ first: session(C), second: ATTENTION, dividerRatio: 0.4 });
    // The session that was beside the list is one tab away, and with it the arrangement as it was.
    await act(() => useTerminalStore.getState().selectTab(A, { scrollToBottom: false }));
    await settle();
    expect(storedStacked()).toEqual({ first: session(A), second: ATTENTION, dividerRatio: 0.4 });
  });

  test('Back in a question’s chat view opened here goes back to the panes as they were, not to Sessions', async () => {
    await renderScreen({ stored: layout(session(A), ATTENTION, 0.37) });
    await fireEvent.press(within(pane('attention')).getByTestId('attention-row-c'));
    await settle();
    expect(useTerminalStore.getState().selectedSessionKey).toBe(C);
    expect(screen.queryByTestId('pane:attention')).toBeNull();

    await press(DuoChromeCopy.back);
    expect(navigation.popTo).not.toHaveBeenCalled();
    expect(pane('attention')).toBeTruthy();
    expect(useTerminalStore.getState().selectedSessionKey).toBe(A);
    expect(shownSessions()).toEqual([A]);
    expect(storedStacked()).toEqual({ first: session(A), second: ATTENTION, dividerRatio: 0.37 });
    // Back in the terminal view is the terminal screen's own again.
    await press(DuoChromeCopy.back);
    expect(navigation.popTo).toHaveBeenCalledWith('Sessions');
  });

  test('Back after a question about the session beside the list shows that session’s terminal with the panes', async () => {
    useInventoryStore.setState({
      inventoriesByMachineId: {
        m1: inventory(
          mobileSummary({
            projects: PROJECTS,
            sessions: SESSIONS.map((entry) =>
              entry.sessionId === 'a' ? { ...entry, activity: 'attention', pendingQuestionCount: 1 } : entry,
            ),
          }),
        ),
        m2: inventory(LINUX_SUMMARY),
      },
    });
    useAttentionFeedStore.setState((state) => ({
      feeds: { ...state.feeds, m1: { status: 'ready', rows: [feedRow('n6', 'a', 'needsInput')] } },
    }));
    await renderScreen({ stored: layout(session(A), ATTENTION, 0.37) });
    await fireEvent.press(within(pane('attention')).getByTestId('attention-row-a'));
    await settle();
    expect(useTerminalStore.getState().sessionViewModeBySessionKey[A]).toBe('chat');
    expect(screen.queryByTestId('pane:attention')).toBeNull();

    await press(DuoChromeCopy.back);
    expect(navigation.popTo).not.toHaveBeenCalled();
    expect(useTerminalStore.getState().sessionViewModeBySessionKey[A]).toBe('terminal');
    expect(pane('attention')).toBeTruthy();
    expect(shownSessions()).toEqual([A]);
    expect(storedStacked()).toEqual({ first: session(A), second: ATTENTION, dividerRatio: 0.37 });
  });

  test('a chat left another way, or a question opened from a notification, keeps Back to Sessions', async () => {
    await renderScreen({ stored: layout(session(A), ATTENTION, 0.37) });
    await fireEvent.press(within(pane('attention')).getByTestId('attention-row-c'));
    await settle();
    // Another session chosen from the chat: the panes are back with it; Back is the terminal screen's own.
    await act(() => useTerminalStore.getState().selectTab(B, { scrollToBottom: false }));
    await settle();
    expect(pane('attention')).toBeTruthy();
    await act(() => useTerminalStore.getState().selectTab(C, { scrollToBottom: false }));
    await settle();
    await press(DuoChromeCopy.back);
    expect(navigation.popTo).toHaveBeenCalledWith('Sessions');

    // A question's notification tapped elsewhere opens the same chat through the same link: Back goes to Sessions.
    navigation.popTo.mockClear();
    await act(() => useTerminalStore.getState().selectTab(A, { scrollToBottom: false }));
    await settle();
    const { openDeepLink } = require('../app/deepLinks') as typeof DeepLinksModule;
    await act(() => openDeepLink(sessionDeepLink({ machineId: 'm1', sessionId: 'c', view: 'question' })));
    await settle();
    expect(useTerminalStore.getState().selectedSessionKey).toBe(C);
    expect(screen.queryByTestId('pane:attention')).toBeNull();
    await press(DuoChromeCopy.back);
    expect(navigation.popTo).toHaveBeenCalledWith('Sessions');
  });
});

describe('the stack’s swipe back from a chat view (the real navigation container and native stack)', () => {
  const TERMINAL_ROUTE = 'terminal-route';

  /** The app's navigation container and native stack (Sessions under the terminal screen), the app's links bound. */
  async function renderInStack(stored: PaneLayoutDocument): Promise<typeof DeepLinksModule.navigationRef> {
    const Stack = createNativeStackNavigator<RootStackParamList>();
    const nav = (require('../app/deepLinks') as typeof DeepLinksModule).navigationRef;
    mockBarLayout = barLayout(UPRIGHT, [FLAT_UPRIGHT]);
    await act(() => {
      keyboard.setScreen(UPRIGHT.width, UPRIGHT.height);
      Dimensions.set({
        window: { ...UPRIGHT, scale: 3, fontScale: 1 },
        screen: { ...UPRIGHT, scale: 3, fontScale: 1 },
      });
    });
    await AsyncStorage.setItem(PANE_LAYOUT_STORAGE_KEY, JSON.stringify(stored));
    const tabs = [ALPHA, BETA, XRAY];
    useTerminalStore.setState({
      tabs,
      selectedSessionKey: A,
      paneSessionKey: null,
      warmOrder: tabs.map((tab) => tab.sessionKey),
    });
    const initialState = {
      index: 1,
      routes: [
        { key: 'sessions-route', name: 'Sessions' },
        { key: TERMINAL_ROUTE, name: 'Terminal', params: { sessionKey: A, machineId: 'm1' } },
      ],
    };
    await render(
      <VerticalBarArea>
        <NavigationContainer ref={nav} initialState={initialState}>
          <Stack.Navigator>
            <Stack.Screen name="Sessions">{() => <View testID="sessions-screen" />}</Stack.Screen>
            <Stack.Screen name="Terminal" component={TerminalScreen} />
          </Stack.Navigator>
        </NavigationContainer>
      </VerticalBarArea>,
    );
    await settle();
    areaView = screen.getAllByTestId('terminal-view')[0].parent;
    await layOut(areaOf(UPRIGHT));
    await act(() => usePaneStore.getState().hydrate());
    await settle();
    return nav;
  }

  function terminalScene(): NativeScene {
    const scene = mockNativeScenes.get(TERMINAL_ROUTE);
    if (scene === undefined) throw new Error('no terminal screen in the native stack');
    return scene;
  }

  /** A swipe back completed on the device: the stack's own handler of the native dismissal. */
  async function swipeBack(): Promise<void> {
    await act(async () => terminalScene().onDismissed({ nativeEvent: { dismissCount: 1 } }));
    await settle();
  }

  /** A finger holds the session pane's pad toggle until the pad lifts (the toggle's own hold timer runs). */
  async function liftPad(): Promise<void> {
    const point = { pageX: 600, pageY: 600, locationX: 0, locationY: 0, identifier: 0, target: 1 };
    const measure = (callback: (...values: number[]) => void) => callback(0, 0, 44, 44, 578, 578);
    await fireEvent(screen.getByLabelText(TOGGLE), 'responderGrant', {
      persist: () => undefined,
      nativeEvent: { ...point, touches: [point], changedTouches: [point] },
      currentTarget: { measure },
    });
    await act(() => jest.advanceTimersByTime(300));
  }

  test('a question opened from the attention pane offers no swipe back; Back brings the panes and the swipe', async () => {
    const nav = await renderInStack(layout(session(A), ATTENTION, 0.37));
    expect(terminalScene().gestureEnabled).not.toBe(false);
    await fireEvent.press(within(pane('attention')).getByTestId('attention-row-c'));
    await settle();
    expect(useTerminalStore.getState().selectedSessionKey).toBe(C);
    expect(screen.queryByTestId('pane:attention')).toBeNull();
    // The stack's swipe would leave for Sessions past the waiting panes: not offered while this chat view stands.
    expect(terminalScene().gestureEnabled).toBe(false);
    expect(terminalScene().preventNativeDismiss).not.toBe(true);

    await press(DuoChromeCopy.back);
    expect(nav.getCurrentRoute()?.name).toBe('Terminal');
    expect(pane('attention')).toBeTruthy();
    expect(useTerminalStore.getState().selectedSessionKey).toBe(A);
    expect(shownSessions()).toEqual([A]);
    expect(storedStacked()).toEqual({ first: session(A), second: ATTENTION, dividerRatio: 0.37 });
    // With the panes back, the swipe is offered again and leaves for Sessions as before.
    expect(terminalScene().gestureEnabled).not.toBe(false);
    await swipeBack();
    expect(nav.getCurrentRoute()?.name).toBe('Sessions');
  });

  test('that chat view left by its terminal view: the panes and the swipe are back', async () => {
    await renderInStack(layout(session(A), ATTENTION, 0.37));
    await fireEvent.press(within(pane('attention')).getByTestId('attention-row-c'));
    await settle();
    expect(terminalScene().gestureEnabled).toBe(false);
    await press(TerminalHeaderCopy.terminalView);
    expect(pane('attention')).toBeTruthy();
    expect(terminalScene().gestureEnabled).not.toBe(false);
  });

  test('the pad lifted as such a question opens and let go with it keeps the swipe off until the panes are back', async () => {
    await renderInStack(layout(session(A), ATTENTION, 0.37));
    await liftPad();
    expect(terminalScene().gestureEnabled).toBe(false);
    // Another finger opens the question: the chat view stands full screen, and the pad, still lifted, goes with the
    // terminal, which lets it go.
    await fireEvent.press(within(pane('attention')).getByTestId('attention-row-c'));
    await settle();
    expect(useTerminalStore.getState().selectedSessionKey).toBe(C);
    expect(screen.queryByLabelText(TOGGLE)).toBeNull();
    expect(terminalScene().gestureEnabled).toBe(false);
    await press(DuoChromeCopy.back);
    expect(pane('attention')).toBeTruthy();
    expect(terminalScene().gestureEnabled).not.toBe(false);
  });

  test('the terminal screen, and a question opened from a notification, keep the swipe back to Sessions', async () => {
    const nav = await renderInStack(layout(session(A), ATTENTION, 0.37));
    expect(terminalScene().gestureEnabled).not.toBe(false);
    const { openDeepLink } = require('../app/deepLinks') as typeof DeepLinksModule;
    await act(() => openDeepLink(sessionDeepLink({ machineId: 'm1', sessionId: 'c', view: 'question' })));
    await settle();
    expect(useTerminalStore.getState().selectedSessionKey).toBe(C);
    expect(useTerminalStore.getState().sessionViewModeBySessionKey[C]).toBe('chat');
    expect(screen.queryByTestId('pane:attention')).toBeNull();
    expect(terminalScene().gestureEnabled).not.toBe(false);
    expect(terminalScene().preventNativeDismiss).not.toBe(true);
    await swipeBack();
    expect(nav.getCurrentRoute()?.name).toBe('Sessions');
    expect(screen.getByTestId('sessions-screen')).toBeTruthy();
  });
});

describe('usage: the meters of the computer it was opened for', () => {
  test('the Accounts panel’s meters per account; a login without usage says so; the title names the computer', async () => {
    await renderScreen({ stored: layout(session(A), usage(A)) });
    expect(mockRpcCalls).toContainEqual({ machineId: 'm1', method: 'agentAccounts', params: { operation: 'list' } });
    expect(wasmCoreBridge.call).toHaveBeenCalledTimes(1);
    expect(wasmCoreBridge.call).toHaveBeenCalledWith({
      op: 'accountUsageColumns',
      args: [JSON.stringify(ACCOUNTS), NOW],
    });
    const meters = within(pane(`usage:${A}`));
    expect(meters.getByText(UsageCopy.head)).toBeTruthy();
    expect(meters.getByLabelText('5h 16%, resets in 2h 36m')).toBeTruthy();
    expect(meters.getByLabelText('7d 40%, resets in 5d 4h')).toBeTruthy();
    expect(meters.getByText(UsageCopy.resetIn('2h 36m'))).toBeTruthy();
    expect(meters.getByText('Spare')).toBeTruthy();
    expect(meters.getByText(UsageCopy.unavailable)).toBeTruthy();
    expect(meters.queryByText('0%')).toBeNull();
    expect(barTitle(`usage:${A}`, UsageCopy.title('Mac'), PanesCopy.usageType)).toBeTruthy();
  });

  test('the pane draws the page’s returned names, values and resets, not the raw account windows', async () => {
    mockColumns = [
      { id: 'work', usage: [
        { name: 'Core window', value: '81%', percent: 80.5, resetIn: 'due' },
        { name: 'Core model', value: 'NaN%', percent: null, resetIn: null },
        { name: 'Core weekly', value: '113%', percent: 100, resetIn: '3d 2h' },
        { name: 'Core fourth', value: '-4%', percent: 0, resetIn: '59m' },
      ] },
      { id: 'spare', usage: [] },
    ];
    await renderScreen({ stored: layout(session(A), usage(A)) });
    const body = within(pane(`usage:${A}`));
    expect(body.getByLabelText('Core window 81%, resets in due')).toBeTruthy();
    expect(body.getByLabelText('Core model NaN%')).toBeTruthy();
    expect(body.getByLabelText('Core weekly 113%, resets in 3d 2h')).toBeTruthy();
    expect(body.getByLabelText('Core fourth -4%, resets in 59m')).toBeTruthy();
    expect(body.queryByText('16%')).toBeNull();
    expect(body.getByText(UsageCopy.unavailable)).toBeTruthy();
  });

  test('a page failure uses the existing error path and keeps the last reading', async () => {
    await renderScreen({ stored: layout(session(A), usage(A)) });
    jest.mocked(wasmCoreBridge.call).mockRejectedValueOnce(new Error('The chat core page stopped.'));
    await press(UsageCopy.refresh);
    const body = within(pane(`usage:${A}`));
    expect(body.getByText('The chat core page stopped.')).toBeTruthy();
    expect(body.getByLabelText('5h 16%, resets in 2h 36m')).toBeTruthy();
    expect(wasmCoreBridge.call).toHaveBeenCalledTimes(2);
  });

  test('a session of another computer selected: the pane keeps the Mac’s usage and its name', async () => {
    await renderScreen({ stored: layout(session(A), usage(A)) });
    await act(() => useTerminalStore.getState().selectTab(X, { scrollToBottom: false }));
    await act(() => jest.advanceTimersByTime(30_000));
    await settle();
    expect(shownSessions()).toEqual([X]);
    expect(storedStacked()).toEqual({ first: session(X), second: usage(A), dividerRatio: 0.5 });
    expect(barTitle(`usage:${A}`, UsageCopy.title('Mac'), PanesCopy.usageType)).toBeTruthy();
    expect(mockRpcCalls.filter((call) => call.method === 'agentAccounts').map((call) => call.machineId)).toEqual([
      'm1',
      'm1',
    ]);
  });

  test('Refresh asks for a fresh reading; a failed read says why and keeps the meters', async () => {
    await renderScreen({ stored: layout(session(A), usage(A)) });
    mockAccounts = { result: null, error: { code: 'unreachable', message: 'Could not reach it.', endpoint: '' } };
    await press(UsageCopy.refresh);
    expect(mockRpcCalls.at(-1)).toEqual({
      machineId: 'm1',
      method: 'agentAccounts',
      params: { operation: 'list', refresh: true },
    });
    const meters = within(pane(`usage:${A}`));
    expect(meters.getByText('Could not reach it.')).toBeTruthy();
    expect(meters.getByLabelText('5h 16%, resets in 2h 36m')).toBeTruthy();
  });

  test('no saved Claude or Codex account: a sentence naming the computer, no meters', async () => {
    mockAccounts = { result: { accounts: [] }, error: null };
    await renderScreen({ stored: layout(session(A), usage(A)) });
    expect(within(pane(`usage:${A}`)).getByText(UsageCopy.noAccounts('Mac'))).toBeTruthy();
  });

  test('saved accounts that are all turned off: no enabled account, enable or add one; no meters', async () => {
    mockAccounts = {
      result: { accounts: ACCOUNTS.accounts.map((account) => ({ ...account, userDisabled: true })) },
      error: null,
    };
    await renderScreen({ stored: layout(session(A), usage(A)) });
    const body = within(pane(`usage:${A}`));
    const sentence = UsageCopy.noAccounts('Mac');
    expect(body.getByText(sentence)).toBeTruthy();
    expect(sentence).toMatch(/^No Claude or Codex account is enabled in Ghostex on Mac\./);
    expect(sentence).toMatch(/Enable or add one there/);
    expect(sentence).not.toMatch(/is saved/);
    expect(body.queryByText('Work')).toBeNull();
    expect(body.queryByText('Spare')).toBeNull();
  });

  test('answers slower than the 30 s poll: each is shown when it comes, one read out at a time', async () => {
    let out = 0;
    let mostOut = 0;
    const late = answerAfter(35_000, { result: ACCOUNTS, error: null }, () => {
      out -= 1;
    });
    mockAccountsAnswer = () => {
      out += 1;
      mostOut = Math.max(mostOut, out);
      return late();
    };
    await renderScreen({ stored: layout(session(A), usage(A)) });
    expect(within(pane(`usage:${A}`)).queryByText('16%')).toBeNull();
    await advance(40_000);
    expect(within(pane(`usage:${A}`)).getByText('16%')).toBeTruthy();
    expect(screen.getByLabelText(UsageCopy.refresh).props.accessibilityState.busy).toBe(false);
    await advance(80_000);
    expect(within(pane(`usage:${A}`)).getByText('16%')).toBeTruthy();
    expect(mostOut).toBe(1);
    // It keeps reading while open.
    expect(mockRpcCalls.filter((call) => call.method === 'agentAccounts').length).toBeGreaterThanOrEqual(3);
  });

  test('a read that fails only after the poll’s 30 s, at the route’s time limit, says why', async () => {
    mockAccountsAnswer = answerAfter(60_000, {
      result: null,
      error: { code: 'unreachable', message: 'Timed out after 60 seconds.', endpoint: '/api/agentAccounts' },
    });
    await renderScreen({ stored: layout(session(A), usage(A)) });
    await advance(70_000);
    expect(within(pane(`usage:${A}`)).getByText('Timed out after 60 seconds.')).toBeTruthy();
    expect(screen.getByLabelText(UsageCopy.refresh).props.accessibilityState.busy).toBe(false);
  });

  test('closed while a read is out: no read after it', async () => {
    mockAccountsAnswer = answerAfter(35_000, { result: ACCOUNTS, error: null });
    await renderScreen({ stored: layout(session(A), usage(A)) });
    const reads = mockRpcCalls.filter((call) => call.method === 'agentAccounts').length;
    expect(reads).toBe(1);
    await press(PanesCopy.close(UsageCopy.title('Mac')));
    expect(screen.queryByTestId(`pane:usage:${A}`)).toBeNull();
    await advance(100_000);
    expect(mockRpcCalls.filter((call) => call.method === 'agentAccounts').length).toBe(reads);
  });
});

describe('a restart brings each type back within the pane layout version 1', () => {
  test.each([
    [AGENTS, 'agents'],
    [ATTENTION, 'attention'],
    [usage(A), `usage:${A}`],
  ] as const)('%o comes back beside its session', async (second, key) => {
    await renderScreen({ stored: layout(second, session(A)) });
    expect(pane(key)).toBeTruthy();
    expect(shownSessions()).toEqual([A]);
  });

  test('a usage pane whose computer the app no longer knows leaves one pane', async () => {
    await renderScreen({ stored: layout(session(A), usage('m9:gone')) });
    expect(screen.queryByTestId('pane:usage:m9:gone')).toBeNull();
    expect(shownSessions()).toEqual([A]);
  });
});

describe('closing', () => {
  test('either close button beside an agents, attention or usage pane leaves the session alone', async () => {
    await renderScreen({ stored: layout(session(A), ATTENTION) });
    await press(PanesCopy.close(PanesCopy.attentionType));
    expect(screen.queryByTestId('pane:attention')).toBeNull();
    // Closed, the layout stays stored for the next open.
    expect(storedStacked()).toEqual({ first: session(A), second: ATTENTION, dividerRatio: 0.5 });
    expect(usePaneStore.getState().document.closed).toBe(true);

    await act(() => usePaneStore.getState().showSlots('stacked', A, usage(A)));
    await settle();
    await press(PanesCopy.close('Alpha'));
    expect(screen.queryByTestId(`pane:usage:${A}`)).toBeNull();
    expect(shownSessions()).toEqual([A]);
    expect(useTerminalStore.getState().selectedSessionKey).toBe(A);
  });
});

describe('folded: the active pane’s content opens full screen', () => {
  test('attention: the Notifications screen; usage: the Usage screen of its computer; agents: the Sessions screen', async () => {
    await renderScreen({ stored: layout(session(A), ATTENTION) });
    await touchPane('attention');
    await changeDivisions([]);
    expect(navigation.navigate).toHaveBeenCalledWith('AttentionList');
    expect(shownSessions()).toEqual([A]);

    await changeDivisions([FLAT_UPRIGHT]);
    await act(() => usePaneStore.getState().showSlots('stacked', A, usage(B)));
    await settle();
    await touchPane(`usage:${B}`);
    await changeDivisions([]);
    expect(navigation.navigate).toHaveBeenCalledWith('Usage', { machineId: 'm1' });

    await changeDivisions([FLAT_UPRIGHT]);
    await act(() => usePaneStore.getState().showSlots('stacked', A, AGENTS));
    await settle();
    await touchPane('agents');
    await changeDivisions([]);
    expect(navigation.popTo).toHaveBeenCalledWith('Sessions');
  });

  test('agents of another computer than the Sessions screen’s: folding selects that computer there', async () => {
    await renderScreen({ stored: layout(session(A), AGENTS) });
    await act(() => useMachinesStore.setState({ selectedMachineId: MAC.id }));
    await act(() => useTerminalStore.getState().selectTab(X, { scrollToBottom: false }));
    await settle();
    expect(within(pane('agents')).getByLabelText('Xray, Codex · Idle')).toBeTruthy();
    await touchPane('agents');
    await changeDivisions([]);
    expect(navigation.popTo).toHaveBeenCalledWith('Sessions');
    expect(useMachinesStore.getState().selectedMachineId).toBe(LINUX.id);
  });

  test('the Usage screen: titled with its computer, the same meters', async () => {
    const screenNavigation = { setOptions: jest.fn() };
    await render(
      <VerticalBarArea>
        <UsageScreen
          navigation={screenNavigation as never}
          route={{ key: 'usage', name: 'Usage', params: { machineId: 'm1' } }}
        />
      </VerticalBarArea>,
    );
    await settle();
    expect(screenNavigation.setOptions).toHaveBeenCalledWith({ title: UsageCopy.title('Mac') });
    expect(screen.getByLabelText('5h 16%, resets in 2h 36m')).toBeTruthy();
    expect(screen.getByText(UsageCopy.unavailable)).toBeTruthy();
  });
});

describe('half folded like a laptop: the attention and usage panes’ lists get no fold of their own', () => {
  test.each([
    ['attention', ATTENTION, 'attention'],
    ['usage', usage(A), `usage:${A}`],
  ] as const)('the %s pane’s list keeps its whole frame: no fold inset, no measurement', async (_name, entry, key) => {
    await expectPaneListsWithoutFold(key, async () => {
      await renderScreen({ divisions: [LAPTOP] });
      await act(() => usePaneStore.getState().showSlots('sideBySide', A, entry));
      await settle();
    });
  });
});

describe('half folded like a book: the rows of the agents, attention and usage bodies keep off the fold', () => {
  const ACROSS: Window = { width: 951, height: 669 };
  /** The fold's 40 pt division down the middle of the turned inner display (the terminal area starts at x 0). */
  const BOOK: FoldDivision = { x: 455.5, y: 0, width: 40, height: 669, active: true };

  type Span = { from: number; to: number };

  /** Turned and half folded like a book, `first` and `second` side by side with the divider at `ratio`. */
  async function bookPose(first: PaneEntry, second: PaneEntry, ratio: number): Promise<void> {
    await act(() => {
      keyboard.setScreen(ACROSS.width, ACROSS.height);
      Dimensions.set({ window: { ...ACROSS, scale: 3, fontScale: 1 }, screen: { ...ACROSS, scale: 3, fontScale: 1 } });
      mockReport?.(barLayout(ACROSS, [BOOK]));
      usePaneStore.getState().showSlots('sideBySide', first, second);
      usePaneStore.getState().setDividerRatio('sideBySide', ratio);
    });
    await layOut(areaOf(ACROSS));
    await settle();
  }

  function styleOf(node: TestInstance, prop: 'style' | 'contentContainerStyle' = 'style'): Record<string, unknown> {
    const style = node.props[prop] as unknown;
    return (StyleSheet.flatten(typeof style === 'function' ? style({ pressed: false }) : style) ?? {}) as Record<
      string,
      unknown
    >;
  }

  /** A style's left or right margin, padding or border, in points. */
  function sideOf(style: Record<string, unknown>, kind: 'margin' | 'padding' | 'border', side: 'Left' | 'Right') {
    const value =
      kind === 'border'
        ? (style[`border${side}Width`] ?? style.borderWidth)
        : (style[`${kind}${side}`] ?? style[`${kind}Horizontal`] ?? style[kind]);
    if (value === undefined) return 0;
    if (typeof value !== 'number') throw new Error(`${kind}${side} is not in points: ${String(value)}`);
    return value;
  }

  /**
   * Where `node` stands across the pane container, from its pane card's frame and every view between them (as
   * `TerminalScreen.paneTypes.rntl.tsx` measures it): an absolute view's left and right, borders, margins, paddings, a
   * scroll view's content padding. The test renderer lays nothing out; these are the frames the styles give.
   */
  function spanOf(key: string, node: TestInstance): Span {
    const card = pane(key);
    const views: TestInstance[] = [node];
    while (views[0] !== card) {
      const parent = views[0].parent;
      if (parent === null) throw new Error(`the view is not in the pane ${key}`);
      views.unshift(parent);
    }
    const frame = styleOf(card);
    let from = Number(frame.left);
    let to = from + Number(frame.width);
    views.forEach((view, index) => {
      const style = styleOf(view);
      if (index > 0 && style.position === 'absolute') {
        from += typeof style.left === 'number' ? style.left : 0;
        to -= typeof style.right === 'number' ? style.right : 0;
      } else if (index > 0) {
        from += sideOf(style, 'margin', 'Left');
        to -= sideOf(style, 'margin', 'Right');
      }
      if (view === node) return;
      from += sideOf(style, 'border', 'Left');
      to -= sideOf(style, 'border', 'Right');
      if (styleOf(views[index + 1]).position === 'absolute') return;
      const content = styleOf(view, 'contentContainerStyle');
      from += sideOf(style, 'padding', 'Left') + sideOf(content, 'margin', 'Left') + sideOf(content, 'padding', 'Left');
      to -=
        sideOf(style, 'padding', 'Right') + sideOf(content, 'margin', 'Right') + sideOf(content, 'padding', 'Right');
    });
    return { from, to };
  }

  function expectOffTheFold(what: string, span: Span): void {
    const offTheFold = span.to > span.from && (span.to <= BOOK.x || span.from >= BOOK.x + BOOK.width);
    expect({ what, ...span, fold: [BOOK.x, BOOK.x + BOOK.width], offTheFold }).toEqual(
      expect.objectContaining({ offTheFold: true }),
    );
  }

  test('agents at 30 %: its rows stand past the fold', async () => {
    await renderScreen({ stored: layout(session(A), AGENTS) });
    await bookPose(A, AGENTS, 0.3);
    expectOffTheFold('row', spanOf('agents', within(pane('agents')).getByLabelText('Gamma, Codex · Has a question')));
  });

  test('attention at 70 %: its rows stand before the fold', async () => {
    await renderScreen({ stored: layout(ATTENTION, session(A)) });
    await bookPose(ATTENTION, A, 0.7);
    expectOffTheFold('row', spanOf('attention', within(pane('attention')).getByTestId('attention-row-c')));
  });

  test('usage at 30 %: its head with Refresh and its accounts stand past the fold', async () => {
    await renderScreen({ stored: layout(session(A), usage(A)) });
    await bookPose(A, usage(A), 0.3);
    const meters = within(pane(`usage:${A}`));
    expectOffTheFold('Refresh', spanOf(`usage:${A}`, meters.getByLabelText(UsageCopy.refresh)));
    expectOffTheFold('meter', spanOf(`usage:${A}`, meters.getByLabelText('5h 16%, resets in 2h 36m')));
  });
});

describe('the Accounts panel’s shared usage row', () => {
  test.each(['dark', 'light'] as const)('keeps current and switch reset policy and %s appearance roles', async (theme) => {
    useSettingsStore.setState((state) => ({ settings: { ...state.settings, sessionChatTheme: theme } }));
    const appearance = transcriptThemeFor(useSettingsStore.getState().settings, theme === 'light');
    await render(
      <AccountsPanel
        panel={{
          session: {
            name: 'Current',
            usage: COLUMNS[0].usage,
            others: [{
              id: 'other', name: 'Other', ready: true, action: 'Use account',
              usage: [{ name: 'Other window', value: '23%', percent: 23, resetIn: '7m' }],
            }],
          },
        }}
        onCommand={() => undefined}
      />,
    );
    expect(screen.getByText('↻ 2h 36m')).toBeTruthy();
    expect(screen.queryByText('↻ 7m')).toBeNull();
    expect(StyleSheet.flatten(screen.getByText('16%').props.style).color).toBe(appearance.foreground);
    expect(StyleSheet.flatten(screen.getByText('5h').props.style).color).toBe(appearance.muted);
    const column = screen.getByLabelText('5h 16%, resets in 2h 36m');
    expect(column.queryAll((node) => StyleSheet.flatten(node.props.style)?.backgroundColor === appearance.meterTrack).length)
      .toBeGreaterThan(0);
    expect(column.queryAll((node) => {
      const style = StyleSheet.flatten(node.props.style);
      return style?.width === '16.4%' && style.backgroundColor === appearance.meterFill;
    }).length).toBeGreaterThan(0);
  });

  test('the shared row takes its caller’s appearance independently of the chat setting', async () => {
    useSettingsStore.setState((state) => ({ settings: { ...state.settings, sessionChatTheme: 'light' } }));
    const appearance = transcriptThemeFor(useSettingsStore.getState().settings, false);
    await render(
      <UsageRow
        columns={[{ name: 'Core window', value: '81%', percent: 80.5, resetIn: 'due' }]}
        resets
        appearance={appearance}
      />,
    );
    expect(screen.getByLabelText('Core window 81%, resets in due')).toBeTruthy();
    expect(screen.getByText('↻ due')).toBeTruthy();
    expect(StyleSheet.flatten(screen.getByText('81%').props.style).color).toBe(appearance.foreground);
  });
});
