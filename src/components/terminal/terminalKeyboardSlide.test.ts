/// <reference types="node" />
/**
 * Run with `bun test src/components/terminal/terminalKeyboardSlide.test.ts`.
 *
 * The terminal keeps working as before when the keyboard goes up, on the report that the terminal jumped: the
 * terminal grid stays, the terminal view keeps its size and slides up. The slide rule (on the report that the
 * keyboard covered the question card omp draws below the cursor): always as far as the bottom row stands above the key bar, only when the cursor
 * row would vanish at the top, as far as it stays visible: offset = min(covered height, cursor row top).
 * Expectations are written out from that rule with an iPhone 17 (402x874 pt window, home indicator
 * inset 34, keyboard 336 pt tall, key bar 88 pt): the terminal view is 700 pt tall (its bottom is 34 pt
 * above the window's), 20 pt rows.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { terminalObstruction, terminalSlideOffset } from './terminalKeyboardSlide';

const VIEW = 700;
const HOME = 34;
const KEYBOARD = 336;
const KEY_BAR = 88;

describe('how much of the terminal view the keyboard and the key bar cover', () => {
  test('nothing is covered while the keyboard is hidden', () => {
    assert.equal(terminalObstruction(0, 0, HOME), 0);
  });

  test('the keyboard and the key bar cover their heights, less the home indicator inset below the view', () => {
    // 336 + 88 - 34
    assert.equal(terminalObstruction(KEYBOARD, KEY_BAR, HOME), 390);
  });

  test('with the key bar off the keyboard alone covers 336 - 34', () => {
    assert.equal(terminalObstruction(KEYBOARD, 0, HOME), 302);
  });

  test('the key bar alone (a tap on the terminal, the keyboard not there yet) covers 88 - 34', () => {
    assert.equal(terminalObstruction(0, KEY_BAR, HOME), 54);
  });

  test('a cover smaller than the inset below the view covers nothing of it, never a negative amount', () => {
    assert.equal(terminalObstruction(0, 20, HOME), 0);
  });
});

describe('how far the terminal view moves up: the bottom row above the key bar, the cursor row wins', () => {
  const covered = terminalObstruction(KEYBOARD, KEY_BAR, HOME);

  test('keyboard hidden: 0, wherever the cursor row is, or whether it is known', () => {
    const none = terminalObstruction(0, 0, HOME);
    assert.equal(terminalSlideOffset(680, VIEW, none), 0);
    assert.equal(terminalSlideOffset(100, VIEW, none), 0);
    assert.equal(terminalSlideOffset(null, VIEW, none), 0);
  });

  test('the cursor row at the bottom (top 680): the whole covered height, 390 pt', () => {
    assert.equal(terminalSlideOffset(680, VIEW, covered), 390);
  });

  test('the cursor row mid-screen (top 480, below the covered height): still 390, so what the program draws under the cursor shows', () => {
    // The visible part is then [390, 700): the bottom row (680-700) stands on the key bar.
    assert.equal(terminalSlideOffset(480, VIEW, covered), 390);
  });

  test('the cursor row top exactly at the covered height: 390', () => {
    assert.equal(terminalSlideOffset(390, VIEW, covered), 390);
  });

  test('the cursor row near the top (top 200, above the covered height): 200, the cursor row stands at the top edge', () => {
    assert.equal(terminalSlideOffset(200, VIEW, covered), 200);
  });

  test('the cursor row in the first row (top 0): 0', () => {
    assert.equal(terminalSlideOffset(0, VIEW, covered), 0);
  });

  test('a cursor row reported above the view (negative top) never moves the view down: 0', () => {
    assert.equal(terminalSlideOffset(-12, VIEW, covered), 0);
  });

  test('a cursor row reported below the view is capped at the covered height', () => {
    assert.equal(terminalSlideOffset(712, VIEW, covered), 390);
  });

  test('the key bar off, the keyboard alone: 302 pt with the cursor row low, its top with it high', () => {
    const keyboardOnly = terminalObstruction(KEYBOARD, 0, HOME);
    assert.equal(terminalSlideOffset(680, VIEW, keyboardOnly), 302);
    assert.equal(terminalSlideOffset(480, VIEW, keyboardOnly), 302);
    assert.equal(terminalSlideOffset(150, VIEW, keyboardOnly), 150);
  });

  test('no cursor row reported yet: the whole covered height, the bottom is visible', () => {
    assert.equal(terminalSlideOffset(null, VIEW, covered), 390);
  });

  test('a view that is not laid out yet (height 0) does not move', () => {
    assert.equal(terminalSlideOffset(480, 0, covered), 0);
    assert.equal(terminalSlideOffset(null, 0, covered), 0);
  });
});
