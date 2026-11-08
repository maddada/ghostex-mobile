/// <reference types="node" />
/** Run with `bun test src/app/persistentNotificationRows.test.ts` from apps/mobile/app. */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseMobileSummary, type GhostexMobileSummary, type GhostexSession } from '../contract/mobileSummary';
import { buildAttentionList, type MachineFeed } from '../notifications/attentionRows';
import { parseFeedRow, type FeedRow } from '../notifications/feedContract';
import { notificationRows, notificationRowsFromSummary } from './persistentNotificationRows';

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

/**
 * The notification states and orders its rows by the bell's inbox (ghostex-mobile#29), with the real list builder:
 * Needs you (longest wait first), then Done, then Failed, then working, then the rest; a finish the bell no longer
 * holds reads idle, so the two clear together.
 */
describe('persistent notification rows follow the bell', () => {
  function wire(sessionId: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      sessionId,
      projectId: 'p1',
      provider: 'zmx',
      agentName: 'claude',
      displayTitle: sessionId,
      activity: 'idle',
      status: 'running',
      isLive: true,
      ...fields,
    };
  }
  const waiting = (sessionId: string, enteredAt: string) =>
    wire(sessionId, { activity: 'attention', attention: { kind: 'needsInput', enteredAt } });
  const finished = (sessionId: string) =>
    wire(sessionId, { activity: 'attention', attention: { kind: 'finished', enteredAt: '2026-11-07T09:00:00Z' } });
  function summaryOf(sessions: Record<string, unknown>[]): GhostexMobileSummary {
    const parsed = parseMobileSummary(
      JSON.stringify({ capabilities: { awaitingAnswer: true }, projects: [{ projectId: 'p1', name: 'Ghostex' }], sessions }),
    );
    assert.ok(parsed !== null);
    return parsed;
  }
  function row(id: string, sessionId: string, kind: string, createdAt: string, read = false): FeedRow {
    const parsed = parseFeedRow({
      id,
      projectId: 'p1',
      sessionId,
      kind,
      title: 't',
      subtitle: 'Ghostex',
      body: '',
      agentName: 'claude',
      createdAt,
      read,
    });
    assert.ok(parsed !== null);
    return parsed;
  }
  function rowsFor(summary: GhostexMobileSummary, feedRows: FeedRow[]) {
    const feed: MachineFeed = { machineId: 'm1', machineLabel: 'Mac', rows: feedRows, summary, offline: false, closed: [] };
    return notificationRows([{ machineId: 'm1', summary }], buildAttentionList([feed], new Set()));
  }

  const summary = summaryOf([
    wire('busy', { activity: 'working', status: 'working' }),
    waiting('newWait', '2026-11-07T10:00:00Z'),
    finished('doneUnread'),
    wire('plain'),
    wire('broke'),
    waiting('oldWait', '2026-11-07T08:00:00Z'),
    finished('doneOpened'),
  ]);

  test('Needs you longest wait first, then Done, then Failed, then working, then the rest', () => {
    const rows = rowsFor(summary, [
      row('f1', 'doneUnread', 'finished', '2026-11-07T09:00:00Z'),
      row('f2', 'doneOpened', 'finished', '2026-11-07T09:00:00Z', true),
      row('x1', 'broke', 'failed', '2026-11-07T09:30:00Z'),
    ]);
    assert.deepEqual(
      rows.map((entry) => `${entry.sessionId}:${entry.status}`),
      [
        'oldWait:attention',
        'newWait:attention',
        'doneUnread:done',
        'broke:failed',
        'busy:working',
        'plain:idle',
        'doneOpened:idle',
      ],
    );
  });

  test('a Done session leaves with the bell: once its finished row is read it reads idle', () => {
    const rows = rowsFor(summary, [row('f1', 'doneUnread', 'finished', '2026-11-07T09:00:00Z', true)]);
    const done = rows.find((entry) => entry.sessionId === 'doneUnread');
    assert.equal(done?.status, 'idle');
    // Only the waits stay attention, as the bell's number counts them.
    assert.equal(rows.filter((entry) => entry.status === 'attention').length, 2);
    assert.equal(rows.filter((entry) => entry.status === 'done').length, 0);
  });

  test('a waiting coordinator thread stays out, as the notification has always left threads out', () => {
    const parsed = summaryOf([waiting('thread', '2026-11-07T08:00:00Z'), wire('lead')]);
    const thread = parsed.sessions.find((entry) => entry.sessionId === 'thread');
    assert.ok(thread !== undefined);
    Object.assign(thread, { coordinatorProjectId: 'p1', coordinatorSessionId: 'lead' });
    assert.deepEqual(
      rowsFor(parsed, []).map((entry) => entry.sessionId),
      ['lead'],
    );
  });
});

