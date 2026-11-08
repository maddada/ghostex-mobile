/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. The chat composer stays above the keyboard as before, with the bottom
 * inset counted once: the composer's frame (`KeyboardLiftedView`, NativeComposer's root) lifts it from the keyboard's
 * last reported frame, again when the window's height changes without a keyboard event (a fold, unfold or
 * rotation) and when its own layout changes; in a pane slot the pane holds the keyboard's cover and nothing lifts.
 * In a pane slot the composer (`NativeComposer`) also takes its compact form: under the field one row of the model
 * pill, More actions, Dictate and Send, without the pill strip, the other option pills, the toolbar controls, Copy
 * Report and the status line, which the full chat view still shows. The chat is a stand-in built from the composer
 * preview's document; dictation (which needs a computer) is a stand-in that is available.
 * Frames in window points: the folded display 466x678 with the keyboard's top at 413 (measured on a device), the home
 * indicator inset 20.
 */

import { Dimensions, StyleSheet, Text } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';

import { keyboardFixture } from '../../../components/common/keyboard/keyboardEventFixtures';
import { ChatPlacementProvider } from '../chatPlacement';
import { KeyboardLiftedView } from './KeyboardLiftedView';
import type { ChatDocument } from '../../rust/document';
import { ComposerModel } from '../../rust/composer';
import type { RustChat } from '../../rust/useRustChat';
import data from './__preview-data__.json';
import { NativeComposer } from './NativeComposer';

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 20, left: 0, right: 0 }),
}));
// The composer's motion runs on Reanimated, whose native side a Jest run has not: a stand-in that lands every tween
// at once and draws an animated view as a plain one.
jest.mock('react-native-reanimated', () => {
  const { View } = jest.requireActual('react-native');
  return {
    __esModule: true,
    default: { View, createAnimatedComponent: (component: unknown) => component },
    Easing: { bezier: () => (t: number) => t },
    cancelAnimation: () => undefined,
    runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
    useAnimatedStyle: (style: () => object) => style(),
    useReducedMotion: () => false,
    useSharedValue: (value: unknown) => ({ value }),
    withDelay: (_ms: number, value: unknown) => value,
    withSequence: (...values: unknown[]) => values[values.length - 1],
    withTiming: (value: unknown) => value,
  };
});
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
// A web view module the composer's imports load (the chat's page sheets); nothing here draws one.
jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('../../../../modules/ghostex-native/src', () => ({
  GhostexNative: {
    addListener: () => ({ remove: () => undefined }),
    observeBarLayout: () => Promise.resolve({ id: 1, layout: null }),
    stopObservingBarLayout: () => Promise.resolve(),
  },
}));
// Dictate needs the chat's computer; here it is available and idle.
jest.mock('./useDictation', () => ({
  ...jest.requireActual('./useDictation'),
  useDictation: () => ({
    available: true,
    phase: 'idle',
    listening: false,
    failure: null,
    elapsedMs: 0,
    engine: null,
    fix: null,
    download: null,
    toggle: () => Promise.resolve(),
    cancel: () => Promise.resolve(),
    retry: () => Promise.resolve(),
    transcribePrevious: () => Promise.resolve(),
    previous: () => Promise.resolve(null),
    skipPolish: () => Promise.resolve(),
  }),
}));

/** The native methods React Native's Jest preset gives every View (`measureInWindow` measures nothing). */
const mockNativeMethods = jest.requireActual<{ default: { measureInWindow: jest.Mock } }>(
  '@react-native/jest-preset/jest/MockNativeMethods',
).default;

/** The composer's frame in the window, as the composer measures itself: its bottom on the window's. */
let composer = { y: 578, height: 100 };

async function setWindow(width: number, height: number): Promise<void> {
  await act(() => {
    Dimensions.set({
      window: { width, height, scale: 3, fontScale: 1 },
      screen: { width, height, scale: 3, fontScale: 1 },
    });
  });
}

/** The notifications iOS posts, with their start and end frames (keyboardEventFixtures.ts). */
const keyboard = keyboardFixture({ width: 466, height: 678 });

async function keyboardAt(top: number, height: number): Promise<void> {
  await act(() => keyboard.show(top, height, 0));
}

/** The space below the composer's content: the lift above the keyboard, or the bottom inset. */
function bottomPadding(): number | undefined {
  const frame = screen.getByText('composer').parent;
  return StyleSheet.flatten(frame?.props.style)?.paddingBottom;
}

beforeEach(async () => {
  composer = { y: 578, height: 100 };
  mockNativeMethods.measureInWindow.mockImplementation(
    (onFrame: (x: number, y: number, width: number, height: number) => void) =>
      onFrame(0, composer.y, 466, composer.height),
  );
  await setWindow(466, 678);
  await act(() => keyboard.hide(0));
  await render(
    <KeyboardLiftedView>
      <Text>composer</Text>
    </KeyboardLiftedView>,
  );
});

afterEach(() => {
  mockNativeMethods.measureInWindow.mockReset();
});

test('the bottom inset once without a keyboard, 8 pt above the keyboard with one', async () => {
  expect(bottomPadding()).toBe(20);
  await keyboardAt(413, 265);
  expect(bottomPadding()).toBe(678 - 413 + 8);
});

test('a window height change without a keyboard event lifts it from the last keyboard frame', async () => {
  await keyboardAt(413, 265);
  // Unfolded in landscape: the window is 669 pt tall, the composer still on its bottom.
  composer = { y: 569, height: 100 };
  await setWindow(951, 669);
  expect(bottomPadding()).toBe(669 - 413 + 8);
});

test("the composer's own layout change measures the overlap again", async () => {
  await keyboardAt(413, 265);
  // The composer's bottom moves up 40 pt (a bar under it appeared): 40 pt less to lift.
  composer = { y: 538, height: 100 };
  const frame = screen.getByText('composer').parent;
  if (frame === null) throw new Error('the composer frame holds its content');
  await act(() => {
    fireEvent(frame, 'layout', { nativeEvent: { layout: { x: 0, y: 538, width: 466, height: 100 } } });
  });
  expect(bottomPadding()).toBe(225 + 8);
});

test('a function child gets the padding in the same render the keyboard height changes (the composer sizes its field by it)', async () => {
  const rendered: number[] = [];
  await screen.unmount();
  await render(
    <KeyboardLiftedView>
      {(bottom) => {
        rendered.push(bottom);
        return <Text>composer</Text>;
      }}
    </KeyboardLiftedView>,
  );
  expect(rendered.at(-1)).toBe(bottomPadding());
  rendered.length = 0;
  await keyboardAt(413, 265);
  // Every render after the keyboard's frame arrived already carries the new padding: no render holds the old one.
  expect(rendered.length).toBeGreaterThan(0);
  expect(rendered.every((bottom) => bottom === 678 - 413 + 8)).toBe(true);
  // The padding drawn is the padding handed over.
  expect(bottomPadding()).toBe(rendered.at(-1));
});

test('in a pane the pane ends at the keyboard: the composer keeps only its least space, with or without one', async () => {
  await screen.unmount();
  await render(
    <ChatPlacementProvider value={{ inPane: true, size: { width: 466, height: 300 } }}>
      <KeyboardLiftedView>
        <Text>composer</Text>
      </KeyboardLiftedView>
    </ChatPlacementProvider>,
  );
  expect(bottomPadding()).toBe(12);
  await keyboardAt(413, 265);
  expect(bottomPadding()).toBe(12);
});

describe('the composer in a pane slot takes the compact form; the full chat view keeps everything', () => {
  /** A session chat whose composer shows every part: a mode menu, a starred status value, a terminal not ready. */
  function chat(): RustChat {
    const preview = data.doc as unknown as ChatDocument;
    const document = {
      ...preview,
      working: false,
      composerCollapsed: false,
      composerOverflow: { overflowed: [], optionsOverflowed: false },
      terminalTail: { ...preview.terminalTail, readiness: 'notReady' },
      contextMeter: { ...(preview.contextMeter as object), starred: [{ label: 'Branch', value: 'main' }] },
    } as unknown as ChatDocument;
    const model = new ComposerModel({
      dispatch: () => undefined,
      document: () => document,
      onChange: () => undefined,
      onSendBlocked: () => undefined,
      onFocusRequested: () => undefined,
    });
    model.init({ clientId: 'test', entry: { text: '' } }, 'session');
    return {
      state: {
        status: 'running',
        revision: 1,
        document,
        items: [],
        subagentItems: [],
        minimap: [],
        rowDetails: {},
        composer: model.state,
        images: {},
        error: null,
        stats: {} as never,
        queryRevision: 0,
      },
      dispatch: () => undefined,
      measure: () => undefined,
      setTitle: () => undefined,
      composer: {
        edited: (text, selection) => model.edited(text, selection),
        selected: (selection) => model.selected(selection),
        focused: () => model.focused(),
        blurred: () => model.blurred(),
        submit: (mode) => model.submit(mode),
        replace: (text) => model.replace(text, null, false),
      },
      attachFiles: async () => undefined,
      uploadFiles: async () => [],
      query: () => null,
      queryAsync: async () => null,
      onViewRequest: () => () => undefined,
      machine: null,
    } as RustChat;
  }

  async function renderComposer(inPane: boolean): Promise<void> {
    await screen.unmount();
    await render(
      <ChatPlacementProvider value={{ inPane, size: inPane ? { width: 466, height: 300 } : null }}>
        <NativeComposer
          projectId="project"
          sessionId="session"
          chat={chat()}
          onHostAction={() => undefined}
          strip={<Text>Pill strip</Text>}
        />
      </ChatPlacementProvider>,
    );
  }

  /** The labels of the buttons in the row under the field, in order. */
  function rowUnderTheField(): string[] {
    const footer = screen.getByLabelText('More actions').parent?.parent;
    if (footer === null || footer === undefined) throw new Error('no row under the field');
    return within(footer)
      .getAllByRole('button')
      .map((button) => String(button.props.accessibilityLabel));
  }

  const NOT_IN_A_PANE = ['Pill strip', 'main'];
  const NOT_IN_A_PANE_LABELS = ['Mode: Auto', 'Copy Report', 'Attach a file or folder', 'Terminal View'];

  test('in a pane: the model pill, More actions, Dictate and Send, and nothing of the strip, mode, Copy Report or status line', async () => {
    await renderComposer(true);
    const row = rowUnderTheField();
    expect(row.slice(0, 3)).toEqual(['Model: Sonnet 5', 'More actions', 'Dictate']);
    expect(row).toHaveLength(4);
    expect(row[3]).toMatch(/^Send/);
    for (const text of NOT_IN_A_PANE) expect(screen.queryByText(text)).toBeNull();
    for (const label of NOT_IN_A_PANE_LABELS) expect(screen.queryByLabelText(label)).toBeNull();
  });

  test('the full chat view still shows the strip, the mode pill, the toolbar, Copy Report and the status line', async () => {
    await renderComposer(false);
    for (const text of NOT_IN_A_PANE) expect(screen.getByText(text)).toBeTruthy();
    // The option pills are also drawn once more, unseen, for the footer's fit (`styles.measure`).
    for (const label of NOT_IN_A_PANE_LABELS) expect(screen.getAllByLabelText(label).length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Dictate')).toBeTruthy();
  });
});
