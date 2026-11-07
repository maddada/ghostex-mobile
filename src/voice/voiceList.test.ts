/// <reference types="node" />
/** Run with `bun test src/voice/voiceList.test.ts` from apps/mobile/app. */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { voiceSheetScrollY } from './voiceList';

describe('voice sheet scroll', () => {
  test('a voice near the top opens the sheet at its top', () => {
    assert.equal(voiceSheetScrollY(40, 52), 0);
    assert.equal(voiceSheetScrollY(92, 52), 0);
  });

  test('a voice far down opens with two rows above it', () => {
    // Ursa, 26th of Grok's 28 voices, under the sheet's 40pt title.
    const ursa = 40 + 25 * 52;
    assert.equal(voiceSheetScrollY(ursa, 52), ursa - 104);
  });
});
