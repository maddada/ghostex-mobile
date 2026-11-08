/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. Settings in two columns with the app's real stack navigator: a row tap
 * opens its page beside the list and keeps the list where the user scrolled it, also on the first tap
 * from the bare Settings list (that tap hands the list to the page screen it opens); a tap on the open
 * page's own row keeps that page. A page opened from the default page (Interface beside the bare list,
 * which has no route of its own) has a Back that returns to it, with Interface selected in the list.
 */

import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator, type NativeStackScreenProps } from '@react-navigation/native-stack';
import { Text } from 'react-native';
import { act, fireEvent, render, type RenderResult } from '@testing-library/react-native';

import type { RootStackParamList } from '../../navigation/types';
import { SettingsColumnsFrame } from './SettingsColumns';

jest.mock('react-native-safe-area-context', () =>
  jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../components/common/verticalBar/VerticalBarArea', () => ({
  useTwoColumns: () => true,
  useVerticalBarSpace: () => ({ left: 0, right: 0 }),
  useScrollToBarEdges: () => ({ scroll: undefined, content: undefined }),
}));
jest.mock('../../components/common/verticalBar/StackHeader', () => ({
  ContentTitleRow: ({ title, onBack }: { title: string; onBack?: () => void }) =>
    onBack === undefined
      ? null
      : jest
          .requireActual('react')
          .createElement(jest.requireActual('react-native').Text, { onPress: onBack }, `back:${title}`),
}));
jest.mock('../../components/common/verticalBar/stackRail', () => ({ useStackScreenRail: () => undefined }));
jest.mock('../../theme/useAppearance', () => ({
  useAppearance: () => ({ background: 'black', foreground: 'white', border: 'gray' }),
}));
jest.mock('../../updates/updateNotice', () => ({ useUpdateNotice: () => null }));
jest.mock('./SettingsControls', () => ({
  LinkRow: ({ title, selected, onPress }: { title: string; selected?: boolean; onPress: () => void }) =>
    jest
      .requireActual('react')
      .createElement(
        jest.requireActual('react-native').Text,
        { onPress, accessibilityState: { selected } },
        `row:${title}`,
      ),
  useSettingsStyles: () => ({ list: {} }),
  SettingsPageEdgesContext: jest.requireActual('react').createContext(null),
}));
jest.mock('../../machines/store', () => {
  const state = { machines: [] as { id: string; transport?: string }[] };
  const useMachinesStore = Object.assign(
    (selector?: (value: typeof state) => unknown) => (typeof selector === 'function' ? selector(state) : state),
    { getState: () => state },
  );
  return { useMachinesStore };
});
jest.mock('./pages', () => ({
  SETTINGS_PAGES: {
    theme: { title: 'Interface' },
    chat: { title: 'Chat' },
    advanced: { title: 'Advanced' },
    terminalPaletteDark: { title: 'Palette' },
  },
  SETTINGS_PAGE_ORDER: ['theme', 'chat', 'advanced'],
}));

const Stack = createNativeStackNavigator<RootStackParamList>();

function SettingsRoot() {
  return (
    <SettingsColumnsFrame title="Interface" single={<Text>one column</Text>}>
      <Text>page:theme</Text>
    </SettingsColumnsFrame>
  );
}

function SettingsPage({ route }: NativeStackScreenProps<RootStackParamList, 'SettingsPage'>) {
  return (
    <SettingsColumnsFrame title={route.params.page}>
      <Text>{`page:${route.params.page}`}</Text>
    </SettingsColumnsFrame>
  );
}

const navigationRef = createNavigationContainerRef<RootStackParamList>();

function settings() {
  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator initialRouteName="Settings">
        <Stack.Screen name="Settings" component={SettingsRoot} />
        <Stack.Screen name="SettingsPage" component={SettingsPage} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

/** The list's scroll view: the host scroll view around a row. The stack draws one list. */
function listScroll(screen: RenderResult) {
  const rows = screen.getAllByText('row:Advanced');
  expect(rows).toHaveLength(1);
  let node = rows[0]?.parent ?? null;
  while (node !== null && node.type !== 'RCTScrollView') node = node.parent;
  if (node === null) throw new Error('the list row sits in no scroll view');
  return node;
}

const SCROLLED = { nativeEvent: { contentOffset: { x: 0, y: 480 } } };

test('a row tap keeps the list where it is, from the bare list and from an open page', async () => {
  const screen = await render(settings());
  expect(screen.getByText('page:theme')).toBeTruthy();

  // The bare Settings list, scrolled down: the first tap opens a page screen, whose list starts there.
  await fireEvent.scroll(listScroll(screen), SCROLLED);
  await act(async () => {
    fireEvent.press(screen.getByText('row:Advanced'));
  });
  expect(screen.getByText('page:advanced')).toBeTruthy();
  const pageList = listScroll(screen);
  expect(pageList.props.contentOffset).toEqual({ x: 0, y: 480 });

  // The next tap shows the other page in that same screen: the same list, never moved.
  await act(async () => {
    fireEvent.press(screen.getByText('row:Chat'));
  });
  const chatPage = screen.getByText('page:chat');
  expect(screen.queryByText('page:advanced')).toBeNull();
  expect(listScroll(screen)).toBe(pageList);
  expect(listScroll(screen).props.contentOffset).toEqual({ x: 0, y: 480 });

  // A tap on the open page's own row keeps that page as it is (an unsaved draft in it stays).
  await act(async () => {
    fireEvent.press(screen.getByText('row:Chat'));
  });
  expect(screen.getByText('page:chat')).toBe(chatPage);
  expect(listScroll(screen)).toBe(pageList);
});

test('a palette opened from the default page has a Back to Interface, selected in the list', async () => {
  const screen = await render(settings());
  expect(screen.getByText('page:theme')).toBeTruthy();
  // The default page has no route of its own, so no Back beside it.
  expect(screen.queryByText(/^back:/)).toBeNull();

  // Interface's palette row opens a page that no list row carries, straight from the bare Settings.
  await act(async () => {
    navigationRef.navigate('SettingsPage', { page: 'terminalPaletteDark' });
  });
  expect(screen.getByText('page:terminalPaletteDark')).toBeTruthy();
  expect(screen.getByText('row:Interface').props.accessibilityState).toEqual({ selected: true });
  expect(screen.getByText('row:Chat').props.accessibilityState).toEqual({ selected: false });

  // Its Back returns to Interface (not out of Settings): the stack is the bare Settings again.
  await act(async () => {
    fireEvent.press(screen.getByText('back:terminalPaletteDark'));
  });
  expect(navigationRef.getRootState()?.routes.map((route) => route.name)).toEqual(['Settings']);
  expect(screen.getByText('page:theme')).toBeTruthy();
  expect(screen.queryByText('page:terminalPaletteDark')).toBeNull();
  expect(screen.queryByText(/^back:/)).toBeNull();
  expect(screen.getByText('row:Interface').props.accessibilityState).toEqual({ selected: true });
});
