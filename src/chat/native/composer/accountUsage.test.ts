/// <reference types="node" />
/** Run with `bun test src/chat/native/composer/accountUsage.test.ts` from apps/mobile/app. */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { currentProblem, usageColumns, usageLines } from './accountUsage';

const windows = [
  { label: '5h: 16%', name: '5h', value: '16%', percent: 16.4, reset: 'Resets 2h 36m', resetIn: '2h 36m' },
  { label: '7d: 40%', name: '7d', value: '40%', percent: 40, reset: 'Resets 5d 4h', resetIn: '5d 4h' },
  { label: 'Fable: 0%', name: 'Fable', value: '0%', percent: 0, reset: 'Reset time unavailable', resetIn: null },
  { label: 'Sonnet 7d: 120%', name: 'Sonnet', value: '120%', percent: 120, reset: 'Reset due', resetIn: 'due' },
];

describe('account usage row', () => {
  test('reads each limit as a compact column', () => {
    assert.deepEqual(usageColumns(windows.slice(0, 3)), [
      { name: '5h', value: '16%', percent: 16.4, resetIn: '2h 36m' },
      { name: '7d', value: '40%', percent: 40, resetIn: '5d 4h' },
      { name: 'Fable', value: '0%', percent: 0, resetIn: '' },
    ]);
  });

  test('clamps the bar and reads a missing list as no columns', () => {
    assert.equal(usageColumns(windows)[3]!.percent, 100);
    assert.deepEqual(usageColumns(undefined), []);
  });

  test('puts three columns on a line and pads the last line', () => {
    const lines = usageLines(usageColumns(windows));
    assert.equal(lines.length, 2);
    assert.deepEqual(
      lines.map((line) => line.map((column) => column?.name ?? null)),
      [
        ['5h', '7d', 'Fable'],
        ['Sonnet', null, null],
      ],
    );
    assert.deepEqual(usageLines([]), []);
  });

  test('reads the current account problem and its action', () => {
    assert.equal(currentProblem({ problem: null }), null);
    assert.equal(currentProblem({}), null);
    assert.deepEqual(
      currentProblem({
        problem: { message: 'The saved login expired. Reconnect this account.', action: 'Reconnect' },
      }),
      { message: 'The saved login expired. Reconnect this account.', action: 'Reconnect' },
    );
    assert.deepEqual(
      currentProblem({ problem: { message: 'Usage could not be read yet. Ghostex keeps trying.', action: null } }),
      { message: 'Usage could not be read yet. Ghostex keeps trying.' },
    );
  });
});
