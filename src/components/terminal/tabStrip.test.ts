/**
 * Run with `bun test src/components/terminal/tabStrip.test.ts`. REQ-DUO-005 AC2 (folded: the Terminal tabs
 * stay usable in the status band) and REQ-DUO-001 AC5 (inner display). Owner decisions 2026-10-28 (Terminal
 * tabs stay in the narrow status band, the chat button stays): "es muss deutlich sein, dass man wischen
 * kann", so where the strip cannot show all tabs the next tab peeks in by at least a quarter of a tab.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MIN_TAB_WIDTH,
  TRACK_INNER_PAD,
  TAB_SPACING,
  stripFadeColor,
  stripFades,
  stripScrollOffset,
  tabStripLayout,
} from './tabStrip';

/** The strip's room for tabs: the track minus its inner padding. */
const visible = (track: number) => track - TRACK_INNER_PAD * 2;

describe('tab strip sizing', () => {
  test("a wide strip that shows every tab at the minimum width keeps today's equal-width look", () => {
    assert.deepEqual(tabStripLayout(600, 3), { equal: true });
    assert.deepEqual(tabStripLayout(0, 3), { equal: true });
  });

  test('exactly fitting: three tabs of the minimum width and their gaps need no peek and no change', () => {
    const exact = 3 * MIN_TAB_WIDTH + 2 * TAB_SPACING + TRACK_INNER_PAD * 2;
    assert.deepEqual(tabStripLayout(exact, 3), { equal: true });
    // One point short: scrolling starts, and the next tab peeks.
    const short = tabStripLayout(exact - 1, 3);
    assert.equal(short.equal, false);
  });

  test('one tab is never a strip: it fills the track, narrow or not', () => {
    assert.deepEqual(tabStripLayout(116, 1), { equal: true });
    assert.deepEqual(tabStripLayout(60, 1), { equal: true });
  });

  test('narrow strip, three tabs: the second tab is visible by at least a quarter of a tab width', () => {
    for (const track of [116, 140, 180, 220, 260, 330]) {
      const layout = tabStripLayout(track, 3);
      assert.equal(layout.equal, false, `track ${track}`);
      if (layout.equal) continue;
      const w = layout.tabWidth;
      // Tabs fully inside the visible width, then what shows of the next one.
      const whole = Math.floor((visible(track) + TAB_SPACING) / (w + TAB_SPACING));
      const peek = visible(track) - whole * (w + TAB_SPACING);
      assert.ok(whole >= 1, `track ${track}: first tab shown whole`);
      assert.ok(peek >= 0.25 * w - 0.5, `track ${track}: peek ${peek} of tab ${w}`);
    }
  });

  test('the first tab stays readable: never narrower than the readable floor', () => {
    const layout = tabStripLayout(116, 3);
    assert.equal(layout.equal, false);
    if (!layout.equal) {
      assert.ok(layout.tabWidth >= 80);
    }
  });
});

describe('edge fades', () => {
  test('only where tabs are hidden: right at the start, both in the middle, left at the end', () => {
    assert.deepEqual(stripFades(0, 400, 116), { left: false, right: true });
    assert.deepEqual(stripFades(100, 400, 116), { left: true, right: true });
    assert.deepEqual(stripFades(284, 400, 116), { left: true, right: false });
  });

  test('nothing hidden, nothing faded', () => {
    assert.deepEqual(stripFades(0, 116, 116), { left: false, right: false });
    assert.deepEqual(stripFades(0, 0, 0), { left: false, right: false });
  });
});

describe('fade colour follows the header (no hard-coded colour)', () => {
  test('a black header gives the track colour over black; a light header gives the one over white-ish', () => {
    assert.deepEqual(stripFadeColor('#000000'), 'rgb(20,20,20)');
    assert.deepEqual(stripFadeColor('#ffffff'), 'rgb(255,255,255)');
    assert.deepEqual(stripFadeColor('#f0e6d2'), 'rgb(241,232,214)');
  });

  test('short hex and rgb() headers read the same; an unreadable colour falls back to itself', () => {
    assert.deepEqual(stripFadeColor('#000'), stripFadeColor('#000000'));
    assert.deepEqual(stripFadeColor('rgb(0, 0, 0)'), stripFadeColor('#000000'));
    assert.equal(stripFadeColor('transparent'), 'transparent');
  });
});

/*
 * Owner 2026-10-28, "es muss deutlich sein, dass man wischen kann", with the agreed rule that the next tab
 * peeks in by at least a quarter of a tab: written here as the number, not imported from the code under test.
 */
describe('the active tab never hides that more tabs follow', () => {
  const QUARTER = 0.25;
  /** How much of tab `index` (0-based) shows in a viewport scrolled to `offset`, as a fraction of its width. */
  function shown(index: number, tabWidth: number, track: number, offset: number): number {
    const start = TRACK_INNER_PAD + index * (tabWidth + TAB_SPACING);
    const visibleWidth = Math.min(start + tabWidth, offset + track) - Math.max(start, offset);
    return Math.max(0, visibleWidth) / tabWidth;
  }

  for (const track of [116, 158, 200, 260]) {
    test(`three tabs in a ${track} pt strip: with any tab but the last active, the next tab shows by >= 25 %; with the last, the previous one`, () => {
      const layout = tabStripLayout(track, 3);
      assert.equal(layout.equal, false);
      if (layout.equal) return;
      const w = layout.tabWidth;
      for (const active of [0, 1, 2]) {
        const offset = stripScrollOffset(active, 3, w, track);
        const other = active < 2 ? active + 1 : active - 1;
        assert.ok(
          shown(other, w, track, offset) >= QUARTER,
          `track ${track}, active ${active}: neighbour ${other} shows ${shown(other, w, track, offset)}`,
        );
        assert.ok(shown(active, w, track, offset) >= 0.999, `track ${track}: the active tab is whole`);
      }
    });
  }

  test('the offset stays inside the content: never negative, never past its end', () => {
    const w = 83.2;
    assert.equal(stripScrollOffset(0, 3, w, 116), 0);
    const end = 2 * TRACK_INNER_PAD + 3 * w + 2 * TAB_SPACING - 116;
    assert.ok(Math.abs(stripScrollOffset(2, 3, w, 116) - end) < 1e-9);
    assert.equal(stripScrollOffset(0, 1, w, 116), 0);
  });
});
