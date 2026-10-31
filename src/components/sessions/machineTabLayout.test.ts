/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  MACHINE_TAB_MIN_WIDTH,
  machineTabLayout,
  machineTabRevealOffset,
  machineTabsOutOfView,
} from './machineTabLayout';

/** A phone's width less the "+" tab. */
const PHONE = 390 - 40;
const SMALL = 320 - 40;

describe('how the machine tabs share the row', () => {
  test('one and two machines never change, at any width', () => {
    for (const width of [120, SMALL, PHONE, 900]) {
      assert.deepEqual(machineTabLayout(1, width), { kind: 'fit' });
      assert.deepEqual(machineTabLayout(2, width), { kind: 'fit' });
    }
  });
  test('tabs share the row while each is readable', () => {
    assert.deepEqual(machineTabLayout(3, PHONE), { kind: 'fit' });
    assert.deepEqual(machineTabLayout(8, 900), { kind: 'fit' });
  });
  test('4 and 8 machines keep readable tabs, part of the next one showing', () => {
    for (const count of [4, 8]) {
      for (const width of [SMALL, PHONE]) {
        const layout = machineTabLayout(count, width);
        assert.equal(layout.kind, 'scroll');
        if (layout.kind !== 'scroll') continue;
        assert.ok(layout.tabWidth >= MACHINE_TAB_MIN_WIDTH);
        const fraction = width / layout.tabWidth - Math.floor(width / layout.tabWidth);
        assert.ok(fraction >= 0.25 - 0.001, `${width}: ${fraction}`);
      }
    }
  });
});

describe('finding a tab', () => {
  test('picking one reveals it and its neighbour, and moves no more than it must', () => {
    assert.equal(machineTabRevealOffset(0, 8, 100, 280, 0), 0);
    assert.equal(machineTabRevealOffset(1, 8, 100, 280, 0), 0);
    assert.ok(Math.abs(machineTabRevealOffset(2, 8, 100, 280, 0) - 60) < 0.001);
    assert.equal(machineTabRevealOffset(7, 8, 100, 280, 0), 520);
    assert.equal(machineTabRevealOffset(0, 8, 100, 280, 300), 0);
  });
  test('pressing the peeking tab again and again reaches every machine', () => {
    const layout = machineTabLayout(8, SMALL);
    assert.equal(layout.kind, 'scroll');
    if (layout.kind !== 'scroll') return;
    let offset = 0;
    for (let index = 0; index < 8; index += 1) {
      offset = machineTabRevealOffset(index, 8, layout.tabWidth, SMALL, offset);
      assert.ok(index * layout.tabWidth >= offset - 0.001);
      assert.ok((index + 1) * layout.tabWidth <= offset + SMALL + 0.001);
      if (index < 7) assert.ok((index + 1) * layout.tabWidth < offset + SMALL);
    }
  });
  test('tabs out of view are the ones whose middle is off the row', () => {
    assert.deepEqual(machineTabsOutOfView(6, 100, 240, 0), [0, 2]);
    assert.deepEqual(machineTabsOutOfView(6, 100, 240, 120), [1, 4]);
    assert.deepEqual(machineTabsOutOfView(6, 100, 240, 360), [4, 6]);
  });
});
