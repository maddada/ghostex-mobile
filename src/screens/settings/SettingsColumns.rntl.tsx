/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. Settings in two columns on the unfolded iPhone Duo: turning between one and
 * two columns keeps the user's place, so a page open in one column keeps its local state (an unsaved draft)
 * in the other; and the stack shows one list, the top screen's, not one per Settings screen in it.
 */

import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { SettingsColumnsFrame } from './SettingsColumns';

let mockTwoColumns = false;
let mockRouteIndex = 2;
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
  useRoute: () => mockRoutes[mockRouteIndex],
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
  LinkRow: ({ title }: { title: string }) =>
    jest.requireActual('react').createElement(jest.requireActual('react-native').Text, null, `row:${title}`),
  useSettingsStyles: () => ({ list: {} }),
  SettingsPageEdgesContext: jest.requireActual('react').createContext(null),
}));
jest.mock('./pages', () => ({
  SETTINGS_PAGES: { chat: { title: 'Chat' }, theme: { title: 'Theme' } },
  SETTINGS_PAGE_ORDER: ['theme', 'chat'],
}));

beforeEach(() => {
  mockRouteIndex = 2;
});

describe('in two columns the stack holds one list', () => {
  const frame = () => (
    <SettingsColumnsFrame title="Chat">
      <Text>page</Text>
    </SettingsColumnsFrame>
  );

  test('the top Settings screen draws the list beside its page', async () => {
    mockTwoColumns = true;
    const top = await render(frame());
    expect(top.getAllByText(/^row:/).map((row) => row.props.children)).toEqual(['row:Theme', 'row:Chat']);
  });

  test('the Settings screen under it draws no list, only its page', async () => {
    mockTwoColumns = true;
    mockRouteIndex = 1;
    const covered = await render(frame());
    expect(covered.queryAllByText(/^row:/)).toEqual([]);
    expect(covered.getByText('page')).toBeTruthy();
  });
});

test('a Settings page keeps its unsaved draft across one, two and one columns', async () => {
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
