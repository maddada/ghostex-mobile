/// <reference types="node" />
/** Run with `bun test src/chat/native/transcript/textStrength.test.ts` from apps/mobile/app. */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { strengthenedText } from './textStrength';

describe('strengthenedText', () => {
  test('the default leaves today\'s colours exactly as they are', () => {
    assert.equal(strengthenedText('#b4b8c0', 0, false), '#b4b8c0');
    assert.equal(strengthenedText('#4d4d50', 0, true), '#4d4d50');
  });

  test('full is exactly white in dark mode and black in light mode', () => {
    assert.equal(strengthenedText('#b4b8c0', 100, false), '#ffffff');
    assert.equal(strengthenedText('#4d4d50', 100, true), '#000000');
  });

  test('a step between moves toward the ink', () => {
    assert.equal(strengthenedText('#808080', 50, false), '#c0c0c0');
    assert.equal(strengthenedText('#808080', 50, true), '#404040');
  });
});
