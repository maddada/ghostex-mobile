/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. The Notifications screen's "…" menu (read state shared with the computer's bell) with
 * the notifications design: its list-menu state, standing under the "…" at the top right on every iPhone, with one
 * command, Clear Done: it marks read on the computer the finished rows that keep sessions under Done and nothing else,
 * so it asks nothing first; it is off while Done is empty; Done rows of a computer that cannot be reached bring the
 * line that the change was not taken. Accessibility: the command and a Close menu button are their own accessibility
 * elements, none grouped into an ancestor iOS would read as one element. The real screen,
 * `AttentionList`, `ContextMenu` and stores; mocked are the boundaries only: navigation (a stand-in that draws the
 * header button the screen sets), the native module, expo-notifications, storage, the safe area and the requests to
 * the computer.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';

import { useMachinesStore, type MachineRecord } from '../machines/store';
import type { FeedRow } from '../notifications/feedContract';
import { clearDone, useAttentionFeedStore } from '../notifications/feedStore';
import type * as FeedStoreModule from '../notifications/feedStore';
import { NotificationsCopy } from '../copy';
import { useSettingsStore } from '../settings/store';
import { THEME_PRESETS, themePresetPatch } from '../theme/presets';
import AttentionListScreen from './AttentionListScreen';

jest.mock('../../modules/ghostex-native/src', () => ({ GhostexNative: {} }));
jest.mock('expo-notifications', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-safe-area-context', () => {
  const { View: MockView } = jest.requireActual('react-native');
  return { SafeAreaView: MockView, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
// `useAppearanceHeader` paints the header through `useNavigation`; native header painting is outside this test.
const mockHeaderNavigation = { setOptions: () => undefined };
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockHeaderNavigation,
  useFocusEffect: () => undefined,
  useRoute: () => ({ key: 'attention', name: 'AttentionList' }),
}));
jest.mock('../notifications/feedStore', () => ({
  ...jest.requireActual('../notifications/feedStore'),
  updateAttentionFeed: jest.fn(() => Promise.resolve(true)),
  markAttentionRowsRead: jest.fn(() => Promise.resolve(true)),
  clearDone: jest.fn(() => Promise.resolve(true)),
  refreshAttentionFeeds: jest.fn(() => Promise.resolve()),
}));

const clear = jest.mocked(clearDone);

/** The native methods React Native's Jest preset gives every View (`measureInWindow` measures nothing). */
const mockNativeMethods = jest.requireActual<{ default: { measureInWindow: jest.Mock } }>(
  '@react-native/jest-preset/jest/MockNativeMethods',
).default;

const MACHINE: MachineRecord = {
  id: 'm1',
  name: 'Mac mini',
  host: 'mac-mini.local',
  username: 'owner',
  port: 22,
  savePassword: false,
  lastConnectedAt: null,
};

function feedRow(id: string, read: boolean, kind: FeedRow['kind'] = 'finished'): FeedRow {
  return {
    id,
    projectId: 'p1',
    sessionId: `s-${id}`,
    kind,
    title: 'Session',
    subtitle: 'ghostex-mobile',
    agentName: 'codex',
    createdAt: '2026-10-29T10:00:00.000Z',
    read,
  };
}

/** The native stack's header as far as this screen uses it: the button it sets as `headerRight`. */
function Navigator() {
  const [headerRight, setHeaderRight] = useState<(() => ReactNode) | null>(null);
  const navigation = useMemo(
    () => ({
      setOptions: (options: { headerRight?: () => ReactNode }) => {
        if (options.headerRight !== undefined) setHeaderRight(() => options.headerRight ?? null);
      },
      navigate: () => undefined,
    }),
    [],
  );
  return (
    <>
      <View testID="header">{headerRight?.()}</View>
      <AttentionListScreen
        // The cast holds for what the screen calls on its navigation: `setOptions` and `navigate`, both above.
        navigation={navigation as unknown as Parameters<typeof AttentionListScreen>[0]['navigation']}
        route={{ key: 'attention', name: 'AttentionList', params: undefined }}
      />
    </>
  );
}

async function openMenu() {
  await fireEvent.press(within(screen.getByTestId('header')).getByRole('button', { name: 'Notifications' }));
}

/** A menu command: a button on iOS (React Native's `menuitem` has no role there; `ContextMenu.tsx`). */
const item = (name: string) => screen.getByRole('button', { name });

/** Ancestors iOS reads as one accessibility element together with `node` (React Native's `accessible`). */
function groupingAncestors(node: TestInstance) {
  const grouping: string[] = [];
  for (let parent = node.parent; parent !== null; parent = parent.parent) {
    if (parent.props.accessible === true) grouping.push(String(parent.props.accessibilityLabel ?? parent.type));
  }
  return grouping;
}

beforeEach(() => {
  clear.mockClear();
  // The "…" button in the header of an iPhone 17 (402 pt wide), measured for the menu it opens.
  mockNativeMethods.measureInWindow.mockImplementation(
    (onFrame: (x: number, y: number, width: number, height: number) => void) => onFrame(350, 62, 36, 36),
  );
  useMachinesStore.setState({ machines: [MACHINE] });
  // The removed sessions are loaded (an empty record): before that no Done row shows.
  useSettingsStore.setState({ hydrated: true });
  useAttentionFeedStore.setState({
    // Two sessions under Done, one under Failed, one finished row already read.
    feeds: {
      m1: {
        status: 'ready',
        rows: [feedRow('n1', false), feedRow('n2', true), feedRow('n3', false), feedRow('n4', false, 'failed')],
      },
    },
    permission: 'granted',
  });
});

afterEach(() => {
  mockNativeMethods.measureInWindow.mockReset();
});

test('the "…" menu offers Clear Done alone; it clears the Done sessions at once, with no question first', async () => {
  await render(<Navigator />);
  await openMenu();
  expect(screen.getByText('Read state is shared with the bell on your computer')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Mark All Read' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Clear All' })).toBeNull();
  expect(item('Clear Done').props.accessibilityState).toMatchObject({ disabled: false });

  await fireEvent.press(item('Clear Done'));
  expect(clear.mock.calls.map(([done]) => done.map((row) => [row.id, row.stateIds]))).toEqual([
    [
      ['s-n1', ['n1']],
      ['s-n3', ['n3']],
    ],
  ]);
  expect(screen.queryByRole('button', { name: 'Close menu' })).toBeNull();
  expect(screen.queryByRole('header', { name: /\?$/ })).toBeNull();
});

test('Clear Done is its own accessibility element with its state; Close menu closes', async () => {
  await render(<Navigator />);
  await openMenu();
  expect(item('Clear Done').props.accessibilityRole).toBe('button');
  expect(item('Clear Done').props.accessibilityState).toEqual({ disabled: false, selected: false });
  expect(groupingAncestors(item('Clear Done'))).toEqual([]);

  const close = screen.getByRole('button', { name: 'Close menu' });
  expect(groupingAncestors(close)).toEqual([]);
  await fireEvent.press(close);
  expect(screen.queryByRole('button', { name: 'Close menu' })).toBeNull();
  expect(clear).not.toHaveBeenCalled();
});

test.each([
  { name: 'nothing under Done (only a failure and a read row)', rows: [feedRow('n2', true), feedRow('n4', false, 'failed')] },
  { name: 'no rows', rows: [] },
])('with $name, Clear Done is off', async (state) => {
  useAttentionFeedStore.setState({ feeds: { m1: { status: 'ready', rows: state.rows } } });
  await render(<Navigator />);
  await openMenu();
  expect(item('Clear Done').props.accessibilityState).toMatchObject({ disabled: true });
});

test('Clear Done with Done rows of a computer that cannot be reached says the change was not taken', async () => {
  // The real Clear Done: the computer's feed cannot be read now, so it takes nothing.
  clear.mockImplementationOnce(jest.requireActual<typeof FeedStoreModule>('../notifications/feedStore').clearDone);
  useAttentionFeedStore.setState({ feeds: { m1: { status: 'unreachable', rows: [feedRow('n1', false)] } } });
  await render(<Navigator />);
  await openMenu();
  expect(screen.queryByText(NotificationsCopy.actionFailed)).toBeNull();
  await fireEvent.press(item('Clear Done'));
  await act(async () => undefined);
  expect(screen.getByText(NotificationsCopy.actionFailed)).toBeTruthy();
});

test('on a regular iPhone the menu stands under its "…", at the window\'s trailing edge', async () => {
  // An iPhone 17 window (402x874), the header placed on top (no status band, no side bar). Test-only: the
  // window React Native reports, read by the menu through `useWindowDimensions`.
  await act(() => {
    Dimensions.set({
      window: { width: 402, height: 874, scale: 3, fontScale: 1 },
      screen: { width: 402, height: 874, scale: 3, fontScale: 1 },
    });
  });
  await render(<Navigator />);
  await openMenu();
  let card = item('Clear Done').parent;
  while (card !== null && StyleSheet.flatten(card.props.style)?.maxHeight === undefined) card = card.parent;
  if (card === null) throw new Error('no menu card');
  // Shown once its height is known (the test renderer lays nothing out).
  await fireEvent(card, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 150 } } });
  card = item('Clear Done').parent;
  while (card !== null && StyleSheet.flatten(card.props.style)?.maxHeight === undefined) card = card.parent;
  const style = StyleSheet.flatten(card?.props.style);
  // The "…" is measured at (350, 62), 36 pt: 8 pt under it; 320 pt wide, ending 8 pt from the window's edge.
  expect({
    position: style?.position,
    top: style?.top,
    left: style?.left,
    width: style?.width,
    opacity: style?.opacity,
  }).toEqual({
    position: 'absolute',
    top: 62 + 36 + 8,
    left: 402 - 8 - 320,
    width: 320,
    opacity: 1,
  });
});

/** WCAG contrast of two opaque RGB colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r = 0, g = 0, blue = 0] = [1, 3, 5]
      .map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
      .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * blue;
  };
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

describe('colour readability on the model surfaces', () => {
  const initialSettings = useSettingsStore.getState().settings;
  afterEach(async () => {
    await act(() => useSettingsStore.setState({ settings: initialSettings }));
  });

  test.each(THEME_PRESETS.map((preset) => [preset.id, preset.mode] as const))(
    '%s (%s): the line for a change the computer did not take keeps 4.5:1 on the page',
    async (preset) => {
      const patch = themePresetPatch(preset, false);
      if (patch === undefined) throw new Error(`Unknown preset ${preset}`);
      useSettingsStore.getState().patchSettings(patch);
      clear.mockResolvedValueOnce(false);
      await render(<Navigator />);
      await openMenu();
      await fireEvent.press(item('Clear Done'));
      await act(async () => undefined);
      const line = screen.getByText(NotificationsCopy.actionFailed);
      let page = line.parent;
      while (page !== null && !String(StyleSheet.flatten(page.props.style)?.backgroundColor ?? '').startsWith('#')) {
        page = page.parent;
      }
      if (page === null) throw new Error('No painted page under the failure line');
      const surface = String(StyleSheet.flatten(page.props.style).backgroundColor);
      expect(contrast(String(StyleSheet.flatten(line.props.style).color), surface)).toBeGreaterThanOrEqual(4.5);
    },
  );
});
