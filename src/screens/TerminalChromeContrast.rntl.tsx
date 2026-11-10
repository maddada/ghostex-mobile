/// <reference types="jest" />
/**
 * Run with `bunx jest src/screens/TerminalChromeContrast.rntl.tsx`. The terminal screen's chrome stays readable on
 * the seven light presets, measured on the rendered components:
 * - normal-size secondary text has at least 4.5:1 (WCAG AA) against the surface it is drawn on: the connection
 *   caption on the terminal background, the key labels on their pill (the ink's 8% wash over the background);
 * - the iPhone Duo's side-bar buttons keep a glyph that reads on their dark round capsule (at least 3:1, non-text UI),
 *   while the header's own row keeps dark ink on a light page.
 * Contrast values are computed in this file from the WCAG 2 formulas, not taken from the code under test.
 */

import { act, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Dimensions, StyleSheet } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import type { TestInstance } from 'test-renderer';

import VerticalBarArea from '../components/common/verticalBar/VerticalBarArea';
import { useBarGeometryStore } from '../components/common/verticalBar/barGeometry';
import TerminalKeyBar from '../components/terminal/TerminalKeyBar';
import TerminalStateOverlay from '../components/terminal/TerminalStateOverlay';
import { defaultSettings, useSettingsStore } from '../settings/store';
import { useTerminalStore } from '../terminal/sessions';
import { THEME_PRESETS, themePresetPatch } from '../theme/presets';
import { ConnectStartCopy } from '../copy';
import ConnectChooseScreen from './ConnectChooseScreen';
import WorkLinkPicker from './sessions-screen/work-link-picker';
import TerminalScreen from './TerminalScreen';

let mockDuo = false;
jest.mock('../../modules/ghostex-native/src', () => ({
  GhostexNative: {
    addListener: () => ({ remove: () => undefined }),
    setKeepScreenOn: () => Promise.resolve(),
    focusTerminal: () => Promise.resolve(true),
    blurTerminal: () => Promise.resolve(),
    setKeyModifiers: () => Promise.resolve(),
    sendKey: () => Promise.resolve(),
    sendText: () => Promise.resolve(),
    scrollToBottom: () => Promise.resolve(),
    // The iPhone Duo unfolded in landscape (951 × 669 pt), the side bar on the trailing edge.
    observeBarLayout: () =>
      Promise.resolve({
        id: 1,
        layout: mockDuo
          ? {
              windowWidth: 951,
              windowHeight: 669,
              safeTop: 10,
              safeLeft: 0,
              safeRight: 81,
              marginTop: 18,
              edge: 'trailing',
              sideBar: { x: 880, y: 116, width: 46, height: 520 },
              topBar: { x: 0, y: 10, width: 870, height: 44 },
              divisions: [],
            }
          : { windowWidth: 402, windowHeight: 874, safeTop: 59, safeLeft: 0, safeRight: 0, marginTop: 59 },
      }),
    stopObservingBarLayout: () => Promise.resolve(),
  },
  GhostexTerminalView: (props: object) =>
    require('react').createElement(require('react-native').View, { testID: 'terminal-view', ...props }),
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-haptics', () => ({
  impactAsync: () => Promise.resolve(),
  notificationAsync: () => Promise.resolve(),
  selectionAsync: () => Promise.resolve(),
  ImpactFeedbackStyle: { Light: 'light', Rigid: 'rigid' },
  NotificationFeedbackType: { Success: 'success' },
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context/jest/mock').default,
  useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('@react-navigation/native', () => ({
  useIsFocused: () => true,
  useFocusEffect: (callback: () => unknown) => require('react').useEffect(callback, [callback]),
  useNavigation: () => ({ navigate: () => undefined }),
}));
jest.mock('../chat/native/NativeChatScreen', () => ({ __esModule: true, default: () => null }));
jest.mock('../voice/VoiceButton', () => ({ VoiceButton: () => null }));

/** The seven light presets and the terminal background each paints (the host's preset work areas). */
const LIGHT_PRESETS = [
  ['latte', '#eff1f5'],
  ['alucard', '#fffbeb'],
  ['sol-light', '#fdf6e3'],
  ['tn-day', '#e1e2e7'],
  ['kg-lotus', '#f2ecbc'],
  ['ef-light', '#fdf6e3'],
  ['gm-light', '#fbf1c7'],
] as const;

const tab = {
  sessionKey: 'contrast-shell',
  machineId: 'contrast-machine',
  title: 'contrast shell',
  kind: 'shell',
  state: 'open',
} as const;
const nav = { setOptions: () => undefined, popTo: () => undefined, navigate: () => undefined };
const route = { key: 'contrast', name: 'Terminal', params: { sessionKey: tab.sessionKey, machineId: tab.machineId } };

const flat = (node: { props: { style?: StyleProp<ViewStyle & TextStyle> } }) =>
  StyleSheet.flatten(node.props.style) ?? {};
const ancestors = (node: TestInstance): TestInstance[] => {
  const nodes: TestInstance[] = [];
  for (let current: TestInstance | null = node; current !== null; current = current.parent) nodes.push(current);
  return nodes;
};

const channels = (hex: string): number[] => (hex.replace('#', '').match(/../g) ?? []).map((pair) => parseInt(pair, 16));
/** WCAG 2 relative luminance and contrast ratio, written out here rather than imported from the code under test. */
const luminance = (hex: string): number =>
  channels(hex)
    .map((value) => value / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4))
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index]!, 0);
const contrast = (a: string, b: string): number => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};
/** `rgba(r,g,b,a)` painted over an opaque `#rrggbb`. */
const over = (rgba: string, base: string): string => {
  if (/^#[0-9a-f]{6}$/iu.test(rgba)) return rgba;
  const [r, g, b, a] = (rgba.match(/[\d.]+/g) ?? []).map(Number) as [number, number, number, number];
  return `#${channels(base)
    .map((value, index) => Math.round([r, g, b][index]! * a + value * (1 - a)))
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
};

beforeEach(() => {
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true);
  useSettingsStore.setState({ hydrated: true, settings: defaultSettings() });
  useTerminalStore.setState({ tabs: [tab], selectedSessionKey: tab.sessionKey });
  useBarGeometryStore.setState({ hydrated: true, layouts: {}, keyboardHeights: {} });
});
afterEach(() => jest.restoreAllMocks());

describe.each(LIGHT_PRESETS)('%s', (id, background) => {
  test('the connection texts read on the terminal background (at least 4.5:1)', async () => {
    useSettingsStore.getState().patchSettings(themePresetPatch(id, false)!);
    await render(
      <TerminalStateOverlay
        tab={{ ...tab, state: 'failed' }}
        errorCaption="Unable to connect"
        onRetry={() => undefined}
        onReconnect={() => undefined}
      />,
    );
    const caption = screen.getByText('Unable to connect');
    expect(ancestors(caption).some((node) => flat(node).backgroundColor === background)).toBe(true);
    expect(contrast(flat(caption).color as string, background)).toBeGreaterThanOrEqual(4.5);
    await screen.unmount();
    await render(
      <TerminalStateOverlay
        tab={{ ...tab, state: 'opening' }}
        errorCaption={null}
        onRetry={() => undefined}
        onReconnect={() => undefined}
      />,
    );
    expect(contrast(flat(screen.getByText('Connecting...')).color as string, background)).toBeGreaterThanOrEqual(4.5);
    await screen.unmount();
  });

  test('the key labels read on their pill (at least 4.5:1 against the pill over the background)', async () => {
    useSettingsStore.getState().patchSettings(themePresetPatch(id, false)!);
    await render(<TerminalKeyBar sessionKey={tab.sessionKey} agentId="terminal" onDismissKeyboard={() => undefined} />);
    const label = screen.getByText('ESC');
    const nodes = ancestors(label);
    expect(nodes.some((node) => flat(node).backgroundColor === background)).toBe(true);
    const pill = nodes.find((node) => String(flat(node).backgroundColor ?? '').startsWith('rgba('));
    expect(pill).toBeDefined();
    const pillColour = over(flat(pill!).backgroundColor as string, background);
    expect(contrast(flat(label).color as string, pillColour)).toBeGreaterThanOrEqual(4.5);
    await screen.unmount();
  });
});

describe.each(THEME_PRESETS.map((preset) => [preset.id, preset.mode] as const))('%s (%s) setup and link surfaces', (id) => {
  test('connection instructions keep 4.5:1 on the surface they are drawn on', async () => {
    useSettingsStore.getState().patchSettings(themePresetPatch(id, false)!);
    await render(<ConnectChooseScreen navigation={nav as never} route={{} as never} />);
    for (const step of ConnectStartCopy.steps.filter((entry) => entry.link.length === 0)) {
      const label = screen.getByText(step.lead);
      const card = ancestors(label).slice(1).find((node) => /^#[0-9a-f]{6}$/iu.test(String(flat(node).backgroundColor)));
      expect(card).toBeDefined();
      expect(contrast(String(flat(label).color), String(flat(card!).backgroundColor))).toBeGreaterThanOrEqual(4.5);
    }
  });

  test('a failed link-candidate load keeps 4.5:1 on the picker page', async () => {
    useSettingsStore.getState().patchSettings(themePresetPatch(id, false)!);
    await render(<WorkLinkPicker kind="pullRequest" sessionTitle="Example session"
      load={async () => { throw new Error('Suggestions unavailable'); }}
      onPick={() => {}} onCancel={() => {}} />);
    const label = await screen.findByText('Suggestions unavailable');
    const page = ancestors(label).slice(1).find((node) => /^#[0-9a-f]{6}$/iu.test(String(flat(node).backgroundColor)));
    expect(page).toBeDefined();
    expect(contrast(String(flat(label).color), String(flat(page!).backgroundColor))).toBeGreaterThanOrEqual(4.5);
  });
});

test('Duo landscape: the side bar glyphs read on their model-coloured capsules over a light terminal; the header row keeps dark ink', async () => {
  mockDuo = true;
  await act(() =>
    Dimensions.set({
      window: { width: 951, height: 669, scale: 3, fontScale: 1 },
      screen: { width: 951, height: 669, scale: 3, fontScale: 1 },
    }),
  );
  useSettingsStore.getState().patchSettings(themePresetPatch('latte', false)!);
  await render(
    <VerticalBarArea>
      <TerminalScreen navigation={nav as never} route={route as never} />
    </VerticalBarArea>,
  );
  await act(async () => undefined);
  expect(flat(screen.getByText(tab.title)).color).toBe('#262626');
  for (const label of ['Back', 'More options']) {
    const button = screen.getByLabelText(label);
    expect(ancestors(button).some((node) => flat(node).backgroundColor === '#eff1f5')).toBe(true);
    // The glyph's first SVG shape that paints with a native colour brush (a path's stroke, a dot's fill).
    const hasBrush = (value: unknown): value is { payload: number } =>
      typeof value === 'object' && value !== null && 'payload' in value && typeof value.payload === 'number';
    const glyph = button.queryAll((node) => hasBrush(node.props.stroke) || hasBrush(node.props.fill))[0];
    expect(glyph).toBeDefined();
    const brush: unknown = hasBrush(glyph!.props.stroke) ? glyph!.props.stroke : glyph!.props.fill;
    if (!hasBrush(brush)) throw new Error('the glyph has no native colour brush');
    const glyphColour = `#${(brush.payload & 0xffffff).toString(16).padStart(6, '0')}`;
    const capsule = over(flat(button).backgroundColor as string, '#eff1f5');
    expect(contrast(glyphColour, capsule)).toBeGreaterThanOrEqual(3);
  }
  await screen.unmount();
  mockDuo = false;
});
