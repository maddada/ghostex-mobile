/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. REQ-NFR-001 AC1 (the terminal key bar keeps working as before, and its
 * keyboard hand-over does not regress) for the owner report "pen, 2026-10-27T14:44:42Z": "when the pen is
 * pressed the bar with the keys should come back WITHOUT JUMPING". The software keyboard stays up only if
 * the terminal asks for first responder while the editor still holds it; removing the editor first makes
 * UIKit resign it and the keyboard hides, then shows again. The real `TerminalKeyBar` with its real stores;
 * mocked are the boundaries only: the native module (the deferred `focusTerminal` is the hand-over),
 * haptics and storage (the library's own Jest mock); `console.warn`, the failure signal, is spied on.
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';

import TerminalKeyBar from './TerminalKeyBar';

const EDITOR = 'Terminal text editor';
const PEN_OPEN = 'Open text editor';
const PEN_CLOSE = 'Show terminal keys';

/** What the editor looked like at each moment the native hand-over was requested. */
let editorMountedAtHandOver: boolean[] = [];
let handOver: PromiseWithResolvers<boolean> | null = null;
const mockFocusTerminal = jest.fn();

jest.mock('../../../modules/ghostex-native/src', () => ({
  GhostexNative: {
    addListener: () => ({ remove: () => undefined }),
    setKeyModifiers: () => Promise.resolve(),
    sendKey: () => Promise.resolve(),
    sendText: () => Promise.resolve(),
    focusTerminal: (sessionKey: string) => mockFocusTerminal(sessionKey),
  },
}));
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

let warnSpy: jest.SpyInstance<void, Parameters<typeof console.warn>>;

beforeEach(() => {
  editorMountedAtHandOver = [];
  handOver = null;
  mockFocusTerminal.mockReset();
  mockFocusTerminal.mockImplementation(() => {
    editorMountedAtHandOver.push(screen.queryByLabelText(EDITOR) !== null);
    handOver = Promise.withResolvers<boolean>();
    return handOver.promise;
  });
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warnSpy.mockRestore();
});

async function openEditor(): Promise<void> {
  await render(<TerminalKeyBar sessionKey="s1" agentId="terminal" onDismissKeyboard={() => undefined} />);
  await fireEvent.press(screen.getByLabelText(PEN_OPEN));
  expect(screen.getByLabelText(EDITOR)).toBeTruthy();
}

/** The pen pressed again; the first-responder request is still pending afterwards. */
async function pressPenToClose(): Promise<void> {
  await fireEvent.press(screen.getByLabelText(PEN_CLOSE));
  // A timer-deferred request (the old behaviour) must also have run by now.
  await act(async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 20);
    await promise;
  });
}

describe('the pen button brings the key rows back without the keyboard jumping (REQ-NFR-001 AC1, owner report "pen, 2026-10-27T14:44:42Z")', () => {
  test('REQ-NFR-001 AC1: the terminal is asked for focus while the editor still holds it, and the editor stays until the answer', async () => {
    await openEditor();
    await pressPenToClose();

    expect(mockFocusTerminal).toHaveBeenCalledTimes(1);
    expect(mockFocusTerminal).toHaveBeenCalledWith('s1');
    // The editor is the first responder: removing it before the hand-over would hide the keyboard.
    expect(editorMountedAtHandOver).toEqual([true]);
    expect(screen.queryByLabelText(EDITOR)).not.toBeNull();
    expect(screen.queryByLabelText('ESC')).toBeNull();
  });

  test('REQ-NFR-001 AC1: once the terminal took the focus, the key rows are back and the editor is gone', async () => {
    await openEditor();
    await pressPenToClose();
    await act(async () => {
      handOver?.resolve(true);
    });

    expect(screen.queryByLabelText(EDITOR)).toBeNull();
    expect(screen.getByLabelText('ESC')).toBeTruthy();
    expect(screen.getByLabelText(PEN_OPEN)).toBeTruthy();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  test('REQ-NFR-001 AC1: a second pen press while the hand-over is pending does not ask again', async () => {
    await openEditor();
    await pressPenToClose();
    await fireEvent.press(screen.getByLabelText(PEN_CLOSE));

    expect(mockFocusTerminal).toHaveBeenCalledTimes(1);
  });

  test('REQ-NFR-001 AC1: the terminal could not take the focus: the keys come back anyway and the refusal is logged', async () => {
    await openEditor();
    await pressPenToClose();
    await act(async () => {
      handOver?.resolve(false);
    });

    expect(screen.queryByLabelText(EDITOR)).toBeNull();
    expect(screen.getByLabelText('ESC')).toBeTruthy();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]).toEqual([expect.stringMatching(/refused the keyboard focus for session s1/)]);
  });

  test('REQ-NFR-001 AC1: the hand-over rejects: the keys come back anyway and the error is logged', async () => {
    const failure = new Error('no terminal');
    await openEditor();
    await pressPenToClose();
    await act(async () => {
      handOver?.reject(failure);
    });

    expect(screen.queryByLabelText(EDITOR)).toBeNull();
    expect(screen.getByLabelText('ESC')).toBeTruthy();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]).toEqual([expect.stringMatching(/failed for session s1/), failure]);
  });
});
