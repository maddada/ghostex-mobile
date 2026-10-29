/// <reference types="node" />
/** Run with `bun test src/chat/native/cards/questionAge.test.ts` from apps/mobile/app. */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ageLabel, laterAction, removeAction, rowAge, statusLabel } from './questionAge';

const AT = 1_000_000_000_000;
const ago = (ms: number) => ageLabel(AT + ms, AT);

describe('ageLabel', () => {
  test('reads now, minutes, hours, yesterday, then days', () => {
    assert.equal(ago(0), 'now');
    assert.equal(ago(59_999), 'now');
    assert.equal(ago(60_000), '1m');
    assert.equal(ago(4 * 60_000 + 30_000), '4m');
    assert.equal(ago(59 * 60_000), '59m');
    assert.equal(ago(60 * 60_000), '1h');
    assert.equal(ago(23 * 3_600_000 + 59 * 60_000), '23h');
    assert.equal(ago(24 * 3_600_000), 'yesterday');
    assert.equal(ago(47 * 3_600_000), 'yesterday');
    assert.equal(ago(48 * 3_600_000), '2d');
    assert.equal(ago(10 * 86_400_000), '10d');
    assert.equal(ageLabel(AT - 5_000, AT), 'now');
  });

  test('a row is worded from its stamp as the clock moves, else keeps the core age', () => {
    assert.equal(rowAge({ atMs: AT, age: 'stale' }, AT + 2 * 3_600_000), '2h');
    assert.equal(rowAge({ atMs: undefined, age: '5m' }, AT), '5m');
    assert.equal(rowAge({}, AT), '');
  });
});

describe('laterAction', () => {
  test('toggles For later and Back to open by section', () => {
    assert.deepEqual(laterAction('waiting', 'form', 'f1'), {
      label: 'For later',
      glyph: 'clock',
      action: { type: 'questionForLater', id: 'f1', later: true },
    });
    assert.deepEqual(laterAction('later', 'page', 'p1'), {
      label: 'Back to open',
      glyph: 'arrow-back-up',
      action: { type: 'questionForLater', id: 'p1', later: false },
    });
  });

  test('offers nothing on answered, withdrawn, other rows or a missing status', () => {
    for (const status of ['answered', 'withdrawn', 'canceled', 'other', undefined]) {
      assert.equal(laterAction(status, 'form', 'x'), null);
    }
    assert.equal(laterAction('waiting', 'chart', 'c'), null);
  });
});

describe('removeAction and statusLabel', () => {
  test('only a For later form or page offers the X, which removes it without answering', () => {
    assert.deepEqual(removeAction('later', 'form', 'f1'), {
      label: 'Remove without answering',
      glyph: 'x',
      action: { type: 'questionRemove', id: 'f1' },
    });
    for (const status of ['waiting', 'answered', 'withdrawn', 'canceled', 'other', undefined]) {
      assert.equal(removeAction(status, 'form', 'x'), null);
    }
    assert.equal(removeAction('later', 'chart', 'c'), null);
  });

  test('a row says For later or Canceled before its age', () => {
    assert.equal(statusLabel('later'), 'For later');
    assert.equal(statusLabel('canceled'), 'Canceled');
    for (const status of ['waiting', 'answered', 'withdrawn', 'other', undefined]) {
      assert.equal(statusLabel(status), null);
    }
  });
});
