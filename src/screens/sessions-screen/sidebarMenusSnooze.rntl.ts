/// <reference types="jest" />
/**
 * Snooze in the session menu: the Unified list's menu offers it as the desktop's does; the Project
 * list's menu stays as it was.
 *
 * Run with `bunx jest src/screens/sessions-screen/sidebarMenusSnooze.rntl.ts` from apps/mobile/app (the menu imports
 * React Native, which `bun test` cannot load).
 */

// The menu reaches the phone's native module through the CLI helpers; nothing here calls it.
jest.mock('../../../modules/ghostex-native/src', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

import { parseMobileSummary, type GhostexSession } from '../../contract/mobileSummary';
import { buildSessionMenu } from './sidebar-menus';

function sessionWith(overrides: object): GhostexSession {
  const parsed = parseMobileSummary(
    JSON.stringify({
      ok: true,
      projects: [{ projectId: 'P1', name: 'Ghostex', path: '/repo/ghostex' }],
      sessions: [
        {
          sessionId: 's1',
          projectId: 'P1',
          title: 's1',
          status: 'idle',
          activity: 'idle',
          isLive: true,
          provider: 'zmx',
          agent: 'claude',
          ...overrides,
        },
      ],
    }),
  );
  if (parsed === null) throw new Error('the summary did not parse');
  return parsed.sessions[0];
}

const menuOf = (session: GhostexSession, snooze?: boolean) =>
  buildSessionMenu({
    session,
    customTags: { order: [], tags: {} } as never,
    below: [],
    threads: [],
    project: null,
    snooze,
  });

describe('Snooze in the session menu', () => {
  test('the Project list menu has none', () => {
    expect(menuOf(sessionWith({})).some((item) => item.label === 'Snooze' || item.label === 'Unsnooze')).toBe(false);
  });

  test('the Unified list menu offers the four choices after Pin', () => {
    const menu = menuOf(sessionWith({}), true);
    const labels = menu.map((item) => item.label);
    const snooze = menu.find((item) => item.label === 'Snooze');
    expect(snooze?.children?.map((item) => item.label)).toEqual(['1 Hour', '3 Hours', 'Tomorrow', 'Next Week']);
    expect(labels.indexOf('Snooze')).toBeGreaterThan(labels.findIndex((label) => label === 'Pin' || label === 'Unpin'));
  });

  test('a snoozed session offers Unsnooze instead', () => {
    const menu = menuOf(sessionWith({ snoozedUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString() }), true);
    const unsnooze = menu.find((item) => item.label === 'Unsnooze');
    expect(unsnooze?.command).toEqual({ type: 'unsnooze', sessionId: 's1' });
  });
});
