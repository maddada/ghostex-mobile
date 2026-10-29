/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. Owner decision F2 (2026-10-26, "Zweispaltig wie iPad-Einstellungen";
 * §1.5 S1-6) with FL-LAY-14: turning the unfolded Duo between one and two Settings columns keeps the
 * user's place, so a page open in one column keeps its local state (an unsaved draft) in the other.
 */

import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { SettingsColumnsFrame } from './SettingsColumns';

let mockTwoColumns = false;
const mockRoutes = [
  { name: 'Sessions', key: 'sessions' },
  { name: 'Settings', key: 'settings' },
  { name: 'SettingsPage', key: 'page', params: { page: 'chat' } },
];

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({}),
  useRoute: () => mockRoutes[2],
  useNavigationState: (select: (state: { routes: typeof mockRoutes }) => unknown) => select({ routes: mockRoutes }),
  CommonActions: {},
  StackActions: {},
}));
jest.mock('../../components/common/verticalBar/VerticalBarArea', () => ({
  useTwoColumns: () => mockTwoColumns,
  useVerticalBarSpace: () => ({ left: 0, right: 0 }),
  useScrollToBarEdges: () => ({ scroll: undefined, content: undefined }),
}));
jest.mock('../../components/common/verticalBar/StackHeader', () => ({ ContentTitleRow: () => null }));
jest.mock('../../components/common/verticalBar/stackRail', () => ({ useStackScreenRail: () => undefined }));
jest.mock('../../theme/useAppearance', () => ({
  useAppearance: () => ({ background: 'black', foreground: 'white', border: 'gray' }),
}));
jest.mock('../../updates/updateNotice', () => ({ useUpdateNotice: () => null }));
jest.mock('./SettingsControls', () => ({
  LinkRow: () => null,
  useSettingsStyles: () => ({ list: {} }),
  SettingsPageEdgesContext: jest.requireActual('react').createContext(null),
}));
jest.mock('./pages', () => ({
  SETTINGS_PAGES: { chat: { title: 'Chat' }, theme: { title: 'Theme' } },
  SETTINGS_PAGE_ORDER: ['theme', 'chat'],
}));

test('REQ-DUO-001 AC5, owner F2, FL-LAY-14: a Settings page keeps its unsaved draft across one, two and one columns', async () => {
  let mounts = 0;
  let unmounts = 0;
  function Page() {
    const [draft, setDraft] = useState('');
    useEffect(() => {
      mounts += 1;
      return () => {
        unmounts += 1;
      };
    }, []);
    return (
      <Text testID="draft" onPress={() => setDraft('unsaved draft')}>
        {`draft:${draft}`}
      </Text>
    );
  }
  const frame = () => (
    <SettingsColumnsFrame title="Chat">
      <Page />
    </SettingsColumnsFrame>
  );

  mockTwoColumns = false;
  const screen = await render(frame());
  await act(async () => {
    screen.getByTestId('draft').props.onPress();
  });
  expect(screen.getByTestId('draft').props.children).toBe('draft:unsaved draft');

  mockTwoColumns = true;
  await screen.rerender(frame());
  expect(screen.getByTestId('draft').props.children).toBe('draft:unsaved draft');

  mockTwoColumns = false;
  await screen.rerender(frame());
  expect(screen.getByTestId('draft').props.children).toBe('draft:unsaved draft');
  expect({ mounts, unmounts }).toEqual({ mounts: 1, unmounts: 0 });
});
