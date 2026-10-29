/// <reference types="node" />
/**
 * Run with `bun test src/components/common/verticalBar/layout.test.ts`.
 *
 * Expectations from the S1 requirements (REQ-DUO-001, -003, -005, REQ-NFR-001) and the approved S1
 * mockup (owner, 2026-10-25): band = header row in the status band beside the status items (inner
 * portrait); rail = header buttons stacked in the side bar below camera, time and battery, content
 * beside it (folded, inner landscape); regular iPhones unchanged. Frames are what the iOS 27.1 iPhone
 * Duo simulator reported when folded (side bar region 46 pt wide from y 174, side inset 84 pt). The
 * band's 80 pt status band is the device's (mockup kit, device shot 080); its bar region inside the band
 * is assumed until the device read confirms it. A regular iPhone keeps its bars below its status bar.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  anchoredMenuOrigin,
  clearOfDivisions,
  NO_BAR_INSETS,
  RAIL_FIT,
  SETTINGS_LIST_WIDTH,
  SETTINGS_PAGE_MIN_WIDTH,
  TOP_PLACEMENT,
  bandCapacity,
  bandRowFrame,
  bandSplit,
  barPadding,
  chromeLayout,
  geometryKey,
  grownKeyboardHeights,
  headerPlacement,
  keyboardHeightFor,
  layoutsAfterReport,
  liveMenuAnchor,
  menuRoomBeside,
  mergedKeyboardHeights,
  railButtonFrame,
  railContentTop,
  railCapacity,
  railFit,
  railHitSlop,
  railLayout,
  railLayoutFor,
  railSegments,
  railSpan,
  railSplit,
  railStepOffsets,
  reservedKeyboardTop,
  sanitizeBarLayouts,
  sanitizeKeyboardHeights,
  scrollToBarEdges,
  twoColumnWindow,
  verticalBarInsets,
  windowSizeKey,
  type LiveBarLayout,
} from './layout';

const FOLDED = {
  edge: 'trailing' as const,
  sideBar: { x: 395, y: 174, width: 46, height: 470 },
  topBar: { x: 2.3, y: 26, width: 379.7, height: 44 },
  safeTop: 0,
};
const UNFOLDED_PORTRAIT = { topBar: { x: 0, y: 26, width: 466, height: 44 }, safeTop: 80 };
const IPHONE_PORTRAIT = { topBar: { x: 0, y: 62, width: 402, height: 44 }, safeTop: 62 };
const IPHONE_LANDSCAPE = { topBar: { x: 62, y: 0, width: 750, height: 44 }, safeTop: 0 };

describe('header placement', () => {
  test('REQ-DUO-005 AC2: folded, the header buttons stand in the side bar below the status items', () => {
    assert.deepEqual(headerPlacement(FOLDED), { kind: 'rail', frame: FOLDED.sideBar });
  });

  test('REQ-DUO-001 AC1: unfolded in portrait, the header row sits in the status band', () => {
    assert.deepEqual(headerPlacement(UNFOLDED_PORTRAIT), { kind: 'band', frame: UNFOLDED_PORTRAIT.topBar });
  });

  test('REQ-NFR-001 AC1: a regular iPhone keeps its header on top, in portrait and landscape', () => {
    assert.equal(headerPlacement(IPHONE_PORTRAIT), TOP_PLACEMENT);
    assert.equal(headerPlacement(IPHONE_LANDSCAPE), TOP_PLACEMENT);
  });

  test('REQ-NFR-001 AC1: without bar regions (older SDK, Android) the header stays on top', () => {
    assert.equal(headerPlacement(null), TOP_PLACEMENT);
    assert.equal(headerPlacement({ safeTop: 62 }), TOP_PLACEMENT);
  });

  test('the band row is centred on the bar region (mockup: row centre at y 48)', () => {
    assert.deepEqual(bandRowFrame(UNFOLDED_PORTRAIT.topBar, 48), { left: 0, top: 24, width: 466 });
  });
});

/*
 * Owner decision 2026-10-27 (§12, "1b"): with the root view controller answering `.disabled` the iPhone Duo
 * has no side bar in any pose. Frames as the iPhone Duo simulator (Xcode 27.1) measured them for
 * `.disabled`: folded = the outer display, 466x678; the top bar region is a 44-pt bar of the window's
 * `edgeInsets(for: .bar(onEdge: .top, extent: 44))`, which leaves out the status items.
 */
describe('header placement with the vertical bar disabled (owner §12 "1b", 2026-10-27)', () => {
  const FOLDED_PORTRAIT = {
    windowWidth: 466,
    windowHeight: 678,
    topBar: { x: 2.3, y: 26, width: 263.7, height: 44 },
    safeTop: 82,
    safeLeft: 0,
    safeRight: 0,
  };
  const FOLDED_LANDSCAPE_RIGHT = {
    windowWidth: 678,
    windowHeight: 466,
    topBar: { x: 84, y: 26, width: 576.7, height: 44 },
    safeTop: 82,
  };
  const FOLDED_LANDSCAPE_LEFT = {
    windowWidth: 678,
    windowHeight: 466,
    topBar: { x: 17.3, y: 26, width: 643.3, height: 44 },
    safeTop: 0,
  };

  test('folded in portrait: the header row sits in the status band beside the status items', () => {
    assert.deepEqual(headerPlacement(FOLDED_PORTRAIT), { kind: 'band', frame: FOLDED_PORTRAIT.topBar });
  });

  test('folded in the landscape with the camera top left: the band starts clear of the camera corner', () => {
    assert.deepEqual(headerPlacement(FOLDED_LANDSCAPE_RIGHT), { kind: 'band', frame: FOLDED_LANDSCAPE_RIGHT.topBar });
  });

  test('folded in the landscape with the camera at the bottom: no band, the header stays on top', () => {
    assert.equal(headerPlacement(FOLDED_LANDSCAPE_LEFT), TOP_PLACEMENT);
  });

  test('with no side bar nothing keeps off a side: content and scroll views keep their own widths', () => {
    assert.deepEqual(verticalBarInsets(FOLDED_PORTRAIT, { left: 0, right: 0 }), NO_BAR_INSETS);
    assert.equal(twoColumnWindow(FOLDED_PORTRAIT), false);
  });
});

describe('the band row overflows into the "…" menu (owner 2026-10-26 overflow rule, §12 "1b")', () => {
  const SESSIONS = { size: 48, gap: 8 };
  const names = ['search', 'web', 'machines', 'more'];

  test('buttons that fit: all of them, then fewer as the room shrinks, never fewer than one', () => {
    assert.equal(bandCapacity(1000, 4, SESSIONS), 4);
    assert.equal(bandCapacity(4 * 48 + 3 * 8, 4, SESSIONS), 4);
    assert.equal(bandCapacity(4 * 48 + 3 * 8 - 1, 4, SESSIONS), 3);
    assert.equal(bandCapacity(100, 4, SESSIONS), 1);
    assert.equal(bandCapacity(0, 4, SESSIONS), 1);
    assert.equal(bandCapacity(0, 1, SESSIONS), 1);
    assert.equal(bandCapacity(0, 0, SESSIONS), 0);
  });

  test('Sessions in the 264-pt folded band: Search, Web and "…" stay, Machines moves into the menu', () => {
    // 263.7 minus the row's 2 x 12 padding, a 68-pt title and the 8 pt before the buttons.
    assert.deepEqual(bandSplit(163.7, names, 0, 'always', SESSIONS), {
      row: ['search', 'web', 'more'],
      menu: ['machines'],
    });
  });

  test('the lowest buttons move first and the "…" always stays', () => {
    assert.deepEqual(bandSplit(2 * 48 + 8, names, 0, 'always', SESSIONS), {
      row: ['search', 'more'],
      menu: ['web', 'machines'],
    });
    assert.deepEqual(bandSplit(10, names, 0, 'always', SESSIONS), {
      row: ['more'],
      menu: ['search', 'web', 'machines'],
    });
  });

  test('with room, nothing moves', () => {
    assert.deepEqual(bandSplit(400, names, 0, 'always', SESSIONS), { row: names, menu: [] });
  });

  test('a leading Back (pinned) never moves, however narrow the row', () => {
    const terminal = ['back', 'view', 'more'];
    assert.deepEqual(bandSplit(88, terminal, 1, 'always', { size: 44, gap: 0 }), {
      row: ['back', 'more'],
      menu: ['view'],
    });
    assert.deepEqual(bandSplit(10, terminal, 1, 'always', { size: 44, gap: 0 }), {
      row: ['back', 'more'],
      menu: ['view'],
    });
  });

  test('K-5: a single optional button with no room for it moves into the "…"; with room it stays', () => {
    const fit = { size: 40, gap: 4 };
    // Reviewer r4 counterexample: 10 pt cannot hold a 40-pt button.
    assert.deepEqual(bandSplit(10, ['save', 'more'], 0, 'whenNeeded', fit), { row: ['more'], menu: ['save'] });
    assert.deepEqual(bandSplit(0, ['save', 'more'], 0, 'whenNeeded', fit), { row: ['more'], menu: ['save'] });
    // Boundary: exactly 40 pt fits, 1 pt short does not.
    assert.deepEqual(bandSplit(40, ['save', 'more'], 0, 'whenNeeded', fit), { row: ['save'], menu: [] });
    assert.deepEqual(bandSplit(39, ['save', 'more'], 0, 'whenNeeded', fit), { row: ['more'], menu: ['save'] });
  });

  test('a "…" that shows only when needed (stack screens) is left out while the buttons fit', () => {
    const stack = ['annotate', 'copy', 'reload', 'more'];
    const fit = { size: 40, gap: 4 };
    assert.deepEqual(bandSplit(3 * 40 + 2 * 4, stack, 0, 'whenNeeded', fit), {
      row: ['annotate', 'copy', 'reload'],
      menu: [],
    });
    assert.deepEqual(bandSplit(3 * 40 + 2 * 4 - 1, stack, 0, 'whenNeeded', fit), {
      row: ['annotate', 'more'],
      menu: ['copy', 'reload'],
    });
  });
});

describe('content beside the side bar', () => {
  test('REQ-DUO-005 AC2: folded, the content stays left of the status column', () => {
    assert.deepEqual(verticalBarInsets(FOLDED, { left: 0, right: 84 }), { left: 0, right: 84 });
  });

  test('REQ-DUO-003 AC4: unfolded in landscape the column (and the key bar in it) ends at the side bar', () => {
    assert.deepEqual(verticalBarInsets({ edge: 'trailing' }, { left: 0, right: 81 }), { left: 0, right: 81 });
  });

  test('folded in landscape the side bar is on the leading side and the content keeps off it', () => {
    assert.deepEqual(verticalBarInsets({ edge: 'leading' }, { left: 84, right: 0 }), { left: 84, right: 0 });
  });

  test('REQ-NFR-001 AC1: a regular iPhone in landscape keeps its layout (no side bar, no added insets)', () => {
    assert.equal(verticalBarInsets(IPHONE_LANDSCAPE, { left: 62, right: 62 }), NO_BAR_INSETS);
  });
});

/*
 * The rail's buttons stay above the keyboard (owner device session 2026-10-26, folded, Live Activity
 * shown: region from y 264, keyboard top at 413, three buttons). Rule: as the mockup draws them
 * (46 pt, 12 pt apart) when they fit; otherwise the gap shrinks to at least 4 pt, then the buttons to
 * at least 40 pt, each still a 44-pt touch target.
 */
describe('side bar buttons above the keyboard (REQ-DUO-005 AC2)', () => {
  const FOLDED_LIVE_ACTIVITY = { x: 395, y: 264, width: 46, height: 380 };

  test('REQ-DUO-005 AC2: the span ends at the keyboard, or at the region without one', () => {
    assert.equal(railSpan(FOLDED_LIVE_ACTIVITY, 413), 149);
    assert.equal(railSpan(FOLDED_LIVE_ACTIVITY, null), 380);
    assert.equal(railSpan(FOLDED_LIVE_ACTIVITY, 900), 380);
    assert.equal(railSpan(FOLDED_LIVE_ACTIVITY, 200), 0);
  });

  test('REQ-DUO-005 AC2: buttons that fit keep the mockup size and spacing', () => {
    assert.equal(railFit(380, 3), RAIL_FIT);
    assert.equal(railFit(162, 3), RAIL_FIT);
  });

  test('REQ-DUO-005 AC2: the gap shrinks first, so three buttons end above a keyboard at 413', () => {
    const fit = railFit(149, 3);
    assert.deepEqual(fit, { size: 46, gap: 5 });
    assert.ok(264 + 3 * fit.size + 2 * fit.gap <= 413);
  });

  test('REQ-DUO-005 AC2: then the buttons shrink, to 40 pt and 4 pt apart at the least', () => {
    assert.deepEqual(railFit(130, 3), { size: 40, gap: 4 });
    assert.deepEqual(railFit(136, 3), { size: 42, gap: 4 });
  });

  test('a smaller button keeps a 44-pt touch target through hit slop', () => {
    assert.equal(railHitSlop(46), 0);
    assert.equal(railHitSlop(42), 1);
    assert.equal(railHitSlop(40), 2);
  });
});

/*
 * Owner decision 2026-10-26 ("Überzählige ins …-Menü"): buttons that do not fit above the keyboard even
 * at 40 pt, 4 pt apart, move into the screen's "More options" menu, lowest first, and come back once
 * there is room. "More options" (last) always stays; Terminal's Back (pinned) never moves.
 */
describe('side bar overflow into More options (REQ-DUO-005 AC2, owner decision 2026-10-26)', () => {
  const TERMINAL = ['back', 'view', 'more'];
  const SESSIONS = ['search', 'web', 'machines', 'more'];

  test('REQ-DUO-005 AC2: all stay while they fit at the minimum', () => {
    assert.equal(railCapacity(149, 3), 3);
    assert.equal(railCapacity(4 * 40 + 3 * 4, 4), 4);
    assert.deepEqual(railSplit(SESSIONS, 4, 0), { rail: SESSIONS, menu: [] });
  });

  test('REQ-DUO-005 AC2: past the minimum, as many as fit at 40 pt and 4 pt apart stay, at least one', () => {
    assert.equal(railCapacity(149, 4), 3);
    assert.equal(railCapacity(100, 4), 2);
    assert.equal(railCapacity(30, 3), 1);
  });

  test('owner decision 2026-10-26: the lowest buttons above More options move first', () => {
    assert.deepEqual(railSplit(SESSIONS, 3, 0), { rail: ['search', 'web', 'more'], menu: ['machines'] });
    assert.deepEqual(railSplit(SESSIONS, 2, 0), { rail: ['search', 'more'], menu: ['web', 'machines'] });
    assert.deepEqual(railSplit(SESSIONS, 1, 0), { rail: ['more'], menu: ['search', 'web', 'machines'] });
  });

  test('owner decision 2026-10-26: Back and More options never move', () => {
    assert.deepEqual(railSplit(TERMINAL, 2, 1), { rail: ['back', 'more'], menu: ['view'] });
    assert.deepEqual(railSplit(TERMINAL, 1, 1), { rail: ['back', 'more'], menu: ['view'] });
  });

  test('owner decision 2026-10-26: with room again the buttons return to the rail', () => {
    const crowded = railSplit(TERMINAL, railCapacity(60, TERMINAL.length), 1);
    assert.deepEqual(crowded.menu, ['view']);
    const roomy = railSplit(TERMINAL, railCapacity(380, TERMINAL.length), 1);
    assert.deepEqual(roomy, { rail: TERMINAL, menu: [] });
  });

  test('REQ-DUO-005 AC2, owner decision 2026-10-26: kept Back and More options get the fit of the two drawn', () => {
    // 80 pt hold one button at the minimum, but Back and More options both stay: drawn at 40 pt, 4 pt apart
    // (84 pt), not at the mockup's 46 pt, 12 pt apart (104 pt).
    const crowded = railLayout(80, TERMINAL, 1);
    assert.equal(crowded.shown, 1);
    assert.deepEqual(crowded.rail, ['back', 'more']);
    assert.deepEqual(crowded.menu, ['view']);
    assert.deepEqual(crowded.fit, { size: 40, gap: 4 });
  });

  test('REQ-DUO-005 AC2: the drawn buttons take the room they have (two kept in 100 pt: 46 pt, 8 pt apart)', () => {
    const layout = railLayout(100, TERMINAL, 1);
    assert.deepEqual(layout.rail, ['back', 'more']);
    assert.deepEqual(layout.fit, { size: 46, gap: 8 });
  });
});

/*
 * Owner decision 2026-10-26: the rail stays put when the keyboard shows or hides. Where a keyboard can
 * reach the rail it is laid out for the keyboard being up, from the keyboard height measured in a window
 * of that size on this install (stored across launches). No device sizes: before a keyboard has
 * appeared in a window size, nothing is reserved there. The figures are the owner's device session
 * (folded, 466x678, keyboard top at 413 pt, so 265 pt high).
 */
describe('side bar independent of the keyboard (REQ-DUO-005 AC2, owner decision 2026-10-26)', () => {
  const FOLDED = { width: 466, height: 678 };
  const RAIL = { x: 395, y: 264, width: 46, height: 380 };
  const MEASURED = { '466x678': 265 };

  test('REQ-DUO-005 AC2: before a keyboard appeared in a window size, nothing is reserved there', () => {
    assert.equal(keyboardHeightFor(FOLDED, {}), null);
    assert.equal(reservedKeyboardTop(FOLDED, null), null);
    assert.equal(railSpan(RAIL, reservedKeyboardTop(FOLDED, keyboardHeightFor(FOLDED, {}))), 380);
  });

  test('REQ-DUO-005 AC2: the height measured in a window of that size is reserved, whatever its fraction', () => {
    assert.equal(keyboardHeightFor(FOLDED, MEASURED), 265);
    assert.equal(keyboardHeightFor({ width: 466.4, height: 677.6 }, MEASURED), 265);
    assert.equal(keyboardHeightFor({ width: 951, height: 669 }, MEASURED), null);
    assert.equal(reservedKeyboardTop(FOLDED, 265), 413);
  });

  test('owner decision 2026-10-26: once measured, the folded rail has the keyboard-up layout, keyboard or not', () => {
    const span = railSpan(RAIL, reservedKeyboardTop(FOLDED, keyboardHeightFor(FOLDED, MEASURED)));
    assert.equal(span, 149);
    const layout = railLayout(span, ['back', 'view', 'more'], 1);
    assert.deepEqual(layout.rail, ['back', 'view', 'more']);
    assert.deepEqual(layout.fit, { size: 46, gap: 5 });
  });

  test('REQ-DUO-005 AC2: stored heights read back keep only positive numbers', () => {
    assert.deepEqual(sanitizeKeyboardHeights({ '466x678': 265, '951x669': 0, bad: 'x', neg: -3 }), { '466x678': 265 });
    assert.deepEqual(sanitizeKeyboardHeights(null), {});
    assert.deepEqual(sanitizeKeyboardHeights([265]), {});
  });
});

/*
 * Owner, 2026-10-26 (§1.5 S1-10, FL-LAY-08): rotating or folding must not make the header jump. The
 * window's new size (React Native) and the system's new bar regions arrive over separate paths, in
 * either order. The chrome only ever follows a layout the system reported: it never computes a guessed
 * placement for a size the system has not reported (the counterexample of review s1-floor-r1: "top"
 * first, then "rail"), so it changes once, from the old window's layout to the new window's.
 */
describe('the chrome follows only reported bar layouts (REQ-DUO-001 AC1, owner S1-10, 2026-10-26)', () => {
  const PORTRAIT_BAND = {
    windowWidth: 669,
    windowHeight: 951,
    topBar: { x: 0, y: 26, width: 520, height: 44 },
    safeTop: 80,
    safeLeft: 0,
    safeRight: 0,
  };
  const LANDSCAPE_RAIL = {
    windowWidth: 951,
    windowHeight: 669,
    edge: 'trailing' as const,
    sideBar: { x: 880, y: 224, width: 46, height: 400 },
    safeTop: 0,
    safeLeft: 0,
    safeRight: 81,
  };
  const FOLDED_RAIL = {
    windowWidth: 466,
    windowHeight: 678,
    edge: 'trailing' as const,
    sideBar: { x: 395, y: 174, width: 46, height: 470 },
    safeTop: 0,
    safeLeft: 0,
    safeRight: 84,
  };
  const PORTRAIT = { width: 669, height: 951 };
  const LANDSCAPE = { width: 951, height: 669 };
  const FOLDED_SIZE = { width: 466, height: 678 };
  const reported = (layout: typeof PORTRAIT_BAND | typeof LANDSCAPE_RAIL, seenAt: { width: number; height: number }) =>
    ({ layout, seenAt: windowSizeKey(seenAt) }) satisfies LiveBarLayout;

  test('owner S1-10: React Native reports the new size first, the chrome keeps the old layout and never computes top', () => {
    const steps = [
      chromeLayout(PORTRAIT, reported(PORTRAIT_BAND, PORTRAIT), {}),
      // The window turned; the system's regions for it have not arrived yet.
      chromeLayout(LANDSCAPE, reported(PORTRAIT_BAND, PORTRAIT), {}),
      chromeLayout(LANDSCAPE, reported(LANDSCAPE_RAIL, LANDSCAPE), {}),
    ].map((layout) => headerPlacement(layout).kind);
    assert.deepEqual(steps, ['band', 'band', 'rail']);
  });

  test('owner S1-10: the system reports first, the chrome takes its layout at once', () => {
    const steps = [
      chromeLayout(PORTRAIT, reported(LANDSCAPE_RAIL, PORTRAIT), {}),
      chromeLayout(LANDSCAPE, reported(LANDSCAPE_RAIL, PORTRAIT), {}),
    ].map((layout) => headerPlacement(layout).kind);
    assert.deepEqual(steps, ['rail', 'rail']);
  });

  test('owner S1-10: a layout the system reported before for the new size and the current edge is used at once', () => {
    const stored = { [geometryKey(FOLDED_SIZE, 'trailing')]: FOLDED_RAIL };
    const layout = chromeLayout(FOLDED_SIZE, reported(LANDSCAPE_RAIL, LANDSCAPE), stored);
    assert.equal(layout, FOLDED_RAIL);
    assert.deepEqual(verticalBarInsets(layout, NO_BAR_INSETS), { left: 0, right: 84 });
  });

  test('owner S1-10: a layout stored with the side bar on another edge is not taken', () => {
    const stored = { [geometryKey(LANDSCAPE, 'leading')]: { ...LANDSCAPE_RAIL, edge: 'leading' as const } };
    assert.equal(chromeLayout(LANDSCAPE, reported(PORTRAIT_BAND, PORTRAIT), stored), PORTRAIT_BAND);
  });

  test('REQ-DUO-005 AC2: at the same size the live layout wins over a stored one (a Live Activity moving the rail)', () => {
    const withActivity = { ...FOLDED_RAIL, sideBar: { x: 395, y: 264, width: 46, height: 380 } };
    const stored = { [geometryKey(FOLDED_SIZE, 'trailing')]: FOLDED_RAIL };
    const live: LiveBarLayout = { layout: withActivity, seenAt: windowSizeKey(FOLDED_SIZE) };
    assert.equal(chromeLayout(FOLDED_SIZE, live, stored), withActivity);
  });

  test('FL-STA-04: before the system has reported, there is no layout to place anything with', () => {
    const stored = { [geometryKey(LANDSCAPE, 'trailing')]: LANDSCAPE_RAIL };
    assert.equal(chromeLayout(LANDSCAPE, null, stored), null);
  });

  test('REQ-DUO-001 AC1: stored layouts read back keep only layouts under their own size and edge', () => {
    const raw = {
      '951x669:trailing': LANDSCAPE_RAIL,
      '951x669': LANDSCAPE_RAIL,
      '669x951:none': { ...PORTRAIT_BAND, windowWidth: 700 },
      '466x678:trailing': { windowWidth: 466, windowHeight: 678, edge: 'up' },
      bad: 3,
    };
    assert.deepEqual(sanitizeBarLayouts(raw), { '951x669:trailing': LANDSCAPE_RAIL });
    assert.deepEqual(sanitizeBarLayouts(null), {});
  });
});

/*
 * Owner 2026-10-26: buttons that do not fit go into "More options" (…), lowest first, Back stays
 * (K-15). Web Preview's … is always there (D1); a screen without one gets it only when needed.
 */
describe('the side bar\'s "More options" (REQ-DUO-005 AC2, owner decisions K-15 and D1, 2026-10-26)', () => {
  const DOC_VIEWER = ['back', 'annotate', 'copy-path', 'reload', 'more'];
  const WEB_PREVIEW = ['close', 'back', 'reload', 'more'];

  test('REQ-DUO-005 AC2: a screen without its own … shows all its buttons and no … while they fit', () => {
    const view = railLayoutFor(400, DOC_VIEWER, 1, 'whenNeeded');
    assert.deepEqual(view.rail, ['back', 'annotate', 'copy-path', 'reload']);
    assert.deepEqual(view.menu, []);
    assert.deepEqual(railSplit(DOC_VIEWER, view.shown, 1).menu, []);
  });

  test('REQ-DUO-005 AC2: when they do not fit, a … follows the ones that do and holds the lowest', () => {
    const view = railLayoutFor(149, DOC_VIEWER, 1, 'whenNeeded');
    assert.deepEqual(view.rail, ['back', 'annotate', 'more']);
    assert.deepEqual(view.menu, ['copy-path', 'reload']);
    assert.deepEqual(railSplit(DOC_VIEWER, view.shown, 1).menu, view.menu);
  });

  test('owner D1: Web Preview keeps Close and its … always; Reload moves into the … when short', () => {
    assert.deepEqual(railLayoutFor(400, WEB_PREVIEW, 1, 'always').rail, WEB_PREVIEW);
    const short = railLayoutFor(149, WEB_PREVIEW, 1, 'always');
    assert.deepEqual(short.rail, ['close', 'back', 'more']);
    assert.deepEqual(short.menu, ['reload']);
  });

  test('REQ-DUO-005 AC2: Back alone never gets a …', () => {
    const view = railLayoutFor(40, ['back', 'more'], 1, 'whenNeeded');
    assert.deepEqual(view.rail, ['back']);
    assert.deepEqual(view.menu, []);
  });
});

describe('top rows and Settings columns in the side bar poses (REQ-DUO-001 AC5, owner F1/F2, 2026-10-26)', () => {
  const INNER_LANDSCAPE = {
    windowWidth: 951,
    windowHeight: 669,
    edge: 'trailing' as const,
    sideBar: { x: 880, y: 224, width: 46, height: 400 },
    safeTop: 0,
    safeRight: 81,
    marginTop: 8,
    horizontalSizeClass: 'regular' as const,
    verticalSizeClass: 'regular' as const,
  };

  test('owner F1: a top row starts below the system top margin, never above the safe area', () => {
    assert.equal(railContentTop(INNER_LANDSCAPE, 0), 8);
    assert.equal(railContentTop({ ...INNER_LANDSCAPE, safeTop: 20, marginTop: 28 }, 20), 28);
    assert.equal(railContentTop(null, 20), 20);
  });

  /*
   * Owner F2 with FL-LAY-02 (review s1-floor-r1 #14): two columns from the content's width, not from the
   * orientation. The approved mapping stays: the unfolded Duo in landscape shows two columns; unfolded in
   * portrait, folded either way, in Split View, on every regular iPhone size of REQ-NFR-011 and on an
   * iPad Settings keeps one column.
   */
  test('owner F2: two columns where the Duo chrome is in place and the list plus a readable page fit', () => {
    assert.equal(SETTINGS_LIST_WIDTH + SETTINGS_PAGE_MIN_WIDTH, 695);
    const windows: [string, Parameters<typeof twoColumnWindow>[0], boolean][] = [
      ['inner landscape, side bar trailing', INNER_LANDSCAPE, true],
      ['inner landscape, side bar leading', { ...INNER_LANDSCAPE, edge: 'leading', safeRight: 0, safeLeft: 81 }, true],
      ['inner portrait (band)', { ...UNFOLDED_PORTRAIT, windowWidth: 669, windowHeight: 951 }, false],
      ['folded portrait', { ...FOLDED, windowWidth: 466, windowHeight: 678, safeRight: 84 }, false],
      ['folded landscape', { ...FOLDED, edge: 'leading', windowWidth: 678, windowHeight: 466, safeLeft: 84 }, false],
      ['inner Split View half', { ...INNER_LANDSCAPE, windowWidth: 469 }, false],
      // Wider than tall, yet list and page do not fit: one column (no orientation gate).
      ['inner Split View, 700 pt wide', { ...INNER_LANDSCAPE, windowWidth: 700 }, false],
      ['iPhone 390x844', { ...IPHONE_PORTRAIT, windowWidth: 390, windowHeight: 844 }, false],
      ['iPhone 844x390', { ...IPHONE_LANDSCAPE, windowWidth: 844, windowHeight: 390 }, false],
      ['iPhone 956x440', { ...IPHONE_LANDSCAPE, windowWidth: 956, windowHeight: 440 }, false],
      [
        'iPad 1366x1024',
        { windowWidth: 1366, windowHeight: 1024, safeTop: 24, topBar: { x: 0, y: 24, width: 1366, height: 44 } },
        false,
      ],
      ['no layout', null, false],
    ];
    for (const [name, layout, expected] of windows) assert.equal(twoColumnWindow(layout), expected, name);
  });

  test('REQ-DUO-001 AC1: stored layouts keep the margin and size classes', () => {
    assert.deepEqual(sanitizeBarLayouts({ '951x669:trailing': INNER_LANDSCAPE })['951x669:trailing'], {
      ...INNER_LANDSCAPE,
      safeLeft: undefined,
    });
  });
});

/*
 * F3 (2026-10-26, the owner's rule that menus do not float in the middle of the screen): a menu opened
 * from a header button on the iPhone Duo stands at that button, inside the window, clear of the side bar.
 */
describe('menus at their button (REQ-DUO-001 AC5, owner F3, 2026-10-26)', () => {
  const ROOM = { left: 8, top: 8, right: 951 - 81 - 8, bottom: 669 - 8 };
  const RAIL_BUTTON = { x: 880, y: 224, width: 46, height: 46 };

  test('owner F3: from a side bar button the menu opens toward the content, top-aligned with it', () => {
    const origin = anchoredMenuOrigin(RAIL_BUTTON, { width: 300, height: 200 }, ROOM, 'rail', 'trailing');
    assert.equal(origin.top, RAIL_BUTTON.y);
    assert.ok(origin.left + 300 <= ROOM.right && origin.left + 300 < RAIL_BUTTON.x);
  });

  test('owner F3: a menu taller than the room below its button moves up to stay inside the window', () => {
    const origin = anchoredMenuOrigin(RAIL_BUTTON, { width: 300, height: 500 }, ROOM, 'rail', 'trailing');
    assert.equal(origin.top + 500, ROOM.bottom);
  });

  test('owner F3: with the side bar on the leading side the menu opens to its right', () => {
    const button = { x: 8, y: 224, width: 46, height: 46 };
    const room = { left: 89, top: 8, right: 943, bottom: 661 };
    const origin = anchoredMenuOrigin(button, { width: 300, height: 200 }, room, 'rail', 'leading');
    assert.ok(origin.left >= button.x + button.width && origin.left >= room.left);
  });

  test('owner F3: from a status band button the menu opens below it, ending at its trailing edge', () => {
    const button = { x: 600, y: 26, width: 44, height: 44 };
    const room = { left: 8, top: 26, right: 661, bottom: 940 };
    const origin = anchoredMenuOrigin(button, { width: 300, height: 200 }, room, 'band', undefined);
    assert.deepEqual(origin, { left: 344, top: 78 });
  });
});

/*
 * §1.5 S1-5 with FL-LAY-14 (review s1-floor-r1 #13): an open menu stays open and stays at its button
 * when that button moves: band to rail, the side bar changing sides, a Live Activity lowering the rail.
 * The counterexample of the review: opened from the band button at y 26, after the turn the button
 * stands in the side bar at y 224, and the menu must stand there.
 */
describe('an open menu follows its button (owner S1-5 and F3, 2026-10-26)', () => {
  const PRESSED_IN_BAND = { x: 600, y: 26, width: 44, height: 44 };
  const RAIL_REGION = { x: 880, y: 224, width: 46, height: 400 };
  const ROOM = { left: 8, top: 8, right: 951 - 81 - 8, bottom: 669 - 8 };
  const TERMINAL_RAIL = ['back', 'view', 'more'];
  /** The window frame of the rail's button `index` as the rail draws it (no keyboard, no fold). */
  const drawnFrame = (region: typeof RAIL_REGION, index: number) => {
    const view = railLayoutFor(railSegments(region, null, undefined), TERMINAL_RAIL, 1, 'always');
    return railButtonFrame(region, view.fit, view.tops[index]);
  };

  test('owner S1-5: after band to rail the menu stands at the live side bar button, not where it was pressed', () => {
    const anchor = liveMenuAnchor('rail', drawnFrame(RAIL_REGION, 0), undefined, PRESSED_IN_BAND, true);
    assert.deepEqual(anchor, { x: 880, y: 224, width: 46, height: 46 });
    if (anchor === undefined) throw new Error('anchored menu expected');
    assert.equal(anchoredMenuOrigin(anchor, { width: 300, height: 200 }, ROOM, 'rail', 'trailing').top, 224);
  });

  test('owner S1-5: the side bar button is found where the rail draws it (Terminal: Back, view, More)', () => {
    assert.deepEqual(drawnFrame(RAIL_REGION, 2), { x: 880, y: 224 + 2 * 58, width: 46, height: 46 });
    // Three buttons in 128 pt: 40 pt, 4 pt apart.
    assert.deepEqual(drawnFrame({ ...RAIL_REGION, width: 52, height: 128 }, 1), {
      x: 886,
      y: 268,
      width: 40,
      height: 40,
    });
  });

  test('REQ-DUO-005 AC2: a Live Activity lowering the side bar moves the open menu with its button', () => {
    const lowered = { ...RAIL_REGION, y: 300, height: 324 };
    const anchor = liveMenuAnchor('rail', drawnFrame(lowered, 0), undefined, PRESSED_IN_BAND, true);
    assert.equal(anchor?.y, 300);
  });

  test('owner S1-5: back in the band the menu stands at the band button as measured now', () => {
    const measured = { x: 590, y: 26, width: 44, height: 44 };
    const pressedInRail = { x: 880, y: 224, width: 46, height: 46 };
    assert.deepEqual(liveMenuAnchor('band', null, measured, pressedInRail, true), measured);
  });

  test('owner F3: a menu whose button has no place in the band, and every menu on top, is centred', () => {
    assert.equal(liveMenuAnchor('band', null, undefined, PRESSED_IN_BAND, false), undefined);
    assert.equal(liveMenuAnchor('top', null, undefined, PRESSED_IN_BAND, true), undefined);
  });
});

/*
 * FL-LAY-05 (review s1-floor-r1 #8): a scroll view spans the window under the side bar and keeps its
 * content clear of it through the content's padding; a full-window modal layer covers the window and
 * pads what it holds. Without a side bar (every regular iPhone, also in landscape: REQ-NFR-001) nothing
 * is added. Insets are the folded Duo's (84 pt, side bar trailing).
 */
describe('scroll content clear of the side bar (REQ-DUO-005 AC2, REQ-NFR-001 AC1, FL-LAY-05)', () => {
  test('REQ-NFR-001 AC1: without a side bar a scroll view and its content keep their own styles', () => {
    const edges = scrollToBarEdges(verticalBarInsets(IPHONE_LANDSCAPE, { left: 62, right: 62 }), 12);
    assert.deepEqual(edges, { scroll: {}, content: {} });
    assert.deepEqual(barPadding(NO_BAR_INSETS, 24), { paddingLeft: 24, paddingRight: 24 });
  });

  test('REQ-DUO-005 AC2: folded, the scroll view reaches under the side bar and its content keeps clear of it', () => {
    const edges = scrollToBarEdges(verticalBarInsets(FOLDED, { left: 0, right: 84 }), 12);
    assert.equal(edges.scroll.marginLeft, 0);
    assert.equal(edges.scroll.marginRight, -84);
    assert.equal(edges.content.paddingLeft, 12);
    assert.equal(edges.content.paddingRight, 96);
  });

  test('REQ-DUO-005 AC2: a modal layer covers the window and pads its card clear of the side bar', () => {
    assert.deepEqual(barPadding({ left: 0, right: 84 }, 24), { paddingLeft: 24, paddingRight: 108 });
  });

  test('REQ-DUO-001 AC1: a page with its own side padding keeps it, per side, plus the side bar (leading, 81 pt)', () => {
    const edges = scrollToBarEdges({ left: 81, right: 0 }, { left: 16, right: 20 });
    assert.equal(edges.scroll.marginLeft, -81);
    assert.equal(edges.scroll.marginRight, 0);
    assert.equal(edges.content.paddingLeft, 97);
    assert.equal(edges.content.paddingRight, 20);
  });

  test('owner F2: in two columns each column reaches over the side bar on its own side only', () => {
    const trailing = { left: 0, right: 81 };
    const list = scrollToBarEdges({ left: trailing.left, right: 0 }, 12);
    const page = scrollToBarEdges({ left: 0, right: trailing.right }, 12);
    assert.deepEqual(list, { scroll: {}, content: {} });
    assert.equal(page.scroll.marginRight, -81);
    assert.equal(page.content.paddingRight, 93);
    assert.equal(page.content.paddingLeft, 12);
  });
});

/*
 * §1.5 S1-10 with review s1-floor-r2 #3: a kept layout stands in for a window size only while the system
 * has not contradicted it. The folded display's side bar moving (a Live Activity) contradicts the kept
 * folded layout, so the landscape one, kept before the activity, is no longer taken.
 */
describe('kept layouts stay only while the system agrees (REQ-DUO-001 AC5, owner S1-10)', () => {
  const FOLDED_LAYOUT = {
    windowWidth: 466,
    windowHeight: 678,
    safeTop: 0,
    safeRight: 84,
    edge: 'trailing' as const,
    sideBar: { x: 395, y: 174, width: 46, height: 470 },
  };
  const LANDSCAPE_LAYOUT = {
    windowWidth: 951,
    windowHeight: 669,
    safeTop: 10,
    safeRight: 81,
    edge: 'trailing' as const,
    sideBar: { x: 880, y: 116, width: 46, height: 520 },
  };
  const kept = { '466x678:trailing': FOLDED_LAYOUT, '951x669:trailing': LANDSCAPE_LAYOUT };

  test('REQ-DUO-001 AC5: a layout reported at a new size is kept beside the others', () => {
    assert.deepEqual(layoutsAfterReport({ '466x678:trailing': FOLDED_LAYOUT }, LANDSCAPE_LAYOUT), kept);
  });

  test('owner S1-10: the same layout again changes nothing, whatever the order of its fields', () => {
    const reordered = {
      sideBar: { height: 470, width: 46, y: 174, x: 395 },
      edge: 'trailing' as const,
      safeRight: 84,
      safeTop: 0,
      windowHeight: 678,
      windowWidth: 466,
    };
    assert.equal(layoutsAfterReport(kept, reordered), null);
  });

  test('owner S1-10: the status items moving at one size drops the layouts kept at the others', () => {
    const lowered = { ...FOLDED_LAYOUT, sideBar: { x: 395, y: 230, width: 46, height: 414 } };
    const after = layoutsAfterReport(kept, lowered);
    assert.deepEqual(after, { '466x678:trailing': lowered });
    // Turned to landscape, React Native first: nothing kept stands in, the old layout stays until the system's.
    const live: LiveBarLayout = { layout: lowered, seenAt: '466x678' };
    assert.equal(chromeLayout({ width: 951, height: 669 }, live, after ?? {}), lowered);
  });
});

/*
 * Owner A1, 2026-10-27 (§1.5 S1-4 refined, "einmal anpassen, danach stabil"): the rail reserves the
 * tallest keyboard seen in a window size. It rearranges when the first keyboard appears there or a taller
 * one does, and never moves back. Figures: the folded rail of the owner's device session (466x678, rail
 * from y 264, 380 pt; keyboard 265 pt), a taller keyboard (a predictive bar) assumed 300 pt.
 */
describe('the keyboard reserve only grows (REQ-DUO-005 AC2, owner A1, 2026-10-27)', () => {
  const KEY = '466x678';
  const FOLDED = { width: 466, height: 678 };
  const RAIL = { x: 395, y: 264, width: 46, height: 380 };
  const BUTTONS = ['back', 'a', 'b', 'c', 'more'];
  const railFor = (heights: Record<string, number>) =>
    railLayoutFor(
      railSegments(RAIL, reservedKeyboardTop(FOLDED, keyboardHeightFor(FOLDED, heights)), undefined),
      BUTTONS,
      1,
      'always',
    );

  test('owner A1: the first keyboard in a window size changes the rail once', () => {
    const before = railFor({});
    const first = grownKeyboardHeights({}, KEY, 265);
    assert.deepEqual(first, { [KEY]: 265 });
    const after = railFor(first ?? {});
    assert.notDeepEqual(after.tops, before.tops);
  });

  test('owner A1: a lower keyboard afterwards changes nothing, nor does the same one again', () => {
    assert.equal(grownKeyboardHeights({ [KEY]: 265 }, KEY, 230), null);
    assert.equal(grownKeyboardHeights({ [KEY]: 265 }, KEY, 265.2), null);
  });

  test('owner A1: a taller keyboard changes it once more, and a lower one then never moves it back', () => {
    const taller = grownKeyboardHeights({ [KEY]: 265 }, KEY, 300);
    assert.deepEqual(taller, { [KEY]: 300 });
    assert.notDeepEqual(railFor(taller ?? {}), railFor({ [KEY]: 265 }));
    assert.equal(grownKeyboardHeights(taller ?? {}, KEY, 265), null);
  });

  test('owner A1: what was stored and what was measured while reading it keep the taller per size', () => {
    assert.deepEqual(mergedKeyboardHeights({ [KEY]: 265, '951x669': 234 }, { [KEY]: 230, '669x951': 323 }), {
      [KEY]: 265,
      '951x669': 234,
      '669x951': 323,
    });
  });

  test('REQ-DUO-005 AC2: another window size keeps its own reserve', () => {
    assert.deepEqual(grownKeyboardHeights({ [KEY]: 300 }, '951x669', 234), { [KEY]: 300, '951x669': 234 });
  });
});

/*
 * FL-DUO-03 with owner B1, 2026-10-27: no rail or band button and no menu at one stands in the fold's
 * division in the half-folded poses. Geometry (mockup kit devices.js, research 5.4.6): laptop is the
 * inner display in portrait (669x951) with a horizontal division about y 466-484; book is the inner
 * display in landscape (951x669) with a vertical division about x 466-484; the rail stands at the right
 * edge from y 116 (devices.js toolsTop). The division is a gap in the rail: the buttons flow past it,
 * Back stays first, More options stays, and what does not fit goes bottom-up into More options.
 */
describe("off the fold's division (FL-DUO-03, owner B1, 2026-10-27)", () => {
  // Half folded: the system reports the divisions active.
  const BOOK_DIVISION = { x: 466, y: 0, width: 18, height: 669, active: true };
  const LAPTOP_DIVISION = { x: 0, y: 466, width: 669, height: 18, active: true };
  const BOOK_RAIL = { x: 880, y: 116, width: 46, height: 520 };
  const LAPTOP_BAND = { x: 0, y: 26, width: 466, height: 44 };
  const ACROSS_RAIL = { x: 0, y: 330, width: 951, height: 18, active: true };
  const inDivision = (top: number, size: number, division: { y: number; height: number }) =>
    top < division.y + division.height && top + size > division.y;

  test('book: a vertical division beside the rail leaves the rail as it was', () => {
    assert.deepEqual(railSegments(BOOK_RAIL, null, [BOOK_DIVISION]), [{ top: 116, bottom: 636 }]);
    const view = railLayoutFor(railSegments(BOOK_RAIL, null, [BOOK_DIVISION]), ['back', 'a', 'more'], 1, 'always');
    assert.deepEqual(view.tops, [116, 174, 232]);
  });

  test('owner B1: a division across the rail is a gap the buttons flow past', () => {
    const view = railLayoutFor(railSegments(BOOK_RAIL, null, [ACROSS_RAIL]), ['back', 'a', 'b', 'more'], 1, 'always');
    assert.deepEqual(view.rail, ['back', 'a', 'b', 'more']);
    assert.deepEqual(view.tops, [116, 174, 232, 348]);
    for (const top of view.tops) assert.equal(inDivision(top, view.fit.size, ACROSS_RAIL), false);
    assert.deepEqual(railStepOffsets(view.tops, BOOK_RAIL.y, view.fit.size + view.fit.gap), [0, 0, 0, 58]);
  });

  test('owner B1: past the division what does not fit goes bottom-up into More options; Back and More stay', () => {
    const short = { ...BOOK_RAIL, y: 224, height: 160 };
    const division = { x: 0, y: 300, width: 951, height: 18 };
    const view = railLayoutFor(railSegments(short, null, [division]), ['back', 'a', 'b', 'more'], 1, 'always');
    assert.deepEqual(view.rail, ['back', 'more']);
    assert.deepEqual(view.menu, ['a', 'b']);
    assert.deepEqual(view.tops, [224, 318]);
    for (const top of view.tops) assert.equal(inDivision(top, view.fit.size, division), false);
  });

  test('FL-DUO-03: an inactive division (a line while flat) is not straddled either, so folding moves nothing', () => {
    const line = { x: 0, y: 300, width: 951, height: 0 };
    const view = railLayoutFor(
      railSegments({ ...BOOK_RAIL, y: 224 }, null, [line]),
      ['back', 'a', 'more'],
      1,
      'always',
    );
    assert.deepEqual(view.tops, [224, 300, 358]);
  });

  test('REQ-NFR-001 AC1: without divisions the rail is laid out as before', () => {
    const view = railLayoutFor(railSegments(BOOK_RAIL, null, []), ['back', 'a', 'more'], 1, 'always');
    const bySpan = railLayoutFor(520, ['back', 'a', 'more'], 1, 'always');
    assert.deepEqual(view.fit, bySpan.fit);
    assert.deepEqual(view.fit, RAIL_FIT);
    assert.deepEqual(view.tops, [116, 174, 232]);
    assert.deepEqual(
      view.tops,
      bySpan.tops.map((top) => top + BOOK_RAIL.y),
    );
  });

  test('laptop: the band row keeps its place, the division lies below it', () => {
    const placement = headerPlacement({ ...UNFOLDED_PORTRAIT, topBar: LAPTOP_BAND, divisions: [LAPTOP_DIVISION] });
    assert.deepEqual(placement, { kind: 'band', frame: LAPTOP_BAND });
  });

  test('owner B1: a division across the band leaves the band row on its larger side, so no band button is in it', () => {
    const across = { x: 200, y: 0, width: 18, height: 951, active: true };
    assert.deepEqual(clearOfDivisions(LAPTOP_BAND, [across]), { x: 218, y: 26, width: 248, height: 44 });
    const placement = headerPlacement({ ...UNFOLDED_PORTRAIT, topBar: LAPTOP_BAND, divisions: [across] });
    assert.deepEqual(placement, { kind: 'band', frame: { x: 218, y: 26, width: 248, height: 44 } });
  });

  test('owner B1, laptop: a menu from a band button stays above the division, however long', () => {
    const button = { x: 420, y: 26, width: 44, height: 44 };
    const room = menuRoomBeside({ left: 8, top: 88, right: 661, bottom: 923 }, button, [LAPTOP_DIVISION]);
    assert.deepEqual(room, { left: 8, top: 88, right: 661, bottom: 466 });
    const height = room.bottom - room.top;
    const origin = anchoredMenuOrigin(button, { width: 300, height }, room, 'band', undefined);
    assert.ok(origin.top + height <= LAPTOP_DIVISION.y);
  });

  test('owner B1: a menu from a button below a division stays below it', () => {
    const button = { x: 880, y: 500, width: 46, height: 46 };
    const room = menuRoomBeside({ left: 8, top: 18, right: 862, bottom: 649 }, button, [ACROSS_RAIL]);
    assert.equal(room.top, 348);
    assert.equal(room.bottom, 649);
  });

  test('owner B1, book: a menu from a rail button stays on the rail side of the division', () => {
    const button = { x: 880, y: 116, width: 46, height: 46 };
    const room = menuRoomBeside({ left: 8, top: 18, right: 862, bottom: 649 }, button, [BOOK_DIVISION]);
    assert.equal(room.left, 484);
    const origin = anchoredMenuOrigin(button, { width: 360, height: 200 }, room, 'rail', 'trailing');
    assert.ok(origin.left >= BOOK_DIVISION.x + BOOK_DIVISION.width);
  });

  test('REQ-NFR-001 AC1: without divisions a menu keeps its room', () => {
    const room = { left: 8, top: 88, right: 661, bottom: 923 };
    assert.deepEqual(menuRoomBeside(room, { x: 420, y: 26, width: 44, height: 44 }, undefined), room);
  });

  test('REQ-DUO-001 AC1: stored layouts keep their divisions and fold state; malformed divisions are not taken', () => {
    const layout = {
      windowWidth: 669,
      windowHeight: 951,
      safeTop: 80,
      topBar: LAPTOP_BAND,
      divisions: [LAPTOP_DIVISION],
    };
    const key = geometryKey({ width: 669, height: 951 }, undefined);
    assert.deepEqual(sanitizeBarLayouts({ [key]: layout })[key]?.divisions, [LAPTOP_DIVISION]);
    assert.deepEqual(sanitizeBarLayouts({ [key]: { ...layout, divisions: [{ x: 'a' }] } }), {});
    // Stored before the fold state was reported: a division that does not say whether it is active.
    const { active: _active, ...withoutState } = LAPTOP_DIVISION;
    assert.deepEqual(sanitizeBarLayouts({ [key]: { ...layout, divisions: [withoutState] } }), {});
  });
});

/*
 * Device finding 2026-10-27 (Main, the Duo lying flat in inner portrait: Terminal's open "..." menu from
 * the band was cut at about y 455, the fold line). DUO-03 and owner B1 are about the half-folded poses:
 * menus keep off only an ACTIVE division. The persistent chrome (the band row, the rail's gap) keeps off
 * inactive ones too, so nothing jumps when the device folds. Geometry as above; flat, the system reports
 * the same division with `active` false.
 */
describe('menus keep off only an active division (FL-DUO-03, owner B1, device finding 2026-10-27)', () => {
  const LAPTOP_DIVISION = { x: 0, y: 466, width: 669, height: 18, active: true };
  const FLAT_PORTRAIT_LINE = { ...LAPTOP_DIVISION, active: false };
  const BOOK_DIVISION = { x: 466, y: 0, width: 18, height: 669, active: true };
  const BOOK_RAIL = { x: 880, y: 116, width: 46, height: 520 };
  const ACROSS_RAIL = { x: 0, y: 330, width: 951, height: 18, active: true };
  const PORTRAIT_ROOM = { left: 8, top: 88, right: 661, bottom: 923 };
  const BAND_BUTTON = { x: 420, y: 26, width: 44, height: 44 };

  test('flat in portrait: a menu from a band button reaches past the fold line, nothing is cut', () => {
    const room = menuRoomBeside(PORTRAIT_ROOM, BAND_BUTTON, [FLAT_PORTRAIT_LINE]);
    assert.deepEqual(room, PORTRAIT_ROOM);
    // A long menu (the Terminal's, 600 pt) stands below its button across the line.
    const origin = anchoredMenuOrigin(BAND_BUTTON, { width: 300, height: 600 }, room, 'band', undefined);
    assert.ok(origin.top + 600 > FLAT_PORTRAIT_LINE.y + FLAT_PORTRAIT_LINE.height);
  });

  test('laptop (half folded in portrait): the same menu keeps above the division, cut as before', () => {
    assert.deepEqual(menuRoomBeside(PORTRAIT_ROOM, BAND_BUTTON, [LAPTOP_DIVISION]), {
      ...PORTRAIT_ROOM,
      bottom: 466,
    });
  });

  test('book (half folded in landscape): a menu from a rail button stays on the rail side, as before', () => {
    const room = menuRoomBeside({ left: 8, top: 18, right: 862, bottom: 649 }, { ...BOOK_RAIL, height: 46 }, [
      BOOK_DIVISION,
    ]);
    assert.equal(room.left, 484);
    const flat = menuRoomBeside({ left: 8, top: 18, right: 862, bottom: 649 }, { ...BOOK_RAIL, height: 46 }, [
      { ...BOOK_DIVISION, active: false },
    ]);
    assert.equal(flat.left, 8);
  });

  test('FL-DUO-03: the chrome keeps off an inactive division too, so folding moves no button', () => {
    const inactive = { ...ACROSS_RAIL, active: false };
    assert.deepEqual(railSegments(BOOK_RAIL, null, [inactive]), railSegments(BOOK_RAIL, null, [ACROSS_RAIL]));
    const acrossBand = { x: 200, y: 0, width: 18, height: 951, active: true };
    const acrossBandFlat = { ...acrossBand, active: false };
    const band = { x: 0, y: 26, width: 466, height: 44 };
    assert.deepEqual(clearOfDivisions(band, [acrossBandFlat]), clearOfDivisions(band, [acrossBand]));
    assert.deepEqual(clearOfDivisions(band, [acrossBandFlat]), { x: 218, y: 26, width: 248, height: 44 });
  });

  test('owner S1-10: folding or lying flat moves no bar, so the layouts kept at other sizes stay', () => {
    const flat = {
      windowWidth: 669,
      windowHeight: 951,
      safeTop: 80,
      topBar: { x: 0, y: 26, width: 466, height: 44 },
      divisions: [FLAT_PORTRAIT_LINE],
    };
    const landscape = { windowWidth: 951, windowHeight: 669, edge: 'trailing' as const, sideBar: BOOK_RAIL };
    const kept = { [geometryKey({ width: 669, height: 951 }, undefined)]: flat, '951x669:trailing': landscape };
    const folded = { ...flat, divisions: [LAPTOP_DIVISION] };
    assert.deepEqual(layoutsAfterReport(kept, folded), { ...kept, '669x951:none': folded });
    // A bar that moved still drops them (a Live Activity).
    const lowered = { ...folded, topBar: { x: 0, y: 26, width: 400, height: 44 } };
    assert.deepEqual(layoutsAfterReport(kept, lowered), { '669x951:none': lowered });
  });
});
