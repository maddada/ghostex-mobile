/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. The chrome's lifecycle paths in `VerticalBarArea` that a logic test cannot
 * reach: the gate before the system's first report and the order of the two reports of a window change
 * (§1.5 S1-10, FL-STA-04, FL-LAY-08), an open menu following its button (S1-5), the rail stepping over
 * the fold's division (FL-DUO-03, owner B1), the keyboard reserve that only grows (S1-4, owner A1), and
 * a style's own padding (FL-LAY-05). The system's bar layout comes from a stand-in for the native module;
 * window frames are the iPhone Duo's (mockup kit devices.js: inner 669x951 and 951x669, folded 466x678).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMemo } from 'react';
import { Dimensions, Pressable, StyleSheet, Text } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { BarLayout, WindowRect } from '../../../../modules/ghostex-native/src/GhostexNative.types';
import { useAppLogStore } from '../../../app/appLog';
import ContextMenu from '../../sessions/ContextMenu';
import { keyboardFixture } from '../keyboard/keyboardEventFixtures';
import { measureInWindow } from '../measureInWindow';
import { useBarGeometryStore } from './barGeometry';
import type { RailButtons, RailEntry } from './railSlot';
import VerticalBarArea, { stylePadding, useHeaderMenu, useHeaderPlacement, useRailButtons } from './VerticalBarArea';

/** The native methods React Native's Jest preset gives every View (`measureInWindow` measures nothing). */
const mockNativeMethods = jest.requireActual<{ default: { measureInWindow: jest.Mock } }>(
  '@react-native/jest-preset/jest/MockNativeMethods',
).default;

let mockReport: ((layout: BarLayout) => void) | null = null;
let mockFirstLayout: ((value: { id: number; layout: BarLayout }) => void) | null = null;
let mockInsets = { top: 80, bottom: 20, left: 0, right: 0 };

jest.mock('../../../../modules/ghostex-native/src', () => ({
  GhostexNative: {
    addListener: (_event: string, listener: (layout: BarLayout) => void) => {
      mockReport = listener;
      return {
        remove: () => {
          mockReport = null;
        },
      };
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
jest.mock('../../../theme/useAppearance', () => ({
  useAppearance: () => ({ background: 'black', foreground: 'white', border: 'gray' }),
}));

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
const LANDSCAPE: BarLayout = {
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
};
const FOLDED: BarLayout = {
  windowWidth: 466,
  windowHeight: 678,
  safeTop: 0,
  safeLeft: 0,
  safeRight: 84,
  marginTop: 8,
  edge: 'trailing',
  sideBar: { x: 395, y: 174, width: 46, height: 470 },
  topBar: { x: 2.3, y: 26, width: 379.7, height: 44 },
  divisions: [],
};

/** The notifications iOS posts, with their start and end frames (keyboardEventFixtures.ts). */
const keyboardEvents = keyboardFixture({ width: 466, height: 678 });

async function setWindow(width: number, height: number): Promise<void> {
  await act(() => {
    keyboardEvents.setScreen(width, height);
    Dimensions.set({
      window: { width, height, scale: 3, fontScale: 1 },
      screen: { width, height, scale: 3, fontScale: 1 },
    });
  });
}

async function firstReport(layout: BarLayout): Promise<void> {
  await act(async () => {
    mockFirstLayout?.({ id: 1, layout });
  });
}

async function report(layout: BarLayout): Promise<void> {
  await act(async () => {
    mockReport?.(layout);
  });
}

/** Every placement the screens are laid out with, in order. */
const placements: { kind: string; frame?: WindowRect }[] = [];
function PlacementProbe() {
  const placement = useHeaderPlacement();
  placements.push(placement.kind === 'top' ? { kind: 'top' } : { kind: placement.kind, frame: placement.frame });
  return null;
}

function entry(key: string, onPress: (anchor?: WindowRect) => void = () => undefined): RailEntry {
  return { key, label: key, icon: () => <Text>{key}</Text>, onPress };
}

/** A screen with header buttons in the rail, its "more" last, as Terminal and Sessions wire theirs. */
function RailScreen({ keys, reserveKeyboard = false }: { keys: string[]; reserveKeyboard?: boolean }) {
  const placement = useHeaderPlacement();
  const buttons = useMemo<RailButtons>(
    () => ({ entries: keys.map((key) => entry(key)), pinned: 1, moreMenu: 'always', reserveKeyboard }),
    [keys, reserveKeyboard],
  );
  useRailButtons(buttons, 'black', placement.kind === 'rail');
  return null;
}

beforeEach(async () => {
  placements.length = 0;
  mockReport = null;
  mockFirstLayout = null;
  mockInsets = { top: 80, bottom: 20, left: 0, right: 0 };
  useAppLogStore.setState({ entries: [] });
  // Each test starts from nothing stored and no keyboard.
  await AsyncStorage.clear();
  await act(() => keyboardEvents.hide(0));
  useBarGeometryStore.setState({ hydrated: false, keyboardHeights: {}, layouts: {} });
  await useBarGeometryStore.getState().hydrate();
  await setWindow(669, 951);
});

afterEach(() => {
  mockNativeMethods.measureInWindow.mockReset();
});

/*
 * Owner decision 2026-10-27 (§12, "1b"): the vertical bar is disabled; these are the bar layouts the iPhone
 * Duo simulator (Xcode 27.1) measured for `.disabled`, folded: no side bar, safe area top 82 (portrait and
 * the landscape with the camera top left), 0 with the camera at the bottom.
 */
const DISABLED_PORTRAIT: BarLayout = {
  windowWidth: 466,
  windowHeight: 678,
  safeTop: 82,
  safeLeft: 0,
  safeRight: 0,
  marginTop: 90,
  topBar: { x: 2.3, y: 26, width: 263.7, height: 44 },
  divisions: [],
};
const DISABLED_LANDSCAPE_RIGHT: BarLayout = {
  windowWidth: 678,
  windowHeight: 466,
  safeTop: 82,
  safeLeft: 0,
  safeRight: 0,
  marginTop: 90,
  topBar: { x: 84, y: 26, width: 576.7, height: 44 },
  divisions: [],
};
const DISABLED_LANDSCAPE_LEFT: BarLayout = {
  windowWidth: 678,
  windowHeight: 466,
  safeTop: 0,
  safeLeft: 0,
  safeRight: 0,
  marginTop: 8,
  topBar: { x: 17.3, y: 26, width: 643.3, height: 44 },
  divisions: [],
};

describe('the Duo with the vertical bar disabled (owner §12 "1b", 2026-10-27)', () => {
  test('folded in portrait the header is placed in the band beside the status items, with the measured frame', async () => {
    mockInsets = { top: 82, bottom: 34, left: 0, right: 0 };
    await setWindow(466, 678);
    await render(
      <VerticalBarArea>
        <PlacementProbe />
      </VerticalBarArea>,
    );
    await firstReport(DISABLED_PORTRAIT);
    expect(placements.length).toBeGreaterThan(0);
    expect(placements.at(-1)).toEqual({ kind: 'band', frame: DISABLED_PORTRAIT.topBar });
  });

  test('turned either way the header never takes a side: band with the camera top left, top at the bottom', async () => {
    mockInsets = { top: 82, bottom: 34, left: 0, right: 0 };
    await setWindow(466, 678);
    await render(
      <VerticalBarArea>
        <PlacementProbe />
      </VerticalBarArea>,
    );
    await firstReport(DISABLED_PORTRAIT);
    await setWindow(678, 466);
    await report(DISABLED_LANDSCAPE_RIGHT);
    expect(placements.at(-1)).toEqual({ kind: 'band', frame: DISABLED_LANDSCAPE_RIGHT.topBar });
    await report(DISABLED_LANDSCAPE_LEFT);
    expect(placements.at(-1)).toEqual({ kind: 'top' });
    expect(placements.map((placement) => placement.kind)).not.toContain('rail');
  });
});

describe('the chrome waits for the system and follows its reports (owner S1-10, FL-STA-04)', () => {
  test('FL-STA-04: no screen is laid out before the system has reported the window bars', async () => {
    await render(
      <VerticalBarArea>
        <PlacementProbe />
      </VerticalBarArea>,
    );
    expect(placements).toEqual([]);
    await firstReport(PORTRAIT);
    expect(placements.length).toBeGreaterThan(0);
    expect(placements.every((placement) => placement.kind === 'band')).toBe(true);
  });

  test('owner S1-10: at a size the system has not reported yet, the old layout stays until its report; never top', async () => {
    await render(
      <VerticalBarArea>
        <PlacementProbe />
      </VerticalBarArea>,
    );
    await firstReport(PORTRAIT);
    placements.length = 0;
    // React Native reports the turned window first, then the system its bars there.
    await setWindow(951, 669);
    expect(placements.map((placement) => placement.kind)).not.toContain('top');
    await report(LANDSCAPE);
    expect(placements.map((placement) => placement.kind)).not.toContain('top');
    expect(placements.at(-1)).toEqual({ kind: 'rail', frame: LANDSCAPE.sideBar });
  });

  test('owner S1-10: the system reporting first is taken at once, before React Native reports the new size', async () => {
    mockInsets = { top: 0, bottom: 20, left: 0, right: 84 };
    await setWindow(466, 678);
    await render(
      <VerticalBarArea>
        <PlacementProbe />
      </VerticalBarArea>,
    );
    await firstReport(FOLDED);
    // Unfolded: the system reports the inner display's bars while React Native still has the folded size.
    await report(LANDSCAPE);
    expect(placements.at(-1)).toEqual({ kind: 'rail', frame: LANDSCAPE.sideBar });
  });

  test('REQ-DUO-001 AC5, owner S1-10: a layout kept from before a Live Activity moved the status items is not used', async () => {
    mockInsets = { top: 0, bottom: 20, left: 0, right: 84 };
    await setWindow(466, 678);
    await render(
      <VerticalBarArea>
        <PlacementProbe />
      </VerticalBarArea>,
    );
    await firstReport(FOLDED);
    // Unfolded in landscape once (its layout is kept), folded again.
    await setWindow(951, 669);
    await report(LANDSCAPE);
    await setWindow(466, 678);
    await report(FOLDED);
    // A Live Activity lowers the side bar's status items, on every display.
    await report({ ...FOLDED, sideBar: { x: 395, y: 230, width: 46, height: 414 } });
    placements.length = 0;
    // Unfolded again, React Native first: the layout kept for landscape is from before the activity.
    await setWindow(951, 669);
    await report({ ...LANDSCAPE, sideBar: { x: 880, y: 230, width: 46, height: 406 } });
    expect(placements.map((placement) => placement.frame)).not.toContainEqual(LANDSCAPE.sideBar);
    expect(placements.at(-1)).toEqual({ kind: 'rail', frame: { x: 880, y: 230, width: 46, height: 406 } });
  });
});

/** The frame the open menu stands at, in order. */
const anchors: (WindowRect | undefined)[] = [];
/**
 * Terminal's "More options" as TerminalScreen wires it (`useHeaderMenu`): its own button in the band,
 * opened with that button's window frame, and a rail entry with the key `more` in the side bar.
 */
function HeaderMenuScreen() {
  const placement = useHeaderPlacement();
  const menu = useHeaderMenu();
  const buttons = useMemo<RailButtons>(
    () => ({
      entries: [entry('back'), entry('view'), { ...entry('more'), onPress: menu.open }],
      pinned: 1,
      moreMenu: 'always',
      reserveKeyboard: false,
    }),
    [menu.open],
  );
  useRailButtons(buttons, 'black', placement.kind === 'rail');
  anchors.push(menu.anchor);
  return placement.kind === 'band' ? (
    <Pressable
      ref={menu.buttonRef}
      accessibilityLabel="band more"
      onPress={() => measureInWindow(menu.buttonRef, menu.open)}
    />
  ) : null;
}

test("REQ-DUO-001 AC5, owner S1-5: Terminal's menu, opened at its band button, stands at its side bar button after the turn", async () => {
  anchors.length = 0;
  const BAND_BUTTON = { x: 600, y: 26, width: 44, height: 44 };
  mockNativeMethods.measureInWindow.mockImplementation(
    (onFrame: (x: number, y: number, width: number, height: number) => void) =>
      onFrame(BAND_BUTTON.x, BAND_BUTTON.y, BAND_BUTTON.width, BAND_BUTTON.height),
  );
  await render(
    <VerticalBarArea>
      <HeaderMenuScreen />
    </VerticalBarArea>,
  );
  await firstReport(PORTRAIT);
  await fireEvent.press(screen.getByLabelText('band more'));
  expect(anchors.at(-1)).toEqual(BAND_BUTTON);
  await setWindow(951, 669);
  await report(LANDSCAPE);
  // Back, the view switch, then More options, 46 pt buttons 12 pt apart: the rail's third button.
  expect(anchors.at(-1)).toEqual({ x: 880, y: 116 + 2 * 58, width: 46, height: 46 });
});

/**
 * Terminal's "More options" menu as it is drawn: a card at its band button. React Native's native Modal keeps
 * its content on screen while it fades out after `visible` turns false; this stand-in does the same (the
 * Jest preset's mock drops it at once, which would hide exactly the frames the owner saw).
 */
jest.mock('react-native/Libraries/Modal/Modal', () => {
  const { View: MockView } = jest.requireActual('react-native');
  const React = jest.requireActual('react');
  return {
    __esModule: true,
    default: (props: { children?: unknown }) => React.createElement(MockView, null, props.children),
  };
});

function MenuCloseScreen() {
  const placement = useHeaderPlacement();
  const menu = useHeaderMenu();
  anchors.push(menu.anchor);
  return (
    <>
      {placement.kind === 'band' ? (
        <Pressable
          ref={menu.buttonRef}
          accessibilityLabel="band more"
          onPress={() => measureInWindow(menu.buttonRef, menu.open)}
        />
      ) : null}
      <Pressable accessibilityLabel="close menu" onPress={() => menu.setVisible(false)} />
      <ContextMenu
        visible={menu.visible}
        title="Menu"
        items={[{ kind: 'item', key: 'one', label: 'One', onPress: () => undefined }]}
        onClose={() => menu.setVisible(false)}
        anchor={menu.anchor}
      />
    </>
  );
}

describe('REQ-DUO-001 AC5, owner finding 2026-10-28: the menu card stays where it is while the menu fades out', () => {
  /** The card's position style: the title's nearest container with a width. */
  const cardPosition = () => {
    let card = screen.getByText('Menu').parent;
    while (card !== null && StyleSheet.flatten(card.props.style)?.maxHeight === undefined) card = card.parent;
    const { position, left, top } = StyleSheet.flatten(card?.props.style) ?? {};
    return { position, left, top };
  };

  /** The folded display in landscape with the camera on the right: the header row is in the status band. */
  const LANDSCAPE_BAND: BarLayout = {
    windowWidth: 678,
    windowHeight: 466,
    safeTop: 82,
    topBar: { x: 84, y: 26, width: 576.7, height: 44 },
    divisions: [],
  };

  test.each([
    {
      name: 'portrait',
      layout: PORTRAIT,
      window: [669, 951],
      button: { x: 380, y: 26, width: 44, height: 44 },
      left: 64,
      top: 88,
    },
    {
      name: 'landscape',
      layout: LANDSCAPE_BAND,
      window: [678, 466],
      button: { x: 560, y: 26, width: 44, height: 44 },
      left: 244,
      top: 88,
    },
  ])(
    'closing the menu does not move the card ($name): the live anchor is the pressed button and the card keeps its place until the Modal is gone',
    async ({ layout, window, button, left, top }) => {
      anchors.length = 0;
      await setWindow(window[0], window[1]);
      mockNativeMethods.measureInWindow.mockImplementation(
        (onFrame: (x: number, y: number, width: number, height: number) => void) =>
          onFrame(button.x, button.y, button.width, button.height),
      );
      await render(
        <VerticalBarArea>
          <MenuCloseScreen />
        </VerticalBarArea>,
      );
      await firstReport(layout);
      await fireEvent.press(screen.getByLabelText('band more'));
      // The anchor the card stands at is the button as pressed (the live measurement agrees with the press).
      expect(anchors.at(-1)).toEqual(button);
      const open = cardPosition();
      // At its button, not centred: absolutely positioned below the button, kept inside the room.
      expect(open).toEqual({ position: 'absolute', left, top });
      await fireEvent.press(screen.getByLabelText('close menu'));
      // The first frames of the fade-out: the same card at the same place.
      expect(cardPosition()).toEqual(open);
    },
  );
});

describe("the side bar keeps off the fold's division (FL-DUO-03, owner B1, 2026-10-27)", () => {
  const ACROSS_RAIL = { x: 0, y: 330, width: 951, height: 18, active: true };
  const LAPTOP_DIVISION = { x: 0, y: 466, width: 669, height: 18, active: true };
  /** The anchored menu's card: the title's nearest container with a height limit. */
  const cardMaxHeight = () => {
    let card = screen.getByText('Menu').parent;
    while (card !== null && StyleSheet.flatten(card.props.style)?.maxHeight === undefined) card = card.parent;
    return StyleSheet.flatten(card?.props.style)?.maxHeight;
  };
  const bandMenu = (
    <VerticalBarArea>
      <ContextMenu
        visible
        title="Menu"
        items={[{ kind: 'item', key: 'one', label: 'One', onPress: () => undefined }]}
        onClose={() => undefined}
        anchor={{ x: 420, y: 26, width: 44, height: 44 }}
      />
    </VerticalBarArea>
  );

  test('owner B1: a button that would stand in the division stands below it, the others as before', async () => {
    await setWindow(951, 669);
    await render(
      <VerticalBarArea>
        <RailScreen keys={['back', 'a', 'b', 'more']} />
      </VerticalBarArea>,
    );
    await firstReport({ ...LANDSCAPE, divisions: [ACROSS_RAIL] });
    const marginTop = (label: string) => StyleSheet.flatten(screen.getByLabelText(label).props.style).marginTop;
    expect([marginTop('back'), marginTop('a'), marginTop('b')]).toEqual([undefined, undefined, undefined]);
    // The fourth button's top: 116 + 3 × 58 = 290 would reach into 330-348; it stands at 348.
    expect(marginTop('more')).toBe(348 - 290);
  });

  test('owner B1, laptop: a menu at a band button keeps above the division and scrolls in that room', async () => {
    await render(bandMenu);
    await firstReport({ ...PORTRAIT, divisions: [LAPTOP_DIVISION] });
    // From 8 pt below the safe area (80) to the division's top.
    expect(cardMaxHeight()).toBe(466 - 88);
  });

  test('device finding 2026-10-27: flat in portrait the menu reaches past the fold line, and folding then keeps it above', async () => {
    await render(bandMenu);
    await firstReport({ ...PORTRAIT, divisions: [{ ...LAPTOP_DIVISION, active: false }] });
    // From 8 pt below the safe area (80) to 8 pt above the bottom inset (951 - 20).
    expect(cardMaxHeight()).toBe(951 - 20 - 8 - 88);
    await report({ ...PORTRAIT, divisions: [LAPTOP_DIVISION] });
    expect(cardMaxHeight()).toBe(466 - 88);
  });
});

describe('the keyboard reserve only grows (REQ-DUO-005 AC2, owner A1, 2026-10-27)', () => {
  const keyboard = (top: number, height: number) => act(() => keyboardEvents.show(top, height, 0));
  const hide = () => act(() => keyboardEvents.hide(0));
  const sizeOf = (label: string) => StyleSheet.flatten(screen.getByLabelText(label).props.style).width;

  test('owner A1: the first keyboard rearranges the rail once, a lower one never moves it back, a taller one once more', async () => {
    mockInsets = { top: 0, bottom: 20, left: 0, right: 84 };
    await setWindow(466, 678);
    const keys = ['back', 'a', 'b', 'c', 'd', 'more'];
    await render(
      <VerticalBarArea>
        <RailScreen keys={keys} reserveKeyboard />
      </VerticalBarArea>,
    );
    await firstReport(FOLDED);
    expect(sizeOf('back')).toBe(46);

    await keyboard(413, 265);
    expect(useBarGeometryStore.getState().keyboardHeights).toEqual({ '466x678': 265 });
    const first = sizeOf('back');
    expect(first).toBeLessThan(46);

    await hide();
    await keyboard(448, 230);
    expect(useBarGeometryStore.getState().keyboardHeights).toEqual({ '466x678': 265 });
    expect(sizeOf('back')).toBe(first);

    await hide();
    await keyboard(378, 300);
    expect(useBarGeometryStore.getState().keyboardHeights).toEqual({ '466x678': 300 });
    await hide();
    await keyboard(413, 265);
    expect(useBarGeometryStore.getState().keyboardHeights).toEqual({ '466x678': 300 });
  });

  test('owner A1: turning with the keyboard up learns only the keyboard reported for the new window', async () => {
    // Folded and turned to landscape (678 x 466 pt) with the keyboard up, then turned back.
    mockInsets = { top: 0, bottom: 20, left: 0, right: 84 };
    await setWindow(678, 466);
    await render(
      <VerticalBarArea>
        <RailScreen keys={['back', 'a', 'more']} reserveKeyboard />
      </VerticalBarArea>,
    );
    await firstReport({ ...FOLDED, windowWidth: 678, windowHeight: 466 });
    await keyboard(266, 200);
    // React Native reports the turned window before the keyboard reports its frame there.
    await setWindow(466, 678);
    await report(FOLDED);
    expect(useBarGeometryStore.getState().keyboardHeights).toEqual({ '678x466': 200 });
    await keyboard(413, 265);
    expect(useBarGeometryStore.getState().keyboardHeights).toEqual({ '678x466': 200, '466x678': 265 });
  });
});

describe('a style keeps its own padding under the side bar (FL-LAY-05)', () => {
  test("FL-LAY-05: a side's own padding, else its axis', else the style's padding, through arrays", () => {
    const styles = StyleSheet.create({
      all: { padding: 16 },
      axis: { paddingHorizontal: 12 },
      side: { paddingLeft: 20 },
      percent: { paddingRight: '10%' },
    });
    expect(stylePadding(styles.all, 'paddingLeft')).toBe(16);
    expect(stylePadding([styles.all, styles.axis], 'paddingRight')).toBe(12);
    expect(stylePadding([styles.all, [styles.axis, styles.side]], 'paddingLeft')).toBe(20);
    expect(stylePadding([styles.all, null, false], 'paddingTop')).toBe(16);
    expect(stylePadding(styles.percent, 'paddingRight')).toBe(0);
    expect(stylePadding(undefined, 'paddingBottom')).toBe(0);
  });
});
