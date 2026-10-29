/// <reference types="node" />
/**
 * Run with `bun test src/components/common/keyboard/keyboardTop.test.ts`.
 *
 * REQ-DUO-002 AC2 removes the screen-wide size from the keyboard store (keyboardFrame.ts); these tests
 * pin what replaces it: the keyboard frame is judged against the window the app is shown in.
 * Sizes are the iPhone Duo's (requirements: 669x951 pt inner, 466x678 pt outer; keyboard panel from
 * y 428 pt unfolded in landscape, measured on the owner's device) and an iPhone 17 (402x874 pt).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { keyboardFrameOf, keyboardFrameTop, keyboardHeightForWindow, keyboardTopInWindow } from './keyboardTop';

describe('keyboard top in the window (REQ-DUO-002 AC2)', () => {
  test('a keyboard over the unfolded Duo in landscape reaches into its 669 pt tall window', () => {
    assert.equal(keyboardTopInWindow(keyboardFrameTop(428, 234), 669), 428);
  });

  test('a keyboard frame at the window bottom covers nothing (sliding off)', () => {
    assert.equal(keyboardTopInWindow(keyboardFrameTop(669, 234), 669), null);
  });

  test('a frame without height is no keyboard', () => {
    assert.equal(keyboardFrameTop(428, 0), null);
    assert.equal(keyboardTopInWindow(null, 669), null);
  });

  test('the window decides, not a larger screen: below the folded 678 pt window is nothing', () => {
    // Inside the 951 pt inner screen, yet below the outer display's window the app is shown in.
    assert.equal(keyboardTopInWindow(keyboardFrameTop(700, 251), 678), null);
  });

  test('a regular iPhone keeps its keyboard top as before', () => {
    assert.equal(keyboardTopInWindow(keyboardFrameTop(538, 336), 874), 538);
  });
});

/*
 * Owner A1 (2026-10-27, §1.5 S1-4) with review s1-floor-r2 #7: the rail reserves the keyboard height
 * learned for a window size, so it learns only from a keyboard frame reported for that window. The
 * reviewer's sequence: folded and turned (678x466) with a 200 pt keyboard, turned back to 466x678, where
 * the window reports first and the keyboard's 265 pt frame after.
 */
describe('the keyboard height a window learns (REQ-DUO-005 AC2, owner A1)', () => {
  test('REQ-DUO-005 AC2: a keyboard docked at the window bottom, as wide as the window, teaches its height', () => {
    assert.equal(keyboardHeightForWindow(keyboardFrameOf(413, 265, 466), { width: 466, height: 678 }), 265);
    assert.equal(keyboardHeightForWindow(keyboardFrameOf(266, 200, 678), { width: 678, height: 466 }), 200);
  });

  test('owner A1: the frame left from before a turn teaches the new window nothing', () => {
    assert.equal(keyboardHeightForWindow(keyboardFrameOf(266, 200, 678), { width: 466, height: 678 }), null);
  });

  test('owner A1: a frame from the folded window teaches the unfolded one nothing', () => {
    assert.equal(keyboardHeightForWindow(keyboardFrameOf(413, 265, 466), { width: 951, height: 669 }), null);
  });

  test('REQ-DUO-005 AC2: no keyboard teaches nothing', () => {
    assert.equal(keyboardFrameOf(678, 0, 466), null);
    assert.equal(keyboardHeightForWindow(null, { width: 466, height: 678 }), null);
  });
});
