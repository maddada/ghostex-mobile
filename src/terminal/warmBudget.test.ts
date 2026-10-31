/// <reference types="node" />
/** Run with `bun test src/terminal/warmBudget.test.ts` from apps/mobile/app. */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { WARM_SCROLLBACK_ROW_BUDGET, warmPoolOverBudget, warmTerminalsFor } from './warmBudget';

const MAX = 7;

/** Opens terminals one by one the way sessions.ts does: add, then close the oldest while over. */
function warmAfterOpening(count: number, rowsEach: number): number[] {
  const warm: number[] = [];
  for (let i = 0; i < count; i++) {
    warm.push(rowsEach);
    while (warmPoolOverBudget(warm, MAX)) warm.shift();
  }
  return warm;
}

describe('the warm terminal scrollback budget', () => {
  test('the default keeps all seven terminals warm, as before', () => {
    assert.equal(warmTerminalsFor(2_000, MAX), 7);
    assert.deepEqual(warmAfterOpening(12, 2_000), Array(7).fill(2_000));
  });

  test('up to 4,000 rows a terminal still keeps seven', () => {
    assert.equal(warmTerminalsFor(4_000, MAX), 7);
    assert.equal(warmAfterOpening(12, 4_000).length, 7);
  });

  test('bigger scrollback keeps fewer terminals warm instead of shortening it', () => {
    assert.equal(warmTerminalsFor(5_000, MAX), 5);
    assert.equal(warmTerminalsFor(10_000, MAX), 2);
    assert.equal(warmTerminalsFor(20_000, MAX), 1);
    assert.deepEqual(warmAfterOpening(12, 10_000), [10_000, 10_000]);
    assert.deepEqual(warmAfterOpening(12, 20_000), [20_000]);
  });

  test('no mix of settings ever holds more rows than the budget, except one terminal alone', () => {
    const settings = [500, 2_000, 4_000, 7_500, 12_000, 20_000];
    const warm: number[] = [];
    for (let i = 0; i < 500; i++) {
      warm.push(settings[(i * 7) % settings.length]);
      while (warmPoolOverBudget(warm, MAX)) warm.shift();
      const total = warm.reduce((sum, rows) => sum + rows, 0);
      assert.ok(warm.length <= MAX);
      assert.ok(warm.length === 1 || total <= WARM_SCROLLBACK_ROW_BUDGET, `${warm.length} terminals, ${total} rows`);
    }
  });

  test('the terminal on screen is never closed to make room', () => {
    assert.equal(warmPoolOverBudget([20_000], MAX), false);
    assert.equal(warmPoolOverBudget([], MAX), false);
  });

  test('without a row budget (iOS) only the seven-terminal cap applies', () => {
    assert.equal(warmPoolOverBudget(Array(7).fill(20_000), MAX, Number.POSITIVE_INFINITY), false);
    assert.equal(warmPoolOverBudget(Array(8).fill(20_000), MAX, Number.POSITIVE_INFINITY), true);
  });

  test('the seven-terminal cap still applies to small scrollback', () => {
    assert.equal(warmPoolOverBudget(Array(8).fill(500), MAX), true);
    assert.equal(warmPoolOverBudget(Array(7).fill(500), MAX), false);
  });
});
