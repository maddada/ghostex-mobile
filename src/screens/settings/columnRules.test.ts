/**
 * Settings in two columns (REQ-DUO-001 AC5: Settings on the unfolded Duo in landscape; owner decision F2,
 * 2026-10-26, "Zweispaltig wie iPad-Einstellungen"): the list's selection and the right column's Back
 * follow the stack, so turning the phone keeps the user's place.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { DEFAULT_SETTINGS_PAGE, isSettingsRoute, settingsColumnsFor, type ColumnRoute } from './columnRules';

const SESSIONS: ColumnRoute = { name: 'Sessions' };
const SETTINGS: ColumnRoute = { name: 'Settings' };

describe('Settings in two columns (REQ-DUO-001 AC5, owner decision F2)', () => {
  test('REQ-DUO-001 AC5: Settings alone selects Theme, the first page', () => {
    assert.equal(DEFAULT_SETTINGS_PAGE, 'theme');
    assert.deepEqual(settingsColumnsFor([SESSIONS, SETTINGS], 1), {
      settingsIndex: 1,
      selected: 'theme',
      subPage: false,
    });
  });

  test('owner F2: a page open in portrait is the selected page in landscape', () => {
    const routes = [SESSIONS, SETTINGS, { name: 'SettingsPage', page: 'chat' as const }];
    assert.deepEqual(settingsColumnsFor(routes, 2), { settingsIndex: 1, selected: 'chat', subPage: false });
  });

  test("owner F2: Keyboard's editors open in the right column with their own Back, Keyboard selected", () => {
    const routes = [
      SESSIONS,
      SETTINGS,
      { name: 'SettingsPage', page: 'keyboard' as const },
      { name: 'ExtraKeysEditor' },
    ];
    assert.deepEqual(settingsColumnsFor(routes, 3), { settingsIndex: 1, selected: 'keyboard', subPage: true });
  });

  test('owner F2: a page opened from a page keeps the first one selected', () => {
    const routes = [
      SESSIONS,
      SETTINGS,
      { name: 'SettingsPage', page: 'chat' as const },
      { name: 'SettingsPage', page: 'readAloudVoice' as const },
    ];
    assert.deepEqual(settingsColumnsFor(routes, 3), { settingsIndex: 1, selected: 'chat', subPage: true });
  });

  test('REQ-DUO-001 AC5: no columns without the Settings list under the page, or outside Settings', () => {
    assert.equal(settingsColumnsFor([SESSIONS, { name: 'SettingsPage', page: 'theme' }], 1), null);
    assert.equal(settingsColumnsFor([SESSIONS, SETTINGS, { name: 'Terminal' }], 2), null);
    assert.equal(settingsColumnsFor([SESSIONS], 0), null);
  });

  test('owner F2: only the Settings routes change without a stack animation', () => {
    assert.ok(['Settings', 'SettingsPage', 'ExtraKeysEditor', 'AgentHotkeysEditor'].every(isSettingsRoute));
    assert.ok(!isSettingsRoute('Sessions') && !isSettingsRoute('Terminal'));
  });
});
