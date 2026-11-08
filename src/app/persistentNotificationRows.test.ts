/// <reference types="node" />
/** Run with `bun test src/app/persistentNotificationRows.test.ts` from apps/mobile/app. */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { GhostexMobileSummary, GhostexSession } from '../contract/mobileSummary';
import { notificationRowsFromSummary } from './persistentNotificationRows';

function session(sessionId: string, coordinator: string | null, isCoordinator = false): GhostexSession {
  return {
    projectId: 'p1',
    sessionId,
    displayTitle: sessionId,
    activity: 'working',
    status: 'working',
    isLive: true,
    isSleeping: false,
    isCoordinator,
    coordinatorProjectId: coordinator === null ? '' : 'p1',
    coordinatorSessionId: coordinator ?? '',
  } as unknown as GhostexSession;
}

function summary(sessions: GhostexSession[]): GhostexMobileSummary {
  return { projects: [{ projectId: 'p1', name: 'Ghostex' }], sessions } as unknown as GhostexMobileSummary;
}

describe('persistent notification rows', () => {
  test('leave out coordinator threads and keep the coordinator', () => {
    const rows = notificationRowsFromSummary(
      'm1',
      summary([session('lead', null, true), session('t1', 'lead'), session('t2', 'lead'), session('solo', null)]),
    );
    assert.deepEqual(
      rows.map((row) => row.sessionId),
      ['lead', 'solo'],
    );
    assert.equal(rows.filter((row) => row.status === 'working').length, 2);
  });

  test('a coordinator that is itself a thread is left out too', () => {
    const rows = notificationRowsFromSummary('m1', summary([session('lead', null, true), session('sub', 'lead', true)]));
    assert.deepEqual(
      rows.map((row) => row.sessionId),
      ['lead'],
    );
  });

  test('side chats are left out', () => {
    const sideChat = { ...session('side', null), sideChatParentSessionId: 'solo' } as GhostexSession;
    const rows = notificationRowsFromSummary('m1', summary([session('solo', null), sideChat]));
    assert.deepEqual(
      rows.map((row) => row.sessionId),
      ['solo'],
    );
  });
});
