/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. What the attention list's actions send to the computers, through the app's real
 * wiring in `feedStore.ts` with the real stores: the closed-session list is read on a refresh only for a computer
 * whose Done or Failed sessions its session list does not hold, after the session list that refresh reads (also one
 * that answers late, or the first one), a failed read keeps the last list read (with none, no Ended row) and leaves a
 * log line, and the list goes once the computer has no candidates any more; Clear Done marks read the finished rows of
 * the Done sessions on each computer whose list is shown, and reports a failure when Done holds rows of a computer that
 * cannot be reached; Restore runs the computer's restore once however often it is asked, then takes the ended
 * session's row off this phone's list as Remove does, marks its rows read as opening does (not its failure rows) and
 * opens the new session; a failed restore stays for the sheet and goes to the log; Remove keeps a mark on this phone,
 * sends nothing and holds once the closed list no longer has the session, until the session has no unread rows. Mocked
 * are the boundaries only: the computer's gxserver over the warm link (a fake feed endpoint that records each request),
 * the computer's `ghostex` verbs for closed sessions, the link handler, the native module, expo-notifications, storage
 * and the app log.
 */

import type { ClosedSession } from '../sessions/sessionSearch';
import type { GhostexMobileSummary } from '../contract/mobileSummary';
import { fetchClosedSessions, restoreClosedSession } from '../sessions/closedSessions';
import { openDeepLink } from '../app/deepLinks';
import { logAppEvent } from '../app/appLog';
import { useInventoryStore, type MachineInventory } from '../inventory/store';
import { useMachinesStore, type MachineRecord } from '../machines/store';
import { useSettingsStore } from '../settings/store';
import { buildAttentionList, machineFeed } from './attentionRows';
import { parseFeedRow } from './feedContract';
import {
  clearDone,
  refreshAttentionFeeds,
  removeEndedRow,
  restoreEndedSession,
  useAttentionFeedStore,
} from './feedStore';

jest.mock('../../modules/ghostex-native/src', () => ({
  GhostexNative: { addListener: jest.fn(() => ({ remove: jest.fn() })) },
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-notifications', () => ({}));
jest.mock('../app/appLog', () => ({ logAppEvent: jest.fn() }));
jest.mock('../app/deepLinks', () => ({
  ...jest.requireActual('../app/deepLinks'),
  openDeepLink: jest.fn(),
}));
jest.mock('../sessions/closedSessions', () => ({
  fetchClosedSessions: jest.fn(),
  restoreClosedSession: jest.fn(),
}));

/** The computer's feed endpoint behind the warm link: its rows, and every request it got. */
const mockHost: { rows: Record<string, unknown>[]; calls: Array<[string, Record<string, unknown>]> } = {
  rows: [],
  calls: [],
};
jest.mock('../chat/rust/machine-link', () => ({
  chatMachineLink: () => ({
    route: () => Promise.resolve('socket'),
    capabilities: () => [],
    gxserverLink: () => Promise.resolve(null),
    rpc: (method: string, params: Record<string, unknown>) => {
      mockHost.calls.push([method, params]);
      if (params.action === 'markRead') {
        mockHost.rows = mockHost.rows.map((row) => (row.id === params.notificationId ? { ...row, read: true } : row));
      }
      return Promise.resolve({ result: { items: mockHost.rows }, error: null });
    },
  }),
}));

const fetchClosed = jest.mocked(fetchClosedSessions);
const restoreClosed = jest.mocked(restoreClosedSession);
const open = jest.mocked(openDeepLink);
const log = jest.mocked(logAppEvent);

const MACHINE: MachineRecord = {
  id: 'm1',
  name: 'Mac mini',
  host: 'mac-mini.local',
  username: 'me',
  port: 22,
  savePassword: false,
  lastConnectedAt: null,
};

function feedRow(id: string, sessionId: string, kind: string, read = false): Record<string, unknown> {
  return {
    id,
    projectId: 'p1',
    sessionId,
    kind,
    title: 'title',
    subtitle: 'ghostex-mobile',
    body: 'secret agent text',
    agentName: 'claude',
    createdAt: '2026-11-07T10:00:00Z',
    read,
  };
}

/** The computer's session list as the inventory store holds it: these sessions, none waiting. */
function listed(sessionIds: string[]): MachineInventory {
  // The cast holds for the fields the list reads: each session's id, activity and question fields.
  const summary = {
    agents: [],
    capabilities: { awaitingAnswer: true, attentionNotificationId: true },
    sessions: sessionIds.map((sessionId) => ({
      sessionId,
      projectId: 'p1',
      projectName: 'ghostex-mobile',
      displayTitle: 'title',
      agent: 'claude',
      agentName: 'claude',
      agentIcon: '',
      activity: 'idle',
      attentionKind: '',
      attentionEnteredAt: '',
      pendingQuestionCount: 0,
      awaitingAnswer: false,
      awaitingApproval: false,
    })),
  } as unknown as GhostexMobileSummary;
  return { summary, lastError: null, lastErrorCode: null } as unknown as MachineInventory;
}

const CLOSED: ClosedSession = {
  projectId: 'p1',
  sessionId: 'gone',
  projectTitle: 'ghostex-mobile',
  displayTitle: 'title',
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
};

/** The list as `AttentionList` builds it from the stores now. */
function inbox() {
  const { feeds, closed } = useAttentionFeedStore.getState();
  return buildAttentionList(
    [machineFeed({ id: 'm1', label: 'Mac mini' }, feeds.m1, useInventoryStore.getState().inventoriesByMachineId.m1, closed.m1 ?? [])],
    new Set(useSettingsStore.getState().settings.attentionRemovedSessions),
  );
}

/** Every step already queued, also the closed-session check that follows a refresh's session-list read. */
function queued(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setImmediate(resolve);
  return promise;
}

/** A refresh as the list makes it, with the closed-session check that follows it. */
async function refresh(): Promise<void> {
  await refreshAttentionFeeds();
  await queued();
}

const markReads = () =>
  mockHost.calls.filter(([, params]) => params.action === 'markRead').map(([, params]) => params.notificationId);

beforeEach(() => {
  mockHost.rows = [];
  mockHost.calls = [];
  fetchClosed.mockReset();
  restoreClosed.mockReset();
  open.mockReset();
  log.mockReset();
  useMachinesStore.setState({ hydrated: true, machines: [MACHINE] });
  useSettingsStore.setState((state) => ({ hydrated: true, settings: { ...state.settings, attentionRemovedSessions: [] } }));
  useInventoryStore.setState({
    inventoriesByMachineId: { m1: listed(['live']) },
    refreshMachineFresh: jest.fn(() => Promise.resolve()),
  });
  useAttentionFeedStore.setState({ feeds: {}, closed: {}, restores: {} });
});

describe('the closed-session list on a refresh', () => {
  test('read once for a computer whose Done session its session list does not hold; that session reads Ended', async () => {
    mockHost.rows = [feedRow('n1', 'gone', 'finished'), feedRow('n2', 'live', 'finished')];
    fetchClosed.mockResolvedValue([CLOSED]);
    await refresh();
    expect(fetchClosed).toHaveBeenCalledTimes(1);
    expect(fetchClosed.mock.calls[0]?.[0].id).toBe('m1');
    expect(inbox().done.map((row) => [row.id, row.label])).toEqual([
      ['gone', 'Ended'],
      ['live', 'finished · not opened'],
    ]);
  });

  test('not read while every Done session is listed', async () => {
    mockHost.rows = [feedRow('n2', 'live', 'finished')];
    await refresh();
    expect(fetchClosed).not.toHaveBeenCalled();
  });

  test('a read that fails leaves no Ended row and a log line without the error text', async () => {
    mockHost.rows = [feedRow('n1', 'gone', 'finished')];
    fetchClosed.mockRejectedValue(new Error('SYNTHETIC_PRIVATE_PAYLOAD in /Users/someone/secret'));
    await refresh();
    expect(inbox().done.map((row) => [row.id, row.label])).toEqual([['gone', 'finished · not opened']]);
    const lines = log.mock.calls.map(([line]) => line);
    expect(lines).toContain('Mac mini: closed sessions for notifications not read (unexpected)');
    expect(lines.filter((line) => line.includes('SYNTHETIC_PRIVATE_PAYLOAD') || line.includes('/Users/'))).toEqual([]);
  });

  test('an Ended row stays Ended through a failed read: the last list read is kept', async () => {
    mockHost.rows = [feedRow('n1', 'gone', 'finished')];
    fetchClosed.mockResolvedValueOnce([CLOSED]);
    await refresh();
    expect(inbox().done.map((row) => [row.id, row.label])).toEqual([['gone', 'Ended']]);
    fetchClosed.mockRejectedValueOnce(new Error('SYNTHETIC_PRIVATE_PAYLOAD'));
    await refresh();
    expect(fetchClosed).toHaveBeenCalledTimes(2);
    expect(inbox().done.map((row) => [row.id, row.label])).toEqual([['gone', 'Ended']]);
    expect(log.mock.calls.map(([line]) => line)).toContain('Mac mini: closed sessions for notifications not read (unexpected)');
  });

  test('the kept list stays while the computer cannot be reached and goes once it has no candidates any more', async () => {
    mockHost.rows = [feedRow('n1', 'gone', 'finished')];
    fetchClosed.mockResolvedValue([CLOSED]);
    await refresh();
    useInventoryStore.setState({
      inventoriesByMachineId: { m1: { ...listed(['live']), lastError: 'unreachable' } as MachineInventory },
    });
    await refresh();
    expect(fetchClosed).toHaveBeenCalledTimes(1);
    expect(useAttentionFeedStore.getState().closed.m1).toEqual([CLOSED]);
    // Reachable again, with the session's row read on the computer: no candidate is left, so the list goes.
    useInventoryStore.setState({ inventoriesByMachineId: { m1: listed(['live']) } });
    mockHost.rows = [feedRow('n1', 'gone', 'finished', true)];
    await refresh();
    expect(useAttentionFeedStore.getState().closed.m1).toBeUndefined();
  });

  test("a session the refresh's own session list no longer holds is checked once that list comes, and reads Ended", async () => {
    // The list from before the refresh still holds the session; the refresh's read, which answers late, does not.
    useInventoryStore.setState({ inventoriesByMachineId: { m1: listed(['live', 'gone']) } });
    const fresh = Promise.withResolvers<void>();
    useInventoryStore.setState({
      refreshMachineFresh: jest.fn(async () => {
        await fresh.promise;
        useInventoryStore.setState({ inventoriesByMachineId: { m1: listed(['live']) } });
      }),
    });
    mockHost.rows = [feedRow('n1', 'gone', 'finished')];
    fetchClosed.mockResolvedValue([CLOSED]);
    await refreshAttentionFeeds();
    // The refresh is done with the feed read; the closed-session check waits for the session list.
    expect(fetchClosed).not.toHaveBeenCalled();
    fresh.resolve();
    await queued();
    expect(fetchClosed).toHaveBeenCalledTimes(1);
    expect(inbox().done.map((row) => [row.id, row.label])).toEqual([['gone', 'Ended']]);
  });

  test('a computer whose session list was not read yet is checked once its first list comes', async () => {
    useInventoryStore.setState({ inventoriesByMachineId: {} });
    mockHost.rows = [feedRow('n1', 'gone', 'finished')];
    fetchClosed.mockResolvedValue([CLOSED]);
    // The feed's rows are known already (an earlier read); the session list has not answered yet.
    await refresh();
    expect(fetchClosed).not.toHaveBeenCalled();
    const first = Promise.withResolvers<void>();
    useInventoryStore.setState({
      refreshMachineFresh: jest.fn(async () => {
        await first.promise;
        useInventoryStore.setState({ inventoriesByMachineId: { m1: listed(['live']) } });
      }),
    });
    await refreshAttentionFeeds();
    first.resolve();
    await queued();
    expect(fetchClosed).toHaveBeenCalledTimes(1);
    expect(inbox().done.map((row) => [row.id, row.label])).toEqual([['gone', 'Ended']]);
  });
});

test('Clear Done sends one markRead per finished row of the Done sessions, and nothing for other rows', async () => {
  mockHost.rows = [
    feedRow('d1', 'live', 'finished'),
    feedRow('d2', 'live', 'finished'),
    feedRow('b1', 'live', 'bell'),
    feedRow('f1', 'other', 'failed'),
  ];
  await refresh();
  expect(await clearDone(inbox().done)).toBe(true);
  expect(markReads()).toEqual(['d1', 'd2']);
  expect(inbox().done).toEqual([]);
  expect(inbox().failed.map((row) => row.id)).toEqual(['other']);
});

test('Clear Done with Done rows of a computer that cannot be reached: false, and the reachable computer is still cleared', async () => {
  mockHost.rows = [feedRow('d1', 'live', 'finished')];
  await refresh();
  // A second computer whose feed cannot be read now; its last known row keeps a session under Done.
  useMachinesStore.setState({ machines: [MACHINE, { ...MACHINE, id: 'm2', name: 'Studio' }] });
  const kept = parseFeedRow(feedRow('d9', 'away', 'finished'));
  if (kept === null) throw new Error('the fixture row does not parse');
  useAttentionFeedStore.setState((state) => ({ feeds: { ...state.feeds, m2: { status: 'unreachable', rows: [kept] } } }));
  const studio = machineFeed({ id: 'm2', label: 'Studio' }, useAttentionFeedStore.getState().feeds.m2, undefined, []);
  const done = [...inbox().done, ...buildAttentionList([studio], new Set()).done];
  expect(done.map((row) => [row.machineId, row.id])).toEqual([
    ['m1', 'live'],
    ['m2', 'away'],
  ]);
  expect(await clearDone(done)).toBe(false);
  expect(markReads()).toEqual(['d1']);
  expect(inbox().done).toEqual([]);
});

describe('Restore of an ended session', () => {
  beforeEach(async () => {
    mockHost.rows = [feedRow('n1', 'gone', 'finished'), feedRow('n2', 'gone', 'needsInput')];
    fetchClosed.mockResolvedValue([CLOSED]);
    await refresh();
  });

  test("restores once however often asked, marks the session's rows read as opening does, opens the new session", async () => {
    const restored = Promise.withResolvers<{ projectId: string; sessionId: string }>();
    restoreClosed.mockReturnValue(restored.promise);
    const first = restoreEndedSession('m1', CLOSED);
    const second = restoreEndedSession('m1', CLOSED);
    expect(useAttentionFeedStore.getState().restores).toEqual({ 'm1\ngone': 'running' });
    restored.resolve({ projectId: 'p1', sessionId: 'new' });
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(restoreClosed).toHaveBeenCalledTimes(1);
    expect(restoreClosed.mock.calls[0]?.[1]).toEqual(CLOSED);
    expect(markReads()).toEqual(['n1', 'n2']);
    expect(open.mock.calls).toEqual([['ghostex://session?machineId=m1&sessionId=new']]);
    expect(useAttentionFeedStore.getState().restores).toEqual({});
    expect(inbox().done).toEqual([]);
  });

  test('a failed restore stays for the sheet, opens nothing, reads nothing and goes to the log', async () => {
    restoreClosed.mockRejectedValue(new Error('SYNTHETIC_PRIVATE_PAYLOAD'));
    expect(await restoreEndedSession('m1', CLOSED)).toBe(false);
    expect(useAttentionFeedStore.getState().restores).toEqual({ 'm1\ngone': 'failed' });
    expect(open).not.toHaveBeenCalled();
    expect(markReads()).toEqual([]);
    expect(log.mock.calls.map(([line]) => line)).toContain('Mac mini: an ended session not restored (unexpected)');
    expect(inbox().done.map((row) => row.label)).toEqual(['Ended']);
  });

  test('an ended Failed session restored: its row leaves this list as Remove takes it off; its failure rows stay unread', async () => {
    mockHost.rows = [feedRow('f1', 'gone', 'failed'), feedRow('n2', 'gone', 'needsInput')];
    await refresh();
    expect(inbox().failed.map((row) => [row.id, row.label])).toEqual([['gone', 'Ended']]);
    restoreClosed.mockResolvedValue({ projectId: 'p1', sessionId: 'new' });
    expect(await restoreEndedSession('m1', CLOSED)).toBe(true);
    expect(markReads()).toEqual(['n2']);
    expect(mockHost.rows.find((row) => row.id === 'f1')?.read).toBe(false);
    expect(useSettingsStore.getState().settings.attentionRemovedSessions).toEqual(['m1\ngone']);
    expect(inbox().failed).toEqual([]);
    // Also once the closed list no longer has the restored session.
    fetchClosed.mockResolvedValue([]);
    await refresh();
    expect(inbox().failed).toEqual([]);
  });
});

test('Remove keeps a mark on this phone, hides the Ended row and sends nothing to the computer', async () => {
  mockHost.rows = [feedRow('n1', 'gone', 'finished')];
  fetchClosed.mockResolvedValue([CLOSED]);
  await refresh();
  const before = mockHost.calls.length;
  removeEndedRow('m1', 'gone');
  expect(useSettingsStore.getState().settings.attentionRemovedSessions).toEqual(['m1\ngone']);
  expect(inbox().done).toEqual([]);
  expect(mockHost.calls.length).toBe(before);
});

test('a removed session stays off once the closed list no longer has it; its mark goes once it has no unread rows', async () => {
  const other: ClosedSession = { ...CLOSED, sessionId: 'other' };
  mockHost.rows = [feedRow('n1', 'gone', 'finished'), feedRow('n3', 'other', 'finished')];
  fetchClosed.mockResolvedValue([CLOSED, other]);
  await refresh();
  removeEndedRow('m1', 'gone');
  // The closed list's window moved on: it no longer has the removed session, which stays off all the same.
  fetchClosed.mockResolvedValue([other]);
  await refresh();
  expect(inbox().done.map((row) => [row.id, row.label])).toEqual([['other', 'Ended']]);
  // Read on the computer, the removed session has no unread rows: the next removal drops its mark.
  mockHost.rows = [feedRow('n1', 'gone', 'finished', true), feedRow('n3', 'other', 'finished')];
  await refresh();
  removeEndedRow('m1', 'other');
  expect(useSettingsStore.getState().settings.attentionRemovedSessions).toEqual(['m1\nother']);
});
