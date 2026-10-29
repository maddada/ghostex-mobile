/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. REQ-DUO-005 AC2 and REQ-DUO-001 AC5 with the owner's overflow rule
 * and D1 (2026-10-26): a stack screen's side bar "…" holds the buttons the side bar has no room for.
 * Once open, its menu stays open with what it holds when the pose changes, standing at its button while
 * the side bar shows it and centred otherwise (§1.5 S1-5, FL-LAY-14; reviews s1-floor-r1 #15 and
 * s1-floor-r2 #4). The side bar is the folded display's, short enough that two of the screen's three
 * buttons go into the "…"; the band is the unfolded display's in portrait.
 */

import type { ParamListBase, Route } from '@react-navigation/native';
import type {
  NativeStackHeaderProps,
  NativeStackNavigationOptions,
  NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import { Dimensions, StyleSheet, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { BarLayout } from '../../../../modules/ghostex-native/src/GhostexNative.types';
import { DuoChromeCopy } from '../../../copy';
import { StackHeader } from './StackHeader';
import { useStackRailStore, type ScreenRail } from './stackRail';
import VerticalBarArea from './VerticalBarArea';
import { useBarGeometryStore } from './barGeometry';

let mockReport: ((layout: BarLayout) => void) | null = null;
let mockFirstLayout: ((value: { id: number; layout: BarLayout }) => void) | null = null;
let mockInsets = { top: 0, bottom: 20, left: 0, right: 84 };

jest.mock('../../../../modules/ghostex-native/src', () => ({
  GhostexNative: {
    addListener: (_event: string, listener: (layout: BarLayout) => void) => {
      mockReport = listener;
      return { remove: () => undefined };
    },
    observeBarLayout: () => {
      const { promise, resolve } = Promise.withResolvers<{ id: number; layout: BarLayout }>();
      mockFirstLayout = resolve;
      return promise;
    },
    stopObservingBarLayout: () => Promise.resolve(),
  },
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => mockInsets }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../../../theme/useAppearance', () => ({
  useAppearance: () => ({ background: 'black', foreground: 'white', border: 'gray' }),
}));
// A pressed button's window frame: where the rail draws it (the test renderer measures nothing).
jest.mock('../measureInWindow', () => ({
  measureInWindow: (_ref: unknown, onFrame: (frame: object) => void) =>
    onFrame({ x: 396, y: 268, width: 44, height: 44 }),
}));

const folded = (railTop: number): BarLayout => ({
  windowWidth: 466,
  windowHeight: 678,
  safeTop: 0,
  safeLeft: 0,
  safeRight: 84,
  marginTop: 8,
  edge: 'trailing',
  // Room for three buttons at the least size (40 pt, 4 pt apart): Back, one button and the "…".
  sideBar: { x: 395, y: railTop, width: 46, height: 140 },
  topBar: { x: 2.3, y: 26, width: 379.7, height: 44 },
  divisions: [],
});
const PORTRAIT: BarLayout = {
  windowWidth: 669,
  windowHeight: 951,
  safeTop: 80,
  safeLeft: 0,
  safeRight: 0,
  marginTop: 88,
  topBar: { x: 0, y: 26, width: 466, height: 44 },
  divisions: [],
};

const entry = (key: string) => ({
  key,
  label: key,
  icon: () => <Text>{`${key} glyph`}</Text>,
  onPress: () => undefined,
});

/**
 * The header's props: route, options and back as React Navigation types them; of the navigator only
 * `goBack`, the one member StackHeader calls (TS-03: a navigator is not mounted in this test, so the
 * stand-in is cast; StackHeader calling any other member fails this test with a TypeError, not silently).
 */
const goBack = jest.fn();
function headerProps(): NativeStackHeaderProps {
  const route: Route<string> = { key: 'doc', name: 'DocViewer' };
  const options: NativeStackNavigationOptions = { title: 'Doc' };
  const navigation = { goBack } as unknown as NativeStackNavigationProp<ParamListBase>;
  return { navigation, route, options, back: { title: 'Docs', href: undefined } };
}

async function setWindow(width: number, height: number): Promise<void> {
  await act(() => {
    Dimensions.set({
      window: { width, height, scale: 3, fontScale: 1 },
      screen: { width, height, scale: 3, fontScale: 1 },
    });
  });
}

async function report(layout: BarLayout): Promise<void> {
  await act(async () => {
    mockReport?.(layout);
  });
}

/** The open menu's card: the absolutely placed container of an item, or undefined while it is centred. */
function anchoredCardTop(item: string): number | undefined {
  let card = screen.getByText(item).parent;
  while (card !== null && StyleSheet.flatten(card.props.style)?.position !== 'absolute') card = card.parent;
  return card === null ? undefined : StyleSheet.flatten(card.props.style)?.top;
}

describe('in the side bar (the system standing a vertical bar)', () => {
  beforeEach(async () => {
    mockInsets = { top: 0, bottom: 20, left: 0, right: 84 };
    await setWindow(466, 678);
    useBarGeometryStore.setState({ hydrated: false, keyboardHeights: {}, layouts: {} });
    await useBarGeometryStore.getState().hydrate();
    useStackRailStore.setState({
      byRoute: { doc: { entries: [entry('annotate'), entry('copy'), entry('reload')], reserveKeyboard: false } },
    });
    await render(
      <VerticalBarArea>
        <StackHeader {...headerProps()} />
      </VerticalBarArea>,
    );
    await act(async () => {
      mockFirstLayout?.({ id: 1, layout: folded(174) });
    });
    // Back, Annotate and the "…"; Copy and Reload are in its menu.
    expect(screen.queryByLabelText('copy')).toBeNull();
    await fireEvent.press(screen.getByLabelText(DuoChromeCopy.more));
    expect(screen.getByText('copy')).toBeTruthy();
  });

  test('REQ-DUO-005 AC2, owner S1-5: the "…" menu stays open when a Live Activity lowers the side bar, at its button', async () => {
    await report(folded(230));
    expect(screen.getByText('reload')).toBeTruthy();
    // At the "…" where it stands now: third of 44-pt buttons 4 pt apart from y 230.
    expect(anchoredCardTop('copy')).toBe(230 + 2 * 48);
  });

  test('REQ-DUO-001 AC5, FL-LAY-14: the open "…" menu keeps its items from side bar to band and back', async () => {
    // Unfolded in portrait: the header stands in the band, which has no "…"; the menu stays, centred.
    mockInsets = { top: 80, bottom: 20, left: 0, right: 0 };
    await setWindow(669, 951);
    await report(PORTRAIT);
    expect(screen.getByText('copy')).toBeTruthy();
    expect(screen.getByText('reload')).toBeTruthy();
    expect(anchoredCardTop('copy')).toBeUndefined();

    // Folded again: the menu stands at the "…" in the side bar.
    mockInsets = { top: 0, bottom: 20, left: 0, right: 84 };
    await setWindow(466, 678);
    await report(folded(174));
    expect(screen.getByText('reload')).toBeTruthy();
    expect(anchoredCardTop('copy')).toBe(174 + 2 * 48);
  });
});

/*
 * Owner decision 2026-10-27 (§12, "1b"): the vertical bar is disabled, so the Duo's header stands in the
 * status band in every pose; the band measured for `.disabled` folded in portrait is 263.7 pt wide.
 */
describe('in the status band with the vertical bar disabled (owner §12 "1b", 2026-10-27)', () => {
  const FOLDED_BAND: BarLayout = {
    windowWidth: 466,
    windowHeight: 678,
    safeTop: 82,
    safeLeft: 0,
    safeRight: 0,
    marginTop: 90,
    topBar: { x: 2.3, y: 26, width: 263.7, height: 44 },
    divisions: [],
  };

  async function showBand(rail: { byRoute: Record<string, ScreenRail> }): Promise<void> {
    mockInsets = { top: 82, bottom: 34, left: 0, right: 0 };
    await setWindow(466, 678);
    useBarGeometryStore.setState({ hydrated: false, keyboardHeights: {}, layouts: {} });
    await useBarGeometryStore.getState().hydrate();
    useStackRailStore.setState(rail);
    goBack.mockClear();
    await render(
      <VerticalBarArea>
        <StackHeader {...headerProps()} />
      </VerticalBarArea>,
    );
    await act(async () => {
      mockFirstLayout?.({ id: 1, layout: FOLDED_BAND });
    });
  }

  test('owner overflow rule: buttons that do not fit beside Back and the title move into the "…", last first', async () => {
    await showBand({
      byRoute: {
        doc: {
          entries: [entry('annotate'), entry('copy'), entry('reload'), entry('export')],
          reserveKeyboard: false,
        },
      },
    });
    // 263.7 pt: Back, a 64-pt title and two 40-pt buttons leave no room for a third beside the "…".
    expect(screen.getByLabelText(DuoChromeCopy.back)).toBeTruthy();
    expect(screen.getByLabelText('annotate')).toBeTruthy();
    expect(screen.getByLabelText('copy')).toBeTruthy();
    expect(screen.queryByLabelText('reload')).toBeNull();
    expect(screen.queryByLabelText('export')).toBeNull();
    await fireEvent.press(screen.getByLabelText(DuoChromeCopy.more));
    expect(screen.getByText('reload')).toBeTruthy();
    expect(screen.getByText('export')).toBeTruthy();
    // S1-5: the menu stands at its button in the band, below it, as measured.
    expect(anchoredCardTop('reload')).toBe(268 + 44 + 8);
  });

  test('owner overflow rule: while the buttons fit there is no "…" and nothing moves', async () => {
    await showBand({
      byRoute: { doc: { entries: [entry('annotate'), entry('copy')], reserveKeyboard: false } },
    });
    expect(screen.queryByLabelText(DuoChromeCopy.more)).toBeNull();
    expect(screen.getByLabelText(DuoChromeCopy.back)).toBeTruthy();
    expect(screen.getByText('Doc')).toBeTruthy();
  });

  test('Back always stays, even where nothing else has room', async () => {
    await showBand({
      byRoute: { doc: { entries: [entry('annotate'), entry('copy'), entry('reload')], reserveKeyboard: false } },
    });
    await act(async () => {
      mockReport?.({ ...FOLDED_BAND, topBar: { x: 2.3, y: 26, width: 120, height: 44 } });
    });
    expect(screen.getByLabelText(DuoChromeCopy.back)).toBeTruthy();
    expect(screen.getByLabelText(DuoChromeCopy.more)).toBeTruthy();
    expect(screen.queryByLabelText('annotate')).toBeNull();
  });

  test('Settings in two columns: the band keeps one Back and no title (the columns carry the titles); Back leaves Settings', async () => {
    const leave = jest.fn();
    await showBand({
      byRoute: { doc: { entries: [], reserveKeyboard: true, titleInContent: true, onBack: leave } },
    });
    expect(screen.queryByText('Doc')).toBeNull();
    await fireEvent.press(screen.getByLabelText(DuoChromeCopy.back));
    expect(leave).toHaveBeenCalledTimes(1);
    expect(goBack).not.toHaveBeenCalled();
    expect(screen.queryByLabelText(DuoChromeCopy.more)).toBeNull();
  });

  test('a screen whose title is in its page keeps Back as the stack goes back where it has no override', async () => {
    await showBand({ byRoute: { doc: { entries: [], reserveKeyboard: true, titleInContent: true } } });
    await fireEvent.press(screen.getByLabelText(DuoChromeCopy.back));
    expect(goBack).toHaveBeenCalledTimes(1);
  });
});
