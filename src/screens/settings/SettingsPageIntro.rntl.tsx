/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. Every Settings page shows its one-line intro under its title: the
 * line `pages.ts` gives the page, unless the page passes its own. The real layout; mocked are the
 * safe area, the bar placement and the header hook.
 */

import type { ReactNode } from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { SETTINGS_PAGES, type SettingsPageId } from './pages';
import { SettingsPageIntro, SettingsScreenLayout } from './SettingsControls';

jest.mock('../../../modules/ghostex-native/src', () => ({
  GhostexNative: { addListener: () => ({ remove: () => undefined }) },
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  SafeAreaView: ({ children }: { children?: ReactNode }) => children,
}));
jest.mock('../../components/common/verticalBar/VerticalBarArea', () => ({
  useHeaderPlacement: () => ({ kind: 'top' }),
  useScrollToBarEdges: () => ({ scroll: undefined, content: undefined }),
  useVerticalBarSpace: () => ({ left: 0, right: 0, padding: undefined }),
}));
jest.mock('./useAppearanceHeader', () => ({ useAppearanceHeader: () => undefined }));

test('a page shows its own line from pages.ts under its title', async () => {
  await render(
    <SettingsPageIntro.Provider value={SETTINGS_PAGES.voice.description}>
      <SettingsScreenLayout>
        <Text>Dictate on MacBook Pro</Text>
      </SettingsScreenLayout>
    </SettingsPageIntro.Provider>,
  );
  expect(screen.getByText('Dictation with Hex or your key, and the voice agent, on each computer.')).toBeTruthy();
});

test("a page's own intro wins over the shared line", async () => {
  await render(
    <SettingsPageIntro.Provider value={SETTINGS_PAGES.advanced.description}>
      <SettingsScreenLayout intro="Older and rarely needed settings.">
        <Text>Rows</Text>
      </SettingsScreenLayout>
    </SettingsPageIntro.Provider>,
  );
  expect(screen.getByText('Older and rarely needed settings.')).toBeTruthy();
  expect(screen.queryByText(SETTINGS_PAGES.advanced.description)).toBeNull();
});

test('every page has a one-line intro', () => {
  for (const [page, { description }] of Object.entries(SETTINGS_PAGES) as [SettingsPageId, { description: string }][]) {
    expect([page, description.trim().length > 0 && !description.includes('\n')]).toEqual([page, true]);
  }
});
