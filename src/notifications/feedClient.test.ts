/// <reference types="node" />
/**
 * Run with `bun test src/notifications/feedClient.test.ts`. The attention list and "has a question": the real parser,
 * list builder and feed client with a fake HTTP transport. The read state is the computer's: opening a row, Clear Done
 * and Mark as Done each send one `markRead` per feed row they read, and nothing else. A failed request carries a fixed
 * category, never the computer's error text (the app log can be exported).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseMobileSummary, type GhostexMobileSummary } from '../contract/mobileSummary';
import { buildAttentionList, type MachineFeed } from './attentionRows';
import { FeedRequestError, markRowsRead, readFeed, updateFeed, type FeedRpc } from './feedClient';
import { parseFeedState } from './feedContract';

const ACCOUNT_ROW = {
  id: 'n9',
  projectId: 'accounts',
  sessionId: 'account:acc1',
  kind: 'resetExpiring',
  title: 'Usage reset expires',
  subtitle: 'Account acc1',
  body: 'Reset expires in 24 hours',
  createdAt: '2026-10-24T10:00:00Z',
  read: false,
  accountId: 'acc1',
};

const NEEDS_INPUT = {
  id: 'n1',
  projectId: 'p1',
  sessionId: 's1',
  kind: 'needsInput',
  title: 'fix build',
  subtitle: 'ghostex-mobile',
  body: 'secret text',
  agentName: 'claude',
  createdAt: '2026-10-24T11:00:00Z',
  read: false,
};

/** The computer's session list: `s1` and the given sessions, as the phone parses it. */
function summary(sessions: Record<string, unknown>[] = [], capabilities?: object): GhostexMobileSummary {
  const parsed = parseMobileSummary(
    JSON.stringify({
      ...(capabilities === undefined ? {} : { capabilities }),
      sessions: sessions.map((session) => ({
        projectId: 'p1',
        provider: 'zmx',
        projectName: 'ghostex-mobile',
        agentName: 'Claude Code',
        displayTitle: 'fix build',
        ...session,
      })),
    }),
  );
  assert.ok(parsed !== null);
  return parsed;
}

function feedOf(items: unknown[], list: GhostexMobileSummary | null): MachineFeed {
  const state = parseFeedState({ items });
  assert.ok(state !== null);
  return { machineId: 'm1', machineLabel: 'Mac', rows: state.rows, summary: list, offline: false, closed: [] };
}

/**
 * gxserver's feed endpoint: it records each request and answers with the whole feed after it, the row a `markRead`
 * names now read.
 */
function fakeHost(items: Record<string, unknown>[]) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  let rows = items.map((item) => ({ ...item }));
  const rpc: FeedRpc = async (method, params) => {
    calls.push([method, params]);
    if (params.action === 'markRead') {
      rows = rows.map((item) => (item.id === params.notificationId ? { ...item, read: true } : item));
    }
    return { result: { items: rows }, error: null };
  };
  return { rpc, calls, rows: () => rows };
}

const markReadOf = (ids: readonly string[]) =>
  ids.map((notificationId) => ['updateNotificationFeed', { action: 'markRead', notificationId }]);

describe('the attention list', () => {
  test('the parser keeps an account row', () => {
    const snapshot = parseFeedState({ items: [ACCOUNT_ROW], unreadCount: 1 });
    assert.equal(snapshot?.rows.length, 1);
    assert.equal(snapshot?.rows[0].accountId, 'acc1');
  });

  test('an account row in the feed appears among the account notices', () => {
    const inbox = buildAttentionList([feedOf([NEEDS_INPUT, ACCOUNT_ROW], summary())], new Set());
    assert.deepEqual(
      inbox.accounts.map((row) => [row.id, row.account, row.who]),
      [['n9', true, 'Account acc1']],
    );
  });

  test('no row carries the feed text (data side)', () => {
    const snapshot = parseFeedState({ items: [NEEDS_INPUT] });
    assert.ok(snapshot !== null);
    assert.ok(!JSON.stringify(snapshot).includes('secret text'));
    const inbox = buildAttentionList(
      [feedOf([NEEDS_INPUT], summary([{ sessionId: 's1', activity: 'attention' }]))],
      new Set(),
    );
    assert.equal(inbox.needsYou.length, 1);
    assert.ok(!JSON.stringify(inbox).includes('secret text'));
  });

  test('a row of an unknown kind is skipped', () => {
    assert.equal(parseFeedState({ items: [{ ...NEEDS_INPUT, kind: 'mystery' }] })?.rows.length, 0);
  });

  // The desktop's bell (`apps/desktop/src/notification_feed/mod.rs`, `GpuiNotificationFeedKind::SendFailed`): a chat
  // message the computer could not send is a session row labelled "Not sent", read state as the computer keeps it.
  const NOT_SENT = { ...NEEDS_INPUT, id: 'n2', kind: 'sendFailed', body: 'Message not sent. secret reason' };

  test('an unread sendFailed row puts its session under Failed as "not sent", without the feed text', () => {
    const inbox = buildAttentionList([feedOf([NOT_SENT], summary([{ sessionId: 's1' }]))], new Set());
    assert.deepEqual(
      inbox.failed.map((row) => [row.id, row.kind, row.label, row.who, row.detail, row.stateIds]),
      [['s1', 'sendFailed', 'not sent', 'Claude Code · ghostex-mobile', 'fix build', ['n2']]],
    );
    assert.ok(!JSON.stringify(inbox).includes('secret'));
    // Read (the send went through, the computer read it) it leaves.
    const read = buildAttentionList([feedOf([{ ...NOT_SENT, read: true }], summary([{ sessionId: 's1' }]))], new Set());
    assert.deepEqual(read.failed, []);
  });

  test("an unread sendFailed row keeps its session under Failed beside the session's newer finished row", () => {
    // The computer keeps an unread Not sent row when the session's next row comes (`insert_notification_feed_row`).
    const inbox = buildAttentionList(
      [feedOf([{ ...NEEDS_INPUT, kind: 'finished', createdAt: '2026-10-24T11:05:00Z' }, NOT_SENT], summary([{ sessionId: 's1' }]))],
      new Set(),
    );
    assert.deepEqual(
      [inbox.failed.map((row) => row.label), inbox.done.length],
      [['not sent'], 0],
    );
  });

  test('opening a row sends one markRead per unread row of its session, not its failure rows', async () => {
    const items = [
      { ...NEEDS_INPUT, id: 'r1', kind: 'finished', createdAt: '2026-10-24T11:03:00Z' },
      { ...NEEDS_INPUT, id: 'r2', kind: 'needsInput', createdAt: '2026-10-24T11:02:00Z' },
      { ...NEEDS_INPUT, id: 'r3', kind: 'bell', createdAt: '2026-10-24T11:01:00Z' },
      { ...NOT_SENT, id: 'r4' },
      { ...NEEDS_INPUT, id: 'r5', kind: 'failed', createdAt: '2026-10-24T10:59:00Z' },
      { ...NEEDS_INPUT, id: 'r6', kind: 'finished', read: true },
      { ...NEEDS_INPUT, id: 'o1', sessionId: 's2', kind: 'finished' },
    ];
    const list = summary([{ sessionId: 's1', activity: 'attention' }, { sessionId: 's2' }]);
    const [row] = buildAttentionList([feedOf(items, list)], new Set()).needsYou;
    assert.ok(row !== undefined);
    const host = fakeHost(items);
    await markRowsRead(host.rpc, row.unreadIds);
    assert.deepEqual(host.calls, markReadOf(['r1', 'r2', 'r3']));
  });

  test('a Failed session opened and come back to is still under Failed; when the computer reads it, it leaves', async () => {
    const items = [
      { ...NEEDS_INPUT, id: 'f1', kind: 'failed' },
      { ...NEEDS_INPUT, id: 'f2', kind: 'finished', createdAt: '2026-10-24T10:59:00Z' },
    ];
    const list = summary([{ sessionId: 's1' }]);
    const [failed] = buildAttentionList([feedOf(items, list)], new Set()).failed;
    assert.ok(failed !== undefined);
    const host = fakeHost(items);
    await markRowsRead(host.rpc, failed.unreadIds);
    assert.deepEqual(host.calls, markReadOf(['f2']));
    assert.deepEqual(
      buildAttentionList([feedOf(host.rows(), list)], new Set()).failed.map((row) => row.id),
      ['s1'],
    );
    // The computer resolves the failure: it reads its row.
    const resolved = host.rows().map((item) => ({ ...item, read: true }));
    assert.deepEqual(buildAttentionList([feedOf(resolved, list)], new Set()).failed, []);
  });

  test('Clear Done sends one markRead per finished row of the Done sessions and touches no other row', async () => {
    const items = [
      { ...NEEDS_INPUT, id: 'd1', sessionId: 'a', kind: 'finished' },
      { ...NEEDS_INPUT, id: 'd2', sessionId: 'a', kind: 'finished', createdAt: '2026-10-24T10:00:00Z' },
      { ...NEEDS_INPUT, id: 'd3', sessionId: 'b', kind: 'finished' },
      { ...NEEDS_INPUT, id: 'x1', sessionId: 'b', kind: 'bell' },
      { ...NEEDS_INPUT, id: 'e1', sessionId: 'c', kind: 'failed' },
      { ...NEEDS_INPUT, id: 'e2', sessionId: 'c', kind: 'finished' },
      { ...NEEDS_INPUT, id: 'w1', sessionId: 'w', kind: 'needsInput' },
      { ...NEEDS_INPUT, id: 'w2', sessionId: 'w', kind: 'finished' },
      ACCOUNT_ROW,
    ];
    const list = summary([{ sessionId: 'a' }, { sessionId: 'b' }, { sessionId: 'c' }, { sessionId: 'w', activity: 'attention' }]);
    const inbox = buildAttentionList([feedOf(items, list)], new Set());
    assert.deepEqual(
      inbox.done.map((row) => row.id),
      ['a', 'b'],
    );
    const host = fakeHost(items);
    await markRowsRead(
      host.rpc,
      inbox.done.flatMap((row) => row.stateIds),
    );
    assert.deepEqual(host.calls, markReadOf(['d1', 'd2', 'd3']));
    const after = buildAttentionList([feedOf(host.rows(), list)], new Set());
    assert.deepEqual(
      [after.done.length, after.failed.map((row) => row.id), after.needsYou.map((row) => row.id), after.accounts.length],
      [0, ['c'], ['w'], 1],
    );
  });

  test('Mark as Done on a Failed row sends markRead for its failure rows, and it leaves Failed', async () => {
    const items = [
      { ...NEEDS_INPUT, id: 'f1', kind: 'failed' },
      { ...NOT_SENT, id: 'f2', createdAt: '2026-10-24T10:30:00Z' },
      { ...NEEDS_INPUT, id: 'f3', kind: 'bell' },
    ];
    const list = summary([{ sessionId: 's1' }]);
    const [failed] = buildAttentionList([feedOf(items, list)], new Set()).failed;
    assert.ok(failed !== undefined);
    const host = fakeHost(items);
    await markRowsRead(host.rpc, failed.stateIds);
    assert.deepEqual(host.calls, markReadOf(['f1', 'f2']));
    assert.deepEqual(buildAttentionList([feedOf(host.rows(), list)], new Set()).failed, []);
  });

  test('reading the feed: an error answer throws', async () => {
    const rpc: FeedRpc = async () => ({ error: { message: 'nope' } });
    await assert.rejects(readFeed(rpc));
  });

  test('the error of a refused request is "refused", without the computer\'s text or paths', async () => {
    const rpc: FeedRpc = async () => ({
      error: { message: 'SYNTHETIC_PRIVATE_PAYLOAD in /Users/someone/private/projects/secret.db' },
    });
    const error: unknown = await updateFeed(rpc, { action: 'dismiss', notificationId: 'n1' }).then(
      () => null,
      (thrown: unknown) => thrown,
    );
    assert.ok(error instanceof FeedRequestError);
    assert.equal(error.category, 'refused');
    assert.ok(!String(error).includes('SYNTHETIC_PRIVATE_PAYLOAD'));
    assert.ok(!String(error).includes('/Users/'));
  });
});

describe('"has a question" in the list', () => {
  /** The label of the waiting session `s1` with its needsInput row, from the computer's session list. */
  const labelFrom = (capabilities: object | undefined, questions: object) => {
    const list = summary([{ sessionId: 's1', activity: 'attention', ...questions }], capabilities);
    const [row] = buildAttentionList([feedOf([NEEDS_INPUT], list)], new Set()).needsYou;
    return row?.label;
  };

  test('a session with pendingQuestionCount 2 says "has a question"', () => {
    assert.equal(labelFrom(undefined, { pendingQuestionCount: 2 }), 'has a question');
  });

  test('with pendingQuestionCount 0 it says "waiting"', () => {
    assert.equal(labelFrom(undefined, { pendingQuestionCount: 0 }), 'waiting');
  });

  test('an open question card says "has a question" only when the summary announces the field', () => {
    assert.equal(labelFrom({ awaitingAnswer: true }, { awaitingAnswer: true }), 'has a question');
    assert.equal(labelFrom({ sessionGitStatus: true }, { awaitingAnswer: true }), 'waiting');
    assert.equal(labelFrom(undefined, { awaitingAnswer: true }), 'waiting');
  });

  test('a counted pending question alone says "has a question", with or without the question-card field', () => {
    assert.equal(
      labelFrom({ awaitingAnswer: true }, { awaitingAnswer: false, pendingQuestionCount: 1 }),
      'has a question',
    );
    assert.equal(labelFrom(undefined, { pendingQuestionCount: 1 }), 'has a question');
  });

  test('neither a question card nor a counted question: "waiting"', () => {
    assert.equal(labelFrom({ awaitingAnswer: true }, { awaitingAnswer: false }), 'waiting');
    assert.equal(labelFrom(undefined, {}), 'waiting');
  });
});
