/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. REQ-NFR-001 AC1 (the terminal keeps working as before) and REQ-DUO-003
 * AC1/AC2 (the key bar stays within the window width, over the keyboard) for the owner report "springt das
 * terminal wenn die tastatur hochgeht + wenn ich die tastatur wegmache, scrollt es super seltsam runter und
 * springt wieder hoch" (2026-10-28) with the owner's decision A, "Raster bleibt, Terminal gleitet" (the
 * terminal grid stays, the terminal slides with the keyboard so the cursor row stays visible).
 *
 * The real `TerminalScreen` with its real stores, `KeyBarDock`, `TerminalKeyBar` and `useKeyboardMetrics`;
 * mocked are the boundaries only: the native module (the terminal view is a stand-in that shows its props
 * and fires the cursor row event), the safe area, navigation focus, haptics, storage and the chat screens.
 * The test renderer lays nothing out, so heights come from `onLayout` events the test fires, and "the
 * terminal is not resized" is read from every in-flow style of the screen: nothing that decides the
 * terminal view's height may differ between the keyboard hidden and shown. Frames in window points of an
 * iPhone 17: 402x874, home indicator inset 34, keyboard 336 pt tall (top 538), key bar 88 pt.
 *
 * Device-only, not shown here: that the native view's grid and the host's pty really stay put, the
 * smoothness of the motion, the clip under the header, touch / selection hit-testing while the view is
 * moved, and that the native scroll to the bottom lands the cursor row where the offset expects it.
 */

import {
  AccessibilityInfo,
  Dimensions,
  DeviceEventEmitter,
  LayoutAnimation,
  Platform,
  StyleSheet,
  type ViewStyle,
} from 'react-native';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react-native';
import type { JsonElement, TestInstance } from 'test-renderer';

import { useSettingsStore } from '../settings/store';
import { useTerminalStore, type TerminalTab } from '../terminal/sessions';
import TerminalScreen from './TerminalScreen';
import { keyboardFixture } from '../components/common/keyboard/keyboardEventFixtures';
import { useKeyboardFrame } from '../components/common/keyboard/keyboardFrame';
import VerticalBarArea from '../components/common/verticalBar/VerticalBarArea';

const mockScrollToBottom = jest.fn((_sessionKey: string) => Promise.resolve());
let mockScreenFocused = true;

jest.mock('../../modules/ghostex-native/src', () => {
  const { View: MockView } = jest.requireActual('react-native');
  const React = jest.requireActual('react');
  return {
    GhostexNative: {
      addListener: () => ({ remove: () => undefined }),
      setKeepScreenOn: () => Promise.resolve(),
      focusTerminal: () => Promise.resolve(true),
      blurTerminal: () => Promise.resolve(),
      setKeyModifiers: () => Promise.resolve(),
      sendKey: () => Promise.resolve(),
      sendText: () => Promise.resolve(),
      scrollToBottom: (sessionKey: string) => mockScrollToBottom(sessionKey),
      // The app chrome (`VerticalBarArea`) observes the window's layout.
      observeBarLayout: () =>
        Promise.resolve({
          id: 1,
          layout: { windowWidth: 402, windowHeight: 874, safeTop: 59, safeLeft: 0, safeRight: 0, marginTop: 59 },
        }),
      stopObservingBarLayout: () => Promise.resolve(),
    },
    // The native view's stand-in: its props are what the screen asks of it.
    GhostexTerminalView: (props: object) => React.createElement(MockView, { testID: 'terminal-view', ...props }),
  };
});
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-haptics', () => ({
  impactAsync: () => Promise.resolve(),
  notificationAsync: () => Promise.resolve(),
  selectionAsync: () => Promise.resolve(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning', Error: 'error' },
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true, useFocusEffect: () => undefined }));
jest.mock('../chat/native/NativeChatScreen', () => ({ __esModule: true, default: () => null }));
jest.mock('../voice/VoiceButton', () => ({ VoiceButton: () => null }));
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => mockScreenFocused,
  useFocusEffect: () => undefined,
  useNavigation: () => ({ navigate: () => undefined }),
}));
const WINDOW = { width: 402, height: 874 };
const KEYBOARD = { top: 538, height: 336 };
const KEY_BAR = 88;
const DURATION = 250;
// The measured keyboard motion on the iPhone Duo (owner recording, iOS 27.2), as the app requests it: the
// show is a spring (damping 1.8, 580 ms), the hide an ease-out (250 ms), not the event's own duration.
const SHOW_MOTION = { duration: 580, update: { type: 'spring', springDamping: 1.8 } };
const HIDE_MOTION = { duration: 250, update: { type: 'easeOut' } };

// A bar on its way out is hidden from VoiceOver on purpose, so its queries include hidden elements.
const KEY_BAR_LABEL = 'Extra keys';
const HIDDEN_TOO = { hidden: true };

const navigation = { setOptions: () => undefined, popTo: () => undefined, navigate: () => undefined };

const SHELL_TAB: TerminalTab = { sessionKey: 'shell-1', machineId: 'm1', title: 'shell', kind: 'shell', state: 'open' };
/** An agent session whose tab opens in chat view (a chat-supported agent with a project). */
const CHAT_TAB: TerminalTab = {
  sessionKey: 'chat-1',
  machineId: 'm1',
  title: 'agent',
  kind: 'attach',
  ghostexSessionId: 's1',
  ghostexProjectId: 'p1',
  ghostexAgentId: 'claude',
  state: 'open',
};

async function renderScreen(tab: TerminalTab = SHELL_TAB, inAppChrome = false): Promise<void> {
  await act(() => {
    Dimensions.set({ window: { ...WINDOW, scale: 3, fontScale: 1 }, screen: { ...WINDOW, scale: 3, fontScale: 1 } });
  });
  useTerminalStore.setState({ tabs: [tab], selectedSessionKey: tab.sessionKey });
  const terminal = (
    <TerminalScreen
      navigation={navigation as never}
      route={{ key: 'terminal', name: 'Terminal', params: { sessionKey: tab.sessionKey, machineId: 'm1' } }}
    />
  );
  // The app mounts every screen under `VerticalBarArea`, which follows the keyboard itself (`keyboardFrame.ts`).
  await render(inAppChrome ? <VerticalBarArea>{terminal}</VerticalBarArea> : terminal);
  // The Reduce Motion setting is read asynchronously.
  await act(async () => undefined);
}

/** The notifications iOS posts, with their start and end frames (keyboardEventFixtures.ts). */
const keyboard = keyboardFixture({ width: WINDOW.width, height: WINDOW.height });

async function keyboardWillShow(frame = KEYBOARD, duration = DURATION): Promise<void> {
  await act(() => keyboard.show(frame.top, frame.height, duration));
}

async function keyboardWillHide(duration = DURATION): Promise<void> {
  await act(() => keyboard.hide(duration));
}

function terminalView(): TestInstance {
  return screen.getByTestId('terminal-view');
}

/** The terminal view's `top` style in points: the negative of how far it moved up (`+ 0` turns -0 into 0). */
function terminalTop(): number {
  return (StyleSheet.flatten(terminalView().props.style)?.top ?? 0) + 0;
}

/** The nearest ancestor that asked for layout events: the terminal area. */
function terminalArea(): TestInstance {
  let node: TestInstance | null = terminalView().parent;
  while (node !== null && node.props.onLayout === undefined) node = node.parent;
  if (node === null) throw new Error('no terminal area');
  return node;
}

/** The absolutely positioned view around the key bar (its dock on iOS; null where the bar is in the flow). */
function keyBarDock(): TestInstance | null {
  let node: TestInstance | null = screen.getByLabelText(KEY_BAR_LABEL, HIDDEN_TOO);
  while (node !== null && StyleSheet.flatten(node.props.style)?.position !== 'absolute') node = node.parent;
  return node;
}

function dockBottom(): number | undefined {
  return StyleSheet.flatten(keyBarDock()?.props.style)?.bottom;
}

async function layoutTerminalArea(height: number): Promise<void> {
  await fireEvent(terminalArea(), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: WINDOW.width, height } } });
}

async function caretAt(top: number): Promise<void> {
  await act(() => terminalView().props.onCaretChange({ nativeEvent: { top } }));
}

const LAYOUT_KEYS = [
  'flex',
  'flexGrow',
  'flexShrink',
  'flexBasis',
  'height',
  'minHeight',
  'maxHeight',
  'paddingTop',
  'paddingBottom',
  'marginTop',
  'marginBottom',
] as const;

/**
 * Every style that can decide the terminal view's height: the size, padding, margin and flex of every
 * in-flow (not absolutely positioned) view of the rendered screen.
 */
function flowLayout(): string[] {
  const seen: string[] = [];
  const walk = (node: JsonElement | string, path: string): void => {
    if (typeof node === 'string') return;
    const style = StyleSheet.flatten(node.props.style as ViewStyle | undefined);
    if (style?.position === 'absolute') return;
    const picked = LAYOUT_KEYS.flatMap((key) => (style?.[key] === undefined ? [] : [`${key}=${String(style[key])}`]));
    if (picked.length > 0) seen.push(`${path}/${node.type}: ${picked.join(' ')}`);
    (node.children ?? []).forEach((child, index) => walk(child, `${path}/${index}`));
  };
  const tree = screen.toJSON();
  (Array.isArray(tree) ? tree : [tree]).forEach((node, index) => {
    if (node !== null) walk(node, `${index}`);
  });
  return seen;
}

let configureNext: jest.SpyInstance;
/** What the screen looked like at each moment the keyboard's animation was requested. */
let atConfigure: { top: number; dockBottom: number | undefined }[] = [];

/** The Reduce Motion setting as the system reports it, and who listens to its changes. */
const reduceMotion = {
  enabled: false,
  listeners: [] as ((enabled: boolean) => void)[],
  unsubscribed: jest.fn(),
};

beforeEach(() => {
  jest.useFakeTimers();
  atConfigure = [];
  mockScrollToBottom.mockClear();
  mockScreenFocused = true;
  reduceMotion.enabled = false;
  reduceMotion.listeners = [];
  reduceMotion.unsubscribed.mockClear();
  jest
    .spyOn(AccessibilityInfo, 'isReduceMotionEnabled')
    .mockImplementation(() => Promise.resolve(reduceMotion.enabled));
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((
    name: string,
    listener: (enabled: boolean) => void,
  ) => {
    if (name === 'reduceMotionChanged') reduceMotion.listeners.push(listener);
    return { remove: () => reduceMotion.unsubscribed(name) };
  }) as never);
  configureNext = jest.spyOn(LayoutAnimation, 'configureNext').mockImplementation(() => {
    atConfigure.push({
      top: screen.queryByTestId('terminal-view') === null ? 0 : terminalTop(),
      dockBottom: screen.queryByLabelText(KEY_BAR_LABEL, HIDDEN_TOO) === null ? undefined : dockBottom(),
    });
  });
});

afterEach(async () => {
  // The keyboard store is app-wide module state: every test leaves the keyboard away.
  await act(() => keyboard.hide(0));
  keyboard.setScreen(WINDOW.width, WINDOW.height);
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('REQ-NFR-001 AC1, owner decision A (2026-10-28): the terminal grid stays while the keyboard comes and goes', () => {
  test('showing, changing and hiding the keyboard changes nothing that decides the terminal view height', async () => {
    await renderScreen();
    await layoutTerminalArea(700);
    const hidden = flowLayout();
    expect(hidden.length).toBeGreaterThan(0);

    await keyboardWillShow();
    expect(flowLayout()).toEqual(hidden);
    // QuickType / emoji change the keyboard's height while it is up.
    await keyboardWillShow({ top: 498, height: 376 });
    expect(flowLayout()).toEqual(hidden);
    await keyboardWillShow();
    await keyboardWillHide();
    expect(flowLayout()).toEqual(hidden);
  });
});

describe('REQ-NFR-001 AC1, owner decision A: the terminal slides with the keyboard, the cursor row stays visible', () => {
  test('the cursor row at the bottom: the view moves up the whole covered height, keyboard and key bar less the home inset', async () => {
    await renderScreen();
    await layoutTerminalArea(700);
    await caretAt(680);
    expect(terminalTop()).toBe(0);
    await keyboardWillShow();
    // 336 + 88 - 34
    expect(terminalTop()).toBe(-390);
  });

  test('a cursor row in the middle still moves the view the whole covered height: what is drawn below it shows above the key bar', async () => {
    await renderScreen();
    await layoutTerminalArea(700);
    await keyboardWillShow();
    await caretAt(480);
    expect(terminalTop()).toBe(-390);
  });

  test('a cursor row near the top wins: the view moves only as far as its top edge, so the cursor row stays visible', async () => {
    await renderScreen();
    await layoutTerminalArea(700);
    await keyboardWillShow();
    await caretAt(200);
    expect(terminalTop()).toBe(-200);
    await caretAt(0);
    expect(terminalTop()).toBe(0);
  });

  test('no cursor row reported yet: the view moves the whole covered height', async () => {
    await renderScreen();
    await layoutTerminalArea(700);
    await keyboardWillShow();
    expect(terminalTop()).toBe(-390);
  });

  test('the view follows the cursor row while the keyboard is up (new output, a growing prompt)', async () => {
    await renderScreen();
    await layoutTerminalArea(700);
    await keyboardWillShow();
    await caretAt(300);
    expect(terminalTop()).toBe(-300);
    await caretAt(340);
    expect(terminalTop()).toBe(-340);
    await caretAt(380);
    expect(terminalTop()).toBe(-380);
    await caretAt(420);
    expect(terminalTop()).toBe(-390);
  });

  test('the view moves back when the keyboard hides', async () => {
    await renderScreen();
    await layoutTerminalArea(700);
    await caretAt(680);
    await keyboardWillShow();
    expect(terminalTop()).toBe(-390);
    await keyboardWillHide();
    expect(terminalTop()).toBe(0);
  });

  test("the keyboard's move is a layout animation fitted to the measured motion, requested before the move, whatever duration the event reports", async () => {
    await renderScreen();
    await layoutTerminalArea(700);
    await caretAt(680);
    await keyboardWillShow(KEYBOARD, 250);
    // keyboardWillShow and keyboardWillChangeFrame report one move: one animation.
    expect(configureNext).toHaveBeenCalledTimes(1);
    expect(configureNext).toHaveBeenLastCalledWith(SHOW_MOTION);
    // At that moment the view was still where it was: the commit after it moves it.
    expect(atConfigure[0].top).toBe(0);
    expect(terminalTop()).toBe(-390);

    await keyboardWillHide(300);
    expect(configureNext).toHaveBeenCalledTimes(2);
    expect(configureNext).toHaveBeenLastCalledWith(HIDE_MOTION);
    expect(atConfigure[1].top).toBe(-390);
    expect(terminalTop()).toBe(0);
  });

  test('an event that reports no duration requests no animation', async () => {
    await renderScreen();
    await layoutTerminalArea(700);
    await caretAt(680);
    await keyboardWillShow(KEYBOARD, 0);
    await keyboardWillHide(0);
    expect(configureNext).not.toHaveBeenCalled();
    expect(terminalTop()).toBe(0);
  });

  test('a frame change that lowers the keyboard (a taller QuickType bar going away) is a hide motion, one that raises it a show motion', async () => {
    await renderScreen();
    await keyboardWillShow();
    configureNext.mockClear();
    await act(() => keyboard.changeFrame(498, 376, DURATION));
    expect(configureNext).toHaveBeenCalledTimes(1);
    expect(configureNext).toHaveBeenLastCalledWith(SHOW_MOTION);
    configureNext.mockClear();
    await act(() => keyboard.changeFrame(KEYBOARD.top, KEYBOARD.height, DURATION));
    expect(configureNext).toHaveBeenCalledTimes(1);
    expect(configureNext).toHaveBeenLastCalledWith(HIDE_MOTION);
  });

  test('a window size change with the keyboard up recomputes the overlap from the last keyboard frame (FL-LAY-11)', async () => {
    await renderScreen();
    await layoutTerminalArea(500);
    await caretAt(480);
    await keyboardWillShow({ top: 413, height: 265 });
    await act(() => {
      Dimensions.set({
        window: { width: 951, height: 669, scale: 3, fontScale: 1 },
        screen: { width: 951, height: 669, scale: 3, fontScale: 1 },
      });
    });
    // 669 - 413 = 256 reach into the new window, plus the key bar, less the inset: 256 + 88 - 34.
    expect(terminalTop()).toBe(-310);
  });

  test('the keyboard top comes from the window: the overlap is the window bottom less the frame top, not the reported height', async () => {
    await renderScreen();
    await act(() => {
      Dimensions.set({
        window: { width: 466, height: 678, scale: 3, fontScale: 1 },
        screen: { width: 951, height: 669, scale: 3, fontScale: 1 },
      });
    });
    await layoutTerminalArea(500);
    await caretAt(480);
    // Top 413 in a 678 pt window: 265 pt reach into it, whatever else the frame says.
    await keyboardWillShow({ top: 413, height: 300 });
    // 265 + 88 - 34
    expect(terminalTop()).toBe(-319);
  });
});

describe('REQ-DUO-003 AC1/AC2, owner decision A: the key bar rides on top of the keyboard', () => {
  test("the key bar stands on the keyboard across the window width, in the keyboard's animation", async () => {
    await renderScreen();
    await layoutTerminalArea(700);
    expect(screen.queryByLabelText(KEY_BAR_LABEL, HIDDEN_TOO)).toBeNull();
    await keyboardWillShow();
    expect(screen.getByLabelText(KEY_BAR_LABEL, HIDDEN_TOO)).toBeTruthy();
    expect(StyleSheet.flatten(keyBarDock()?.props.style)).toMatchObject({
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 336,
    });
    // Requested in the commit that mounted the bar and moved it: it rides in with the keyboard.
    expect(configureNext).toHaveBeenCalledTimes(1);
  });

  test('the key bar stays mounted while the keyboard slides out and is gone after it', async () => {
    await renderScreen();
    await layoutTerminalArea(700);
    await keyboardWillShow();
    await fireEvent(keyBarDock() as TestInstance, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: WINDOW.width, height: KEY_BAR } },
    });
    await keyboardWillHide(250);
    // The keyboard is still on its way down: the bar is still there, going down with it.
    expect(screen.getByLabelText(KEY_BAR_LABEL, HIDDEN_TOO)).toBeTruthy();
    expect(dockBottom()).toBe(-KEY_BAR);
    await act(() => jest.advanceTimersByTime(249));
    expect(screen.queryByLabelText(KEY_BAR_LABEL, HIDDEN_TOO)).not.toBeNull();
    await act(() => jest.advanceTimersByTime(1));
    expect(screen.queryByLabelText(KEY_BAR_LABEL, HIDDEN_TOO)).toBeNull();
  });

  test("the key bar's linger is the hide motion's 250 ms, not the event's duration", async () => {
    await renderScreen();
    await layoutTerminalArea(700);
    await keyboardWillShow();
    await fireEvent(keyBarDock() as TestInstance, 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: WINDOW.width, height: KEY_BAR } },
    });
    await keyboardWillHide(400);
    await act(() => jest.advanceTimersByTime(249));
    expect(screen.queryByLabelText(KEY_BAR_LABEL, HIDDEN_TOO)).not.toBeNull();
    await act(() => jest.advanceTimersByTime(1));
    expect(screen.queryByLabelText(KEY_BAR_LABEL, HIDDEN_TOO)).toBeNull();
  });

  test('a bar on its way out is out of reach: no touches, hidden from VoiceOver', async () => {
    await renderScreen();
    await keyboardWillShow();
    await keyboardWillHide(250);
    const dock = keyBarDock();
    expect(dock?.props.pointerEvents).toBe('none');
    expect(dock?.props.accessibilityElementsHidden).toBe(true);
  });

  test('a tap on the terminal brings the bar up at the window bottom before the keyboard events land, then onto the keyboard', async () => {
    await renderScreen();
    await layoutTerminalArea(700);
    await caretAt(680);
    await act(() => terminalView().props.onSingleTap());
    expect(dockBottom()).toBe(0);
    // The bar alone covers 88 - 34 of the view.
    expect(terminalTop()).toBe(-54);
    await keyboardWillShow();
    expect(dockBottom()).toBe(336);
    expect(terminalTop()).toBe(-390);
  });
});

describe('owner decision A, extra keys toolbar off: the keyboard alone decides', () => {
  test('with the key bar off the view moves up the keyboard less the home inset', async () => {
    const before = useSettingsStore.getState().settings;
    useSettingsStore.setState({ settings: { ...before, extraKeysToolbarVisible: false } });
    try {
      await renderScreen();
      await layoutTerminalArea(700);
      await caretAt(680);
      await keyboardWillShow();
      expect(screen.queryByLabelText(KEY_BAR_LABEL, HIDDEN_TOO)).toBeNull();
      // 336 - 34
      expect(terminalTop()).toBe(-302);
      // A cursor row mid-screen: still the keyboard's whole cover; near the top: its top edge.
      await caretAt(480);
      expect(terminalTop()).toBe(-302);
      await caretAt(150);
      expect(terminalTop()).toBe(-150);
    } finally {
      await act(() => useSettingsStore.setState({ settings: before }));
    }
  });
});

describe('REQ-NFR-005: Android keeps its path', () => {
  const ios = Platform.OS;
  beforeEach(() => {
    Platform.OS = 'android';
  });
  afterEach(() => {
    Platform.OS = ios;
  });

  test('the container still makes room for the keyboard, the key bar stays in the flow, nothing slides', async () => {
    await renderScreen();
    await act(() => {
      DeviceEventEmitter.emit('keyboardDidShow', {
        duration: 0,
        easing: 'keyboard',
        endCoordinates: { screenX: 0, screenY: KEYBOARD.top, width: WINDOW.width, height: KEYBOARD.height },
      });
    });
    expect(terminalView().props.onCaretChange).toBeUndefined();
    expect(terminalTop()).toBe(0);
    expect(screen.getByLabelText(KEY_BAR_LABEL, HIDDEN_TOO)).toBeTruthy();
    expect(keyBarDock()).toBeNull();
    const tree = screen.toJSON();
    const container = Array.isArray(tree) ? tree[0] : tree;
    expect(StyleSheet.flatten(container?.props.style)?.paddingBottom).toBe(336);
    expect(mockScrollToBottom).not.toHaveBeenCalled();
  });
});

describe('owner 2026-10-28: the keyboard summoned while scrolled back shows the input area', () => {
  test('the active session is scrolled to the bottom once when the keyboard comes up, not on a frame change while it is up, again after it was away', async () => {
    await renderScreen();
    expect(mockScrollToBottom).not.toHaveBeenCalled();
    await keyboardWillShow();
    expect(mockScrollToBottom).toHaveBeenCalledTimes(1);
    expect(mockScrollToBottom).toHaveBeenLastCalledWith('shell-1');
    // QuickType / emoji change the height while the keyboard is up: a user who scrolled back stays there.
    await keyboardWillShow({ top: 498, height: 376 });
    expect(mockScrollToBottom).toHaveBeenCalledTimes(1);
    await keyboardWillHide();
    expect(mockScrollToBottom).toHaveBeenCalledTimes(1);
    await keyboardWillShow();
    expect(mockScrollToBottom).toHaveBeenCalledTimes(2);
  });

  test('in chat view the keyboard scrolls no terminal', async () => {
    useTerminalStore.setState({ sessionViewModeBySessionKey: { 'chat-1': 'chat' } });
    try {
      await renderScreen(CHAT_TAB);
      expect(screen.queryByTestId('terminal-view')).toBeNull();
      await keyboardWillShow();
      expect(mockScrollToBottom).not.toHaveBeenCalled();
    } finally {
      await act(() => useTerminalStore.setState({ sessionViewModeBySessionKey: {} }));
    }
  });
});

describe('FL-A11Y-05: Reduce Motion', () => {
  test('with Reduce Motion on no animation is requested and every end position is the same', async () => {
    reduceMotion.enabled = true;
    await renderScreen();
    await layoutTerminalArea(700);
    await caretAt(680);
    await keyboardWillShow();
    expect(configureNext).not.toHaveBeenCalled();
    expect(terminalTop()).toBe(-390);
    expect(dockBottom()).toBe(336);
    await keyboardWillHide();
    expect(configureNext).not.toHaveBeenCalled();
    expect(terminalTop()).toBe(0);
    // Nothing animates, so the bar does not wait for the keyboard to finish.
    expect(screen.queryByLabelText(KEY_BAR_LABEL, HIDDEN_TOO)).toBeNull();
  });

  test('a change of the setting while the screen is open is followed in both directions', async () => {
    await renderScreen();
    await layoutTerminalArea(700);
    await caretAt(680);
    await keyboardWillShow();
    expect(configureNext).toHaveBeenCalledTimes(1);
    await keyboardWillHide();
    expect(configureNext).toHaveBeenCalledTimes(2);

    await act(() => reduceMotion.listeners.forEach((listener) => listener(true)));
    await keyboardWillShow();
    await keyboardWillHide();
    expect(configureNext).toHaveBeenCalledTimes(2);

    await act(() => reduceMotion.listeners.forEach((listener) => listener(false)));
    await keyboardWillShow();
    expect(configureNext).toHaveBeenCalledTimes(3);
  });

  test('the setting is no longer followed after the screen is gone', async () => {
    await renderScreen();
    expect(reduceMotion.unsubscribed).not.toHaveBeenCalled();
    await screen.unmount();
    expect(reduceMotion.unsubscribed).toHaveBeenCalledWith('reduceMotionChanged');
  });
});

describe('FL-A11Y-05 at the shared root: the app chrome follows Reduce Motion too', () => {
  test('with Reduce Motion on, a keyboard event through VerticalBarArea and the terminal screen requests no layout animation from either', async () => {
    reduceMotion.enabled = true;
    await renderScreen(SHELL_TAB, true);
    await layoutTerminalArea(700);
    await caretAt(680);
    await keyboardWillShow();
    expect(configureNext).not.toHaveBeenCalled();
    expect(terminalTop()).toBe(-390);
    expect(dockBottom()).toBe(336);
    await keyboardWillHide();
    expect(configureNext).not.toHaveBeenCalled();
    expect(terminalTop()).toBe(0);
  });

  test('with Reduce Motion off, the app chrome and the terminal still request the animation', async () => {
    await renderScreen(SHELL_TAB, true);
    await layoutTerminalArea(700);
    await caretAt(680);
    await keyboardWillShow();
    // The keyboard store is the one writer for the chrome and the terminal: one request per move.
    expect(configureNext.mock.calls).toEqual([[SHOW_MOTION]]);
    configureNext.mockClear();
    await keyboardWillHide();
    expect(configureNext.mock.calls).toEqual([[HIDE_MOTION]]);
    expect(terminalTop()).toBe(0);
  });
});

describe('REQ-NFR-001 AC1: the scroll to the input area follows the keyboard really coming up, in the terminal on screen', () => {
  test('a frame change that ends below the window after a hide is no new appearance: one scroll, key bar gone', async () => {
    await renderScreen();
    await keyboardWillShow();
    expect(mockScrollToBottom).toHaveBeenCalledTimes(1);
    await keyboardWillHide();
    // The end frame of the hide, posted after it: start where the keyboard was, end below the screen.
    await act(() => keyboard.changeFrame(WINDOW.height, KEYBOARD.height, DURATION, KEYBOARD));
    expect(mockScrollToBottom).toHaveBeenCalledTimes(1);
    await act(() => jest.advanceTimersByTime(DURATION + 50));
    expect(screen.queryByLabelText(KEY_BAR_LABEL, HIDDEN_TOO)).toBeNull();
    // The next real appearance still scrolls.
    await keyboardWillShow();
    expect(mockScrollToBottom).toHaveBeenCalledTimes(2);
  });

  test('a keyboard another screen opens does not scroll the retained terminal that is not on screen', async () => {
    await renderScreen();
    mockScreenFocused = false;
    await screen.rerender(
      <TerminalScreen
        navigation={navigation as never}
        route={{ key: 'terminal', name: 'Terminal', params: { sessionKey: 'shell-1', machineId: 'm1' } }}
      />,
    );
    await keyboardWillShow();
    expect(mockScrollToBottom).not.toHaveBeenCalled();
  });
});

describe('the keyboard store is the one writer of the layout animation and the one model of visibility (r8, r9)', () => {
  test("the terminal hook registers no keyboard listener of its own: one per event, the store's", async () => {
    await renderScreen();
    expect(DeviceEventEmitter.listenerCount('keyboardWillShow')).toBe(1);
    expect(DeviceEventEmitter.listenerCount('keyboardWillChangeFrame')).toBe(1);
    expect(DeviceEventEmitter.listenerCount('keyboardWillHide')).toBe(1);
  });

  test('a hide, then the end frame below the screen: one hide motion, no show motion after it', async () => {
    await renderScreen();
    await keyboardWillShow();
    configureNext.mockClear();
    await keyboardWillHide();
    await act(() => keyboard.changeFrame(WINDOW.height, KEYBOARD.height, DURATION, KEYBOARD));
    expect(configureNext.mock.calls).toEqual([[HIDE_MOTION]]);
  });

  test('the end frame below the screen, then the hide: one hide motion, the key bar gone after it, one scroll', async () => {
    await renderScreen();
    await keyboardWillShow();
    configureNext.mockClear();
    await act(() => keyboard.changeFrame(WINDOW.height, KEYBOARD.height, DURATION));
    await keyboardWillHide();
    expect(configureNext.mock.calls).toEqual([[HIDE_MOTION]]);
    await act(() => jest.advanceTimersByTime(HIDE_MOTION.duration));
    expect(screen.queryByLabelText(KEY_BAR_LABEL, HIDDEN_TOO)).toBeNull();
    expect(mockScrollToBottom).toHaveBeenCalledTimes(1);
  });

  test('a frame-only hide, then a real show: hidden in between, exactly one appearance and one more scroll', async () => {
    await renderScreen();
    await keyboardWillShow();
    await act(() => keyboard.changeFrame(WINDOW.height, KEYBOARD.height, DURATION));
    await act(() => jest.advanceTimersByTime(HIDE_MOTION.duration));
    expect(screen.queryByLabelText(KEY_BAR_LABEL, HIDDEN_TOO)).toBeNull();
    mockScrollToBottom.mockClear();
    configureNext.mockClear();
    await keyboardWillShow();
    expect(mockScrollToBottom.mock.calls).toEqual([['shell-1']]);
    expect(configureNext.mock.calls).toEqual([[SHOW_MOTION]]);
  });

  describe('turning with the keyboard up (the notification carries its own start and end frames)', () => {
    const LANDSCAPE = { width: 874, height: 402 };
    const setWindow = (size: { width: number; height: number }): Promise<void> =>
      act(() => {
        Dimensions.set({ window: { ...size, scale: 3, fontScale: 1 }, screen: { ...size, scale: 3, fontScale: 1 } });
        keyboard.setScreen(size.width, size.height);
      });

    test('874 to 402: a hidden end frame in the small window is one hide motion and no show; the next real show scrolls once', async () => {
      await renderScreen();
      await keyboardWillShow();
      expect(mockScrollToBottom).toHaveBeenCalledTimes(1);
      await setWindow(LANDSCAPE);
      configureNext.mockClear();
      // Start: the keyboard in the landscape window (top 202, height 200); end: below that screen (402).
      await act(() => keyboard.changeFrame(402, 200, DURATION, { top: 202, height: 200 }));
      expect(configureNext.mock.calls).toEqual([[HIDE_MOTION]]);
      await act(() => jest.advanceTimersByTime(HIDE_MOTION.duration));
      expect(screen.queryByLabelText(KEY_BAR_LABEL, HIDDEN_TOO)).toBeNull();
      mockScrollToBottom.mockClear();
      configureNext.mockClear();
      await keyboardWillShow({ top: 202, height: 200 });
      expect(mockScrollToBottom.mock.calls).toEqual([['shell-1']]);
      expect(configureNext.mock.calls).toEqual([[SHOW_MOTION]]);
      expect(screen.queryByLabelText(KEY_BAR_LABEL, HIDDEN_TOO)).not.toBeNull();
    });

    test('the same with a hide after the end frame: one hide motion in all, hidden, the next show scrolls once', async () => {
      await renderScreen();
      await keyboardWillShow();
      await setWindow(LANDSCAPE);
      configureNext.mockClear();
      await act(() => keyboard.changeFrame(402, 200, DURATION, { top: 202, height: 200 }));
      await keyboardWillHide();
      expect(configureNext.mock.calls).toEqual([[HIDE_MOTION]]);
      await act(() => jest.advanceTimersByTime(HIDE_MOTION.duration));
      expect(screen.queryByLabelText(KEY_BAR_LABEL, HIDDEN_TOO)).toBeNull();
      mockScrollToBottom.mockClear();
      await keyboardWillShow({ top: 202, height: 200 });
      expect(mockScrollToBottom).toHaveBeenCalledTimes(1);
    });

    test('402 to 874: a portrait show while the landscape keyboard is up is not discarded, no appearance, no scroll, the right overlap', async () => {
      await renderScreen();
      await setWindow(LANDSCAPE);
      await keyboardWillShow({ top: 202, height: 200 });
      expect(mockScrollToBottom).toHaveBeenCalledTimes(1);
      await layoutTerminalArea(700);
      await caretAt(680);
      mockScrollToBottom.mockClear();
      await setWindow(WINDOW);
      configureNext.mockClear();
      await keyboardWillShow(KEYBOARD);
      expect(mockScrollToBottom).not.toHaveBeenCalled();
      expect(screen.queryByLabelText(KEY_BAR_LABEL, HIDDEN_TOO)).not.toBeNull();
      // 336 + 88 - 34: the keyboard and the key bar over the terminal view's bottom.
      expect(terminalTop()).toBe(-390);
      expect(configureNext.mock.calls).toEqual([[SHOW_MOTION]]);
    });

    test('a turn with the keyboard up and a show that re-lays it out is no appearance', async () => {
      await renderScreen();
      await keyboardWillShow();
      mockScrollToBottom.mockClear();
      await setWindow(LANDSCAPE);
      await keyboardWillShow({ top: 202, height: 200 });
      expect(mockScrollToBottom).not.toHaveBeenCalled();
    });

    test('a repeated show or frame change while the keyboard is really up is no appearance', async () => {
      await renderScreen();
      await keyboardWillShow();
      mockScrollToBottom.mockClear();
      await keyboardWillShow();
      await keyboardWillShow({ top: 498, height: 376 });
      await keyboardWillShow({ top: 598, height: 276 });
      expect(mockScrollToBottom).not.toHaveBeenCalled();
    });
  });

  test('a terminal mounted while the keyboard is up sees no appearance, and a lowering frame is one hide motion', async () => {
    // The store follows the keyboard from the app chrome on; here a consumer stands in for it.
    const chrome = await renderHook(() => useKeyboardFrame());
    await keyboardWillShow();
    await renderScreen();
    expect(mockScrollToBottom).not.toHaveBeenCalled();
    configureNext.mockClear();
    await act(() => keyboard.changeFrame(598, 276, DURATION));
    expect(configureNext.mock.calls).toEqual([[HIDE_MOTION]]);
    expect(mockScrollToBottom).not.toHaveBeenCalled();
    await chrome.unmount();
  });
});
