/// <reference types="node" />
/**
 * The Unified filter menu, its button and Snooze's wake times, as the desktop builds them
 * (native_sidebar/unified/header.rs, gx-core sidebar_actions/snooze.rs).
 *
 * Run with `bun test src/contract/unified/filterMenu.test.ts` from apps/mobile/app.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { EMPTY_UNIFIED_FILTER, type UnifiedFilterOptions } from './build';
import { toggleUnifiedFilter, unifiedFilterLabel, unifiedFilterMenu } from './filterMenu';
import { snoozeWakeAt } from './snooze';

const options: UnifiedFilterOptions = {
  machines: [{ key: 'local', label: 'Local', detail: null }],
  spaces: [
    { key: 'local|work', label: 'Work', detail: null },
    { key: 'local|other', label: 'Other', detail: null },
  ],
  repos: [
    { key: 'github.com/o/ghostex', label: 'Ghostex', detail: 'Local, Windows' },
    { key: 'dir:notes', label: 'notes', detail: null },
  ],
};

describe('the filter menu (header.rs filter_menu_items)', () => {
  test('All sessions, then Spaces and Projects; a lone machine has no section', () => {
    const rows = unifiedFilterMenu(options, EMPTY_UNIFIED_FILTER);
    assert.deepEqual(
      rows.map((row) => (row.kind === 'pick' ? `${row.label}${row.checked ? ' ✓' : ''}` : row.kind === 'heading' ? `# ${row.label}` : row.kind)),
      ['all', 'separator', '# Spaces', 'Work', 'Other', 'separator', '# Projects', 'Ghostex', 'notes'],
    );
    assert.deepEqual(rows[0], { kind: 'all', checked: true });
  });

  test('a pick toggles in and out, and the button names the first pick and how many more', () => {
    let filter = toggleUnifiedFilter(EMPTY_UNIFIED_FILTER, 'repos', 'dir:notes');
    assert.equal(unifiedFilterLabel(options, filter), 'notes');
    filter = toggleUnifiedFilter(filter, 'spaces', 'local|work');
    assert.equal(unifiedFilterLabel(options, filter), 'notes +1');
    const rows = unifiedFilterMenu(options, filter);
    assert.deepEqual(rows[0], { kind: 'all', checked: false });
    filter = toggleUnifiedFilter(filter, 'repos', 'dir:notes');
    assert.deepEqual(filter.repos, []);
    assert.equal(unifiedFilterLabel(options, EMPTY_UNIFIED_FILTER), 'All sessions');
  });

  test('a section with one choice still shows once that choice is picked', () => {
    const rows = unifiedFilterMenu(options, { ...EMPTY_UNIFIED_FILTER, machines: ['local'] });
    assert.ok(rows.some((row) => row.kind === 'heading' && row.label === 'Machines'));
  });
});

describe('Snooze wake times (snooze.rs snooze_wake_ms)', () => {
  // A Wednesday afternoon, local time.
  const now = new Date(2026, 9, 28, 15, 30, 0, 0);

  test('an hour and three hours from now', () => {
    assert.equal(snoozeWakeAt('oneHour', now).getTime() - now.getTime(), 60 * 60 * 1000);
    assert.equal(snoozeWakeAt('threeHours', now).getTime() - now.getTime(), 3 * 60 * 60 * 1000);
  });

  test('tomorrow at 09:00 and next Monday at 09:00, local time', () => {
    const tomorrow = snoozeWakeAt('tomorrow', now);
    assert.deepEqual([tomorrow.getDate(), tomorrow.getHours(), tomorrow.getMinutes()], [29, 9, 0]);
    const nextWeek = snoozeWakeAt('nextWeek', now);
    assert.deepEqual([nextWeek.getDay(), nextWeek.getDate(), nextWeek.getHours()], [1, 2, 9]);
    // On a Monday it is a full week away.
    const monday = snoozeWakeAt('nextWeek', new Date(2026, 10, 2, 8, 0, 0, 0));
    assert.deepEqual([monday.getDay(), monday.getDate()], [1, 9]);
  });
});
