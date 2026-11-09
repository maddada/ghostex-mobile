/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. Settings > Updates: the over-the-air status line in its accent ("An update is
 * ready.") and error ("The last update check failed") tones keeps 4.5:1 (WCAG AA for normal-size text) on the page in
 * every preset. The real page and stores; mocked are the boundaries only: expo-updates (its state as
 * `useUpdates()` reports it), navigation, storage, the native module and the safe area.
 */

import { StyleSheet } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

import { useSettingsStore } from '../../settings/store';
import { THEME_PRESETS, themePresetPatch } from '../../theme/presets';
import UpdatesPage from './UpdatesPage';

/** What `useUpdates()` reports; each test sets the state it shows. */
const mockUpdates: Record<string, unknown> = {};
jest.mock('expo-updates', () => ({
  isEnabled: true,
  useUpdates: () => mockUpdates,
  checkForUpdateAsync: () => Promise.resolve({ isAvailable: false }),
  fetchUpdateAsync: () => Promise.resolve(),
  reloadAsync: () => Promise.resolve(),
}));
jest.mock('../../../modules/ghostex-native/src', () => ({ GhostexNative: {} }));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-safe-area-context', () => {
  const { View } = jest.requireActual('react-native');
  return { SafeAreaView: View, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => ({ setOptions: () => undefined }),
  useFocusEffect: () => undefined,
}));

/** WCAG contrast of two `#rrggbb` colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5]
      .map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const IDLE = {
  isChecking: false,
  isDownloading: false,
  downloadProgress: null,
  checkError: null,
  downloadError: null,
  isUpdatePending: false,
  downloadedUpdate: undefined,
};

const TONES = [
  ['accent', { isUpdatePending: true }, 'An update is ready.'],
  [
    'error',
    { checkError: { message: 'the server did not answer' } },
    'The last update check failed: the server did not answer',
  ],
] as const;

const initialSettings = useSettingsStore.getState().settings;

afterEach(async () => {
  await act(() => {
    useSettingsStore.setState({ settings: initialSettings });
  });
});

describe.each(TONES)('the %s status line', (_tone, state, text) => {
  test.each(THEME_PRESETS.map((preset) => [preset.id, preset.mode] as const))(
    '%s (%s): keeps 4.5:1 on the page',
    async (preset) => {
      const patch = themePresetPatch(preset, false);
    if (patch === undefined) throw new Error(`Unknown preset ${preset}`);
    useSettingsStore.getState().patchSettings(patch);
      Object.assign(mockUpdates, IDLE, state);
      await render(<UpdatesPage />);
      const line = screen.getByText(text);
      let page = line.parent;
      while (page !== null && !String(StyleSheet.flatten(page.props.style)?.backgroundColor ?? '').startsWith('#')) {
        page = page.parent;
      }
      const surface = String(StyleSheet.flatten(page!.props.style).backgroundColor);
      const ink = String(StyleSheet.flatten(line.props.style).color);
      expect(contrast(ink, surface)).toBeGreaterThanOrEqual(4.5);
    },
  );
});
