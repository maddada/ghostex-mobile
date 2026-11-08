/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. Dictate's row above the chat box names what transcribes, offers
 * Skip while AI polish runs, and when Hex on the computer isn't ready offers Set up Hex instead of
 * Transcribe again. The real `DictationBar`; mocked are the native module and storage.
 */

import { fireEvent, render, screen } from '@testing-library/react-native';

import { DictationBar } from './DictationBar';

// The bar's module reaches the recorder through `useDictation.ts`; nothing here records.
jest.mock('../../../../modules/ghostex-native/src', () => ({
  GhostexNative: { addListener: () => ({ remove: () => undefined }) },
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

const handlers = () => ({ onCancel: jest.fn(), onRetry: jest.fn(), onSkip: jest.fn(), onFix: jest.fn() });

test('recording and transcribing name the engine', async () => {
  const on = handlers();
  await render(
    <DictationBar phase="recording" elapsedMs={7_000} failure={null} engine="Hex, Parakeet v3" fix={null} {...on} />,
  );
  expect(screen.getByText('Recording 0:07 · Hex, Parakeet v3')).toBeTruthy();
  await render(
    <DictationBar phase="transcribing" elapsedMs={0} failure={null} engine="xAI speech to text" fix={null} {...on} />,
  );
  expect(screen.getByText('Transcribing with xAI speech to text…')).toBeTruthy();
});

test('polishing offers Skip', async () => {
  const on = handlers();
  await render(<DictationBar phase="polishing" elapsedMs={0} failure={null} engine={null} fix={null} {...on} />);
  expect(screen.getByText('Polishing with AI…')).toBeTruthy();
  await fireEvent.press(screen.getByText('Skip'));
  expect(on.onSkip).toHaveBeenCalledTimes(1);
});

test('Hex that is not ready offers Set up Hex instead of Transcribe again', async () => {
  const on = handlers();
  await render(
    <DictationBar
      phase="failed"
      elapsedMs={0}
      failure="Hex isn't running on this computer. Open Hex."
      engine="Hex"
      fix={{ kind: 'settings', label: 'Set up Hex' }}
      {...on}
    />,
  );
  expect(screen.queryByText('Transcribe again')).toBeNull();
  await fireEvent.press(screen.getByText('Set up Hex'));
  expect(on.onFix).toHaveBeenCalledTimes(1);
});

test('any other failure keeps Transcribe again', async () => {
  const on = handlers();
  await render(
    <DictationBar phase="failed" elapsedMs={0} failure="No key." engine={null} fix={null} {...on} />,
  );
  await fireEvent.press(screen.getByText('Transcribe again'));
  expect(on.onRetry).toHaveBeenCalledTimes(1);
});
