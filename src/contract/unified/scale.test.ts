/// <reference types="node" />
/** The phone's own rules around the ported builder: its strip and what it saves. */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseUnifiedSaved, serializeUnifiedSaved } from './saved';
import { unifiedSwipeActions } from './strip';

describe('the swipe buttons follow the Unified strip', () => {
  test('the default keeps Snooze and Park', () => {
    assert.deepEqual(unifiedSwipeActions(undefined, true), ['snooze', 'park']);
    assert.deepEqual(unifiedSwipeActions(undefined, false), ['snooze']);
  });
  test('a saved strip decides, right of the chevron, in its order', () => {
    const strip = [
      { id: 'snooze', enabled: true },
      { id: 'chevron', enabled: true },
      { id: 'sleep', enabled: true },
      { id: 'park', enabled: true },
      { id: 'tag', enabled: true },
      { id: 'close', enabled: false },
    ];
    assert.deepEqual(unifiedSwipeActions(strip, true), ['sleep', 'park']);
  });
  test('no chevron shows every button on', () => {
    assert.deepEqual(
      unifiedSwipeActions(
        [
          { id: 'park', enabled: true },
          { id: 'snooze', enabled: false },
        ],
        true,
      ),
      ['park'],
    );
  });
});

describe('what the Unified list remembers', () => {
  test('the filter, shelves, folds and chips survive; the search does not', () => {
    const saved = {
      filter: { repos: ['a'], machines: ['m'], spaces: ['s'], query: 'typed' },
      toggledShelves: ['working', 'a|parked'],
      foldedGroups: ['b'],
      lastMachines: { a: 'm' },
    };
    const restored = parseUnifiedSaved(serializeUnifiedSaved(saved));
    assert.deepEqual(restored.filter, { repos: ['a'], machines: ['m'], spaces: ['s'], query: '' });
    assert.deepEqual(restored.toggledShelves, saved.toggledShelves);
    assert.deepEqual(restored.foldedGroups, saved.foldedGroups);
    assert.deepEqual(restored.lastMachines, saved.lastMachines);
  });
  test('nothing saved or something unreadable starts over', () => {
    assert.deepEqual(parseUnifiedSaved(null).toggledShelves, []);
    assert.deepEqual(parseUnifiedSaved('not json').foldedGroups, []);
    assert.deepEqual(parseUnifiedSaved('{"repos":[1,"a"]}').filter.repos, ['a']);
  });
});
