/// <reference types="node" />
/**
 * Run with `bun test src/notifications/attentionRows.test.ts`. The attention list as a state inbox: the real list
 * builder, feed parser and session-list parser with fixtures of feed rows and the computer's session list. One row per
 * session, by its live state: Needs you from the session list, Done and Failed from unread feed rows, account notices
 * last; Ended only with the computer's closed-session list as proof; a removed or restored session stays off the list;
 * the bell's number counts Needs you only, marked as last known only while it holds a wait of a computer that cannot be
 * reached.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseMobileSummary, type GhostexMobileSummary } from '../contract/mobileSummary';
import type { ClosedSession } from '../sessions/sessionSearch';
import {
  buildAttentionList,
  endedCandidates,
  needsYouCount,
  readOnOpen,
  type AttentionInbox,
  type MachineFeed,
} from './attentionRows';
import { parseFeedRow, type FeedRow } from './feedContract';

/** A session as the computer's session list sends it. */
function session(sessionId: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionId,
    projectId: 'p1',
    provider: 'zmx',
    projectName: 'ghostex-mobile',
    agentName: 'claude',
    displayTitle: `Title of ${sessionId}`,
    activity: 'idle',
    ...fields,
  };
}

/** A session that waits for the user since `enteredAt`. */
function waiting(sessionId: string, enteredAt: string, fields: Record<string, unknown> = {}) {
  return session(sessionId, { activity: 'attention', attention: { kind: 'needsInput', enteredAt }, ...fields });
}

function summaryOf(sessions: Record<string, unknown>[]): GhostexMobileSummary {
  const parsed = parseMobileSummary(JSON.stringify({ capabilities: { awaitingAnswer: true }, sessions }));
  assert.ok(parsed !== null);
  return parsed;
}

/** A feed row as the computer sends it (the body is the agent's text; nothing may show it). */
function row(id: string, sessionId: string, kind: string, fields: Record<string, unknown> = {}): FeedRow {
  const parsed = parseFeedRow({
    id,
    projectId: 'p1',
    sessionId,
    kind,
    title: 'feed title',
    subtitle: 'ghostex-mobile',
    body: 'secret agent text',
    agentName: 'claude',
    createdAt: '2026-11-07T10:00:00Z',
    read: false,
    ...fields,
  });
  assert.ok(parsed !== null);
  return parsed;
}

function machine(rows: FeedRow[], summary: GhostexMobileSummary | null, fields: Partial<MachineFeed> = {}): MachineFeed {
  return { machineId: 'm1', machineLabel: 'Mac mini', rows, summary, offline: false, closed: [], ...fields };
}

function closedSession(sessionId: string, fields: Partial<ClosedSession> = {}): ClosedSession {
  return {
    projectId: 'p1',
    sessionId,
    projectTitle: 'ghostex-mobile',
    displayTitle: '',
    primaryTitle: '',
    terminalTitle: '',
    title: '',
    agentIcon: '',
    agentName: 'claude',
    sessionTag: '',
    isFavorite: false,
    closedAt: '2026-11-07T09:00:00Z',
    lastActiveAt: '2026-11-07T09:00:00Z',
    isRestorable: true,
    restoreUnavailableReason: '',
    externalSession: false,
    forkBranchCount: 0,
    ...fields,
  };
}

/** Each section's sessions (or account rows) as "id:label". */
function sections(inbox: AttentionInbox) {
  const show = (rows: AttentionInbox['needsYou']) => rows.map((entry) => `${entry.id}:${entry.label}`);
  return {
    needsYou: show(inbox.needsYou),
    done: show(inbox.done),
    failed: show(inbox.failed),
    accounts: show(inbox.accounts),
  };
}

const NONE_REMOVED: ReadonlySet<string> = new Set();

describe('Needs you', () => {
  test('two needsInput rows and a finished row of a waiting session: exactly one row, under Needs you', () => {
    const inbox = buildAttentionList(
      [
        machine(
          [
            row('n1', 's1', 'needsInput'),
            row('n2', 's1', 'needsInput', { createdAt: '2026-11-07T10:01:00Z' }),
            row('n3', 's1', 'finished'),
          ],
          summaryOf([waiting('s1', '2026-11-07T09:59:00Z')]),
        ),
      ],
      NONE_REMOVED,
    );
    assert.deepEqual(sections(inbox), { needsYou: ['s1:waiting'], done: [], failed: [], accounts: [] });
  });

  test('a needsInput row of a session that no longer waits shows nowhere', () => {
    const inbox = buildAttentionList(
      [machine([row('n1', 's2', 'needsInput')], summaryOf([session('s2', { activity: 'working' })]))],
      NONE_REMOVED,
    );
    assert.deepEqual(sections(inbox), { needsYou: [], done: [], failed: [], accounts: [] });
  });

  test('a waiting session needs no feed row; longest wait first across computers, with its kind in words', () => {
    const inbox = buildAttentionList(
      [
        machine([], summaryOf([waiting('a', '2026-11-07T09:30:00Z', { awaitingApproval: true })])),
        {
          ...machine([], summaryOf([waiting('b', '2026-11-07T09:10:00Z', { pendingQuestionCount: 1 }), session('c')])),
          machineId: 'm2',
          machineLabel: 'MacBook',
        },
      ],
      NONE_REMOVED,
    );
    assert.deepEqual(sections(inbox).needsYou, ['b:has a question', 'a:Waiting for approval']);
    // With two computers each row names its computer.
    assert.deepEqual(
      inbox.needsYou.map((entry) => entry.machineLabel),
      ['MacBook', 'Mac mini'],
    );
  });

  test('a finished turn waits for nobody', () => {
    const inbox = buildAttentionList(
      [
        machine(
          [],
          summaryOf([session('s1', { activity: 'attention', attention: { kind: 'finished', enteredAt: '' } })]),
        ),
      ],
      NONE_REMOVED,
    );
    assert.deepEqual(inbox.needsYou, []);
  });
});

describe('Done', () => {
  test('an unread finished row puts its session under Done; read (the session was opened) it does not', () => {
    const listed = summaryOf([session('s3')]);
    const unread = buildAttentionList([machine([row('n4', 's3', 'finished')], listed)], NONE_REMOVED);
    assert.deepEqual(sections(unread).done, ['s3:finished · not opened']);
    const read = buildAttentionList([machine([row('n4', 's3', 'finished', { read: true })], listed)], NONE_REMOVED);
    assert.deepEqual(sections(read), { needsYou: [], done: [], failed: [], accounts: [] });
  });

  test('newest first, one row per session with every finished row that holds it there', () => {
    const inbox = buildAttentionList(
      [
        machine(
          [
            row('f1', 'old', 'finished', { createdAt: '2026-11-07T08:00:00Z' }),
            row('f2', 'new', 'finished', { createdAt: '2026-11-07T09:00:00Z' }),
            row('f3', 'old', 'finished', { createdAt: '2026-11-07T07:00:00Z' }),
          ],
          summaryOf([session('old'), session('new')]),
        ),
      ],
      NONE_REMOVED,
    );
    assert.deepEqual(
      inbox.done.map((entry) => [entry.id, entry.stateIds]),
      [
        ['new', ['f2']],
        ['old', ['f1', 'f3']],
      ],
    );
  });
});

describe('Failed', () => {
  test('a failed or sendFailed row puts its session under Failed, before Done; a wait comes before both', () => {
    const inbox = buildAttentionList(
      [
        machine(
          [
            row('x1', 'f', 'failed'),
            row('x2', 'f', 'finished'),
            row('x3', 'n', 'sendFailed'),
            row('x4', 'w', 'failed'),
          ],
          summaryOf([session('f'), session('n'), waiting('w', '2026-11-07T09:00:00Z')]),
        ),
      ],
      NONE_REMOVED,
    );
    assert.deepEqual(sections(inbox), {
      needsYou: ['w:waiting'],
      done: [],
      failed: ['f:ended with an error', 'n:not sent'],
      accounts: [],
    });
  });

  test('opening a Failed session leaves its failure rows unread: it stays under Failed until the computer reads them', () => {
    const listed = summaryOf([session('f')]);
    const rows = [row('x1', 'f', 'failed'), row('x2', 'f', 'finished'), row('x3', 'f', 'bell')];
    const before = buildAttentionList([machine(rows, listed)], NONE_REMOVED);
    const [failedRow] = before.failed;
    assert.ok(failedRow !== undefined);
    // What an open marks read: every unread row of the session but the failure.
    assert.deepEqual(failedRow.unreadIds, ['x2', 'x3']);
    // The open went through: the computer now has those rows read; the session is still under Failed.
    const opened = rows.map((entry) => (failedRow.unreadIds.includes(entry.id) ? { ...entry, read: true } : entry));
    assert.deepEqual(sections(buildAttentionList([machine(opened, listed)], NONE_REMOVED)).failed, [
      'f:ended with an error',
    ]);
    // The computer reads the failure row (the failure dealt with): the session leaves Failed.
    const resolved = opened.map((entry) => ({ ...entry, read: true }));
    assert.deepEqual(sections(buildAttentionList([machine(resolved, listed)], NONE_REMOVED)).failed, []);
  });

  test('Mark as Done reads exactly the failure rows', () => {
    const inbox = buildAttentionList(
      [machine([row('x1', 'f', 'failed'), row('x2', 'f', 'sendFailed'), row('x3', 'f', 'finished')], summaryOf([]))],
      NONE_REMOVED,
    );
    assert.deepEqual(inbox.failed[0]?.stateIds, ['x1', 'x2']);
  });

  test('which rows an open marks read: all but failed and sendFailed', () => {
    assert.deepEqual(
      readOnOpen([
        row('a', 's', 'finished'),
        row('b', 's', 'failed'),
        row('c', 's', 'needsInput'),
        row('d', 's', 'sendFailed'),
      ]),
      ['a', 'c'],
    );
  });
});

describe('Ended', () => {
  const rows = [row('n1', 'gone', 'finished'), row('n2', 'gone-failed', 'failed')];
  const listed = summaryOf([session('other')]);

  test('a Done or Failed session the closed-session list holds reads Ended and offers Restore and Remove', () => {
    const inbox = buildAttentionList(
      [machine(rows, listed, { closed: [closedSession('gone'), closedSession('gone-failed', { isRestorable: false })] })],
      NONE_REMOVED,
    );
    assert.deepEqual(sections(inbox), { needsYou: [], done: ['gone:Ended'], failed: ['gone-failed:Ended'], accounts: [] });
    // Restore when the computer can restore it; Remove always (the sheet's actions follow these).
    assert.deepEqual(
      [...inbox.done, ...inbox.failed].map((entry) => [entry.id, entry.ended?.isRestorable]),
      [
        ['gone', true],
        ['gone-failed', false],
      ],
    );
  });

  test('only missing from the session list (a live session of an inactive project) is not Ended', () => {
    const inbox = buildAttentionList([machine(rows, listed)], NONE_REMOVED);
    assert.deepEqual(sections(inbox), {
      needsYou: [],
      done: ['gone:finished · not opened'],
      failed: ['gone-failed:ended with an error'],
      accounts: [],
    });
    assert.ok([...inbox.done, ...inbox.failed].every((entry) => entry.ended === null));
    // It is a candidate whose closed list is worth reading.
    assert.deepEqual(endedCandidates(machine(rows, listed)), ['gone', 'gone-failed']);
  });

  test('a computer that cannot be reached, or whose session list was not read, has no candidates and no Ended row', () => {
    const closed = [closedSession('gone')];
    for (const feed of [machine(rows, listed, { offline: true, closed }), machine(rows, null, { closed })]) {
      assert.deepEqual(endedCandidates(feed), []);
      assert.deepEqual(sections(buildAttentionList([feed], NONE_REMOVED)).done, ['gone:finished · not opened']);
    }
  });

  test('Remove hides the Ended row on this phone only; before the removals are loaded no Ended row shows', () => {
    const feed = machine(rows, listed, { closed: [closedSession('gone')] });
    assert.deepEqual(sections(buildAttentionList([feed], new Set(['m1\ngone']))).done, []);
    assert.deepEqual(sections(buildAttentionList([feed], null)).done, []);
    // The removal is a mark on this phone: the computer's rows are as they were.
    assert.equal(feed.rows.every((entry) => !entry.read), true);
  });

  test('a removed session stays off once the closed list no longer holds it; before the removals load, no Done or Failed row shows', () => {
    // Proven ended when the mark was made: neither a closed list that no longer has it (its window moved on, or a
    // read failed) nor a computer that cannot be reached brings it back as a plain row.
    const removed = new Set(['m1\ngone']);
    for (const feed of [machine(rows, listed), machine(rows, listed, { offline: true }), machine(rows, null)]) {
      assert.deepEqual(sections(buildAttentionList([feed], removed)), {
        needsYou: [],
        done: [],
        failed: ['gone-failed:ended with an error'],
        accounts: [],
      });
    }
    // Before the removals are loaded any Done or Failed row may be a removed one: none shows, whether the computer
    // answers, cannot be reached or its session list was not read yet. Needs you and the account rows do not depend on
    // the removals and show.
    const account = row('a1', 'account:acc1', 'resetExpiring', { accountId: 'acc1' });
    const more = [...rows, row('n3', 'other', 'finished'), account];
    const waits = summaryOf([session('other'), waiting('w', '2026-11-07T09:30:00Z')]);
    for (const feed of [machine(more, waits), machine(more, waits, { offline: true }), machine(more, null)]) {
      const inbox = sections(buildAttentionList([feed], null));
      assert.deepEqual([inbox.done, inbox.failed, inbox.accounts.length], [[], [], 1]);
      assert.equal(inbox.needsYou.length, feed.summary === null ? 0 : 1);
    }
  });
});

describe('accounts and other rows', () => {
  const account = row('a1', 'account:acc1', 'resetExpiring', {
    accountId: 'acc1',
    title: 'Reset expires in 22 hours',
    subtitle: 'Claude · Work',
    agentName: '',
  });

  test('account rows come last, read or not, newest first; bell and custom rows show nowhere', () => {
    const inbox = buildAttentionList(
      [
        machine(
          [
            account,
            row('a2', 'account:acc2', 'resetRedeemed', {
              accountId: 'acc2',
              read: true,
              createdAt: '2026-11-07T11:00:00Z',
            }),
            row('b1', 's1', 'bell'),
            row('c1', 's1', 'custom'),
          ],
          summaryOf([session('s1')]),
        ),
      ],
      NONE_REMOVED,
    );
    assert.deepEqual(sections(inbox), {
      needsYou: [],
      done: [],
      failed: [],
      accounts: ['a2:reset used', 'a1:reset expiring'],
    });
    assert.equal(inbox.accounts[1]?.who, 'Claude · Work');
  });

  test('no row carries the feed text', () => {
    const inbox = buildAttentionList(
      [machine([account, row('n1', 's1', 'finished')], summaryOf([session('s1')]))],
      NONE_REMOVED,
    );
    assert.ok(!JSON.stringify(inbox).includes('secret agent text'));
  });

  test("an offline computer's rows are its last known state, and its waits still count", () => {
    const feed = machine([row('n1', 's2', 'finished')], summaryOf([waiting('s1', '2026-11-07T09:00:00Z'), session('s2')]), {
      offline: true,
    });
    const inbox = buildAttentionList([feed], NONE_REMOVED);
    assert.deepEqual(
      [...inbox.needsYou, ...inbox.done].map((entry) => [entry.id, entry.lastKnown]),
      [
        ['s1', true],
        ['s2', true],
      ],
    );
    assert.deepEqual(needsYouCount([feed]), { count: 1, lastKnown: true });
  });
});

describe("the bell's number", () => {
  test('with sessions under Needs you, Done and Failed it is the number under Needs you', () => {
    const first = summaryOf([
      waiting('w1', '2026-11-07T09:00:00Z'),
      waiting('w2', '2026-11-07T09:05:00Z', { awaitingApproval: true }),
      session('d1'),
      session('f1'),
    ]);
    const second = summaryOf([waiting('w3', '2026-11-07T09:10:00Z', { pendingQuestionCount: 2 }), session('d2')]);
    const feeds = [
      machine([row('n1', 'd1', 'finished'), row('n2', 'f1', 'failed'), row('n3', 'w1', 'needsInput')], first),
      { ...machine([row('n4', 'd2', 'finished')], second), machineId: 'm2' },
      { ...machine([], null), machineId: 'm3' },
    ];
    const inbox = buildAttentionList(feeds, NONE_REMOVED);
    assert.equal(inbox.done.length + inbox.failed.length, 3);
    assert.equal(inbox.needsYou.length, 3);
    assert.deepEqual(needsYouCount(feeds), { count: 3, lastKnown: false });
  });

  test('marked as last known only while a wait it counts comes from a computer that cannot be reached', () => {
    const reachable = machine([], summaryOf([waiting('w1', '2026-11-07T09:00:00Z')]));
    // A computer that cannot be reached and holds no wait leaves a number of current waits only.
    const offlineIdle = { ...machine([], summaryOf([session('s2')]), { offline: true }), machineId: 'm2' };
    assert.deepEqual(needsYouCount([reachable, offlineIdle]), { count: 1, lastKnown: false });
    const offlineWaiting = {
      ...machine([], summaryOf([waiting('w2', '2026-11-07T09:05:00Z')]), { offline: true }),
      machineId: 'm2',
    };
    assert.deepEqual(needsYouCount([reachable, offlineWaiting]), { count: 2, lastKnown: true });
    // The list's Needs you rows say the same: the one from the computer that cannot be reached is a last known wait.
    assert.deepEqual(
      buildAttentionList([reachable, offlineWaiting], NONE_REMOVED).needsYou.map((entry) => [entry.id, entry.lastKnown]),
      [
        ['w1', false],
        ['w2', true],
      ],
    );
  });
});
