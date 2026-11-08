/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. The app's real notification wiring (`initAttentionNotifications` in
 * `feedStore.ts`) as the app starts it, with the real stores, event source, mapper, rate limiter and
 * notification centre adapter; mocked are the boundaries only: React Native's AppState (driven here),
 * expo-notifications (the scheduled requests are what the phone would show), the native module, storage,
 * the app log, the computer's gxserver reached over the warm link (a fake feed endpoint and forward) and the
 * WebSocket of the live channel.
 *
 * - First-fetch rule: iOS returns from the background through
 *   `inactive`; rows written while the app was away are no news, at the return and at any read before it.
 * - "Has a question": the list's join to the session list is read for new rows whatever the switches,
 *   and on an explicit refresh for waiting rows that stay as they are, not on every poll.
 * - A row that arrives while an older session-list read is under way is mapped with
 *   a newer read, not dropped.
 * - A question link at a cold start waits for the stores that decide or overwrite
 *   the session's view (`deepLinkStoresReady`), so the loading of saved terminal views cannot overturn it.
 * - The app log (exportable) gets a fixed failure word, never the text a
 *   computer, the inventory or iOS put in an error (here a synthetic private payload and a path).
 * - One sound per event: the Sessions list's attention sound (`src/app/alerts.ts`) and the notification of
 *   the feed row the computer names for the attention sound once, whatever the delay, seen on screen alike;
 *   a copy naming a row covers no other row. From a computer that names no row the sound and the row's
 *   notification are separate announcements: the row brings its own sound, and within 20 s of the sound the
 *   one-per-session limit holds its notification back (it stays in the attention list); two events each
 *   sound, however close together.
 * - The Sessions list's attention sound and the notifications share one rate limit, which counts every
 *   sound and notification (a notification within 20 s after the sound of the event that named its row is
 *   part of it; the sound after a notification that came without it takes its own place): a sound it holds
 *   back is no announcement, so the event's later copy announces it once, with its sound; eight sounds,
 *   eight other notifications and the first notifications of the eight sounded events make eight
 *   notifications in a minute, not sixteen.
 * - The record of announced events is kept in storage across a
 *   launch, ids only, so a copy of an event announced before a restart neither notifies nor sounds after it.
 * - The session open on screen (its terminal or Chat View on the focused Terminal screen, the app
 *   active; `sessionOnScreen` in `src/terminal/zmxDisplay.ts`) gets no notification and no attention
 *   sound; its row stays in the attention list.
 * - The live channel (`stream=notifications`) opens once its forward is looked up, but not for a computer hidden
 *   while the lookup waited, and a lookup from before a stretch in the background opens no second channel.
 */

import type * as ReactNative from 'react-native';
import type { AppStateStatus } from 'react-native';
import type * as NotificationsModule from 'expo-notifications';

import type * as AlertsModule from '../app/alerts';
import type * as DeepLinksModule from '../app/deepLinks';
import type * as AppLogModule from '../app/appLog';
import type { GhostexMobileSummary } from '../contract/mobileSummary';
import type * as InventoryStoreModule from '../inventory/store';
import type * as NativeModule from '../../modules/ghostex-native/src';
import type * as MachinesStoreModule from '../machines/store';
import type { MachineRecord } from '../machines/store';
import type * as SettingsStoreModule from '../settings/store';
import type * as TerminalSessionsModule from '../terminal/sessions';
import type { TerminalTab } from '../terminal/sessions';
import type * as ZmxDisplayModule from '../terminal/zmxDisplay';
import type * as AttentionRowsModule from './attentionRows';
import type * as FeedStoreModule from './feedStore';
import type { NotificationSettings } from './settings';

jest.mock('../../modules/ghostex-native/src', () => ({
  GhostexNative: {
    addListener: jest.fn(() => ({ remove: jest.fn() })),
    playAlertSound: jest.fn(() => Promise.resolve()),
  },
}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-notifications', () => ({
  IosAuthorizationStatus: { NOT_DETERMINED: 0, DENIED: 1, AUTHORIZED: 2, PROVISIONAL: 3, EPHEMERAL: 4 },
  DEFAULT_ACTION_IDENTIFIER: 'expo.modules.notifications.actions.DEFAULT',
  setNotificationHandler: jest.fn(),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ ios: { status: 2 } })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ ios: { status: 2 } })),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('scheduled')),
}));
jest.mock('../app/appLog', () => ({ logAppEvent: jest.fn() }));
// The saved computers' credentials: every Easy Connect record's address names the same computer (a synthetic address
// holding one all-zero public server key; no secret, no live address), so two records of it are merged at load.
jest.mock('expo-secure-store', () => ({
  getItemAsync: () => Promise.resolve('tcoWFwWCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'),
  setItemAsync: () => Promise.resolve(),
  deleteItemAsync: () => Promise.resolve(),
}));

/**
 * The computer's feed endpoint behind the warm link: its rows, or the error it answers with; what its
 * `ghostex server endpoint` lists, and the loopback forward the link hands out for another socket (none by default).
 */
const mockHost: {
  rows: Record<string, unknown>[];
  error: { code: string; message: string } | null;
  capabilities: string[];
  forward: () => Promise<{ localPort: number; authToken: string; capabilities: string[] } | null>;
} = {
  rows: [],
  error: null,
  capabilities: [],
  forward: () => Promise.resolve(null),
};
jest.mock('../chat/rust/machine-link', () => ({
  chatMachineLink: () => ({
    route: () => Promise.resolve('socket'),
    capabilities: () => mockHost.capabilities,
    gxserverLink: () => mockHost.forward(),
    rpc: () =>
      Promise.resolve(
        mockHost.error !== null
          ? { error: mockHost.error }
          : { result: { items: mockHost.rows.map((row) => ({ ...row })) }, error: null },
      ),
  }),
}));

const MACHINE: MachineRecord = {
  id: 'm1',
  name: 'Mac mini',
  host: 'mac-mini.local',
  username: 'owner',
  port: 22,
  savePassword: false,
  lastConnectedAt: null,
};

const ALL_ON: NotificationSettings = {
  enabled: true,
  finished: true,
  waiting: true,
  error: true,
  askedAt: '2026-10-29T10:00:00.000Z',
};

/** A feed row as gxserver sends it (the body is the agent's text; nothing may show it). */
function feedRow(id: string, sessionId: string, fields: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    projectId: 'p1',
    sessionId,
    kind: 'finished',
    title: 'private session title',
    subtitle: 'ghostex-mobile',
    body: 'secret agent text',
    agentName: 'claude',
    createdAt: '2026-10-29T10:00:00.000Z',
    read: false,
    ...fields,
  };
}

type SessionState = {
  activity?: string;
  attentionEventId?: string;
  attentionEnteredAt?: string;
  /** The feed row the computer names for the attention (`attention.notificationId`). */
  attentionNotificationId?: string;
  pendingQuestionCount?: number;
};

/** The summary fields the computer announces; by default a computer that sends both. */
const CURRENT_COMPUTER: GhostexMobileSummary['capabilities'] = { awaitingAnswer: true, attentionNotificationId: true };

/**
 * The computer's session list as the inventory store holds it (parsed). The cast holds for the fields the
 * notification wiring and the attention sound read (`sessionFacts`, `displayStatus`, the capabilities); the rest
 * stays unset.
 */
function summary(
  sessions: Record<string, SessionState>,
  capabilities: GhostexMobileSummary['capabilities'],
): GhostexMobileSummary {
  return {
    agents: [],
    workspaces: null,
    capabilities,
    sessions: Object.entries(sessions).map(([sessionId, state]) => ({
      sessionId,
      projectId: 'p1',
      projectName: 'ghostex-mobile',
      displayTitle: 'private session title',
      agent: 'claude',
      agentName: 'Claude Code',
      agentIcon: '',
      activity: state.activity ?? 'idle',
      status: 'running',
      isSleeping: false,
      isLive: true,
      pendingQuestionCount: state.pendingQuestionCount ?? 0,
      attentionEventId: state.attentionEventId ?? '',
      attentionNotificationId: state.attentionNotificationId ?? '',
      // In attention since a minute before the feed rows below were written.
      attentionEnteredAt:
        state.attentionEnteredAt ?? (state.activity === 'attention' ? '2026-10-29T09:59:00.000Z' : ''),
    })),
  } as unknown as GhostexMobileSummary;
}

/** Lets the reads, the session-list waits and the posts that one step started run to their end. */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 0);
    await promise;
  }
}

/**
 * A fresh app: every module loaded anew (the wiring is installed once per app start), the stores filled
 * as after launch, the computer's session list answering with `sessions`.
 */
function startApp(
  options: {
    settings?: NotificationSettings;
    sessions?: Record<string, SessionState>;
    capabilities?: GhostexMobileSummary['capabilities'];
  } = {},
) {
  const capabilities = options.capabilities ?? CURRENT_COMPUTER;
  jest.resetModules();
  const { AppState } = jest.requireActual<typeof ReactNative>('react-native');
  const listeners: ((state: AppStateStatus) => void)[] = [];
  jest.mocked(AppState.addEventListener).mockImplementation((_type, listener) => {
    listeners.push(listener as (state: AppStateStatus) => void);
    return { remove: () => undefined };
  });
  const appState = AppState as { currentState: AppStateStatus };
  appState.currentState = 'active';

  const feedStore = jest.requireActual<typeof FeedStoreModule>('./feedStore');
  const { useMachinesStore } = jest.requireActual<typeof MachinesStoreModule>('../machines/store');
  const { useSettingsStore, defaultSettings } = jest.requireActual<typeof SettingsStoreModule>('../settings/store');
  const { useInventoryStore } = jest.requireActual<typeof InventoryStoreModule>('../inventory/store');
  const { logAppEvent } = jest.requireMock<typeof AppLogModule>('../app/appLog');
  const notifications = jest.requireMock<typeof NotificationsModule>('expo-notifications');
  const { buildAttentionList, machineFeed } = jest.requireActual<typeof AttentionRowsModule>('./attentionRows');
  const { initAlerts } = jest.requireActual<typeof AlertsModule>('../app/alerts');
  const { GhostexNative } = jest.requireMock<typeof NativeModule>('../../modules/ghostex-native/src');
  const posted = jest.mocked(notifications.scheduleNotificationAsync);
  const { useTerminalStore, attachSessionKey } =
    jest.requireActual<typeof TerminalSessionsModule>('../terminal/sessions');
  const { setMountedSessionKeys } = jest.requireActual<typeof ZmxDisplayModule>('../terminal/zmxDisplay');

  useMachinesStore.setState({ hydrated: true, machines: [MACHINE] });
  useSettingsStore.setState({
    hydrated: true,
    settings: { ...defaultSettings(), notifications: options.settings ?? ALL_ON, doneNotificationSound: true },
  });
  const sessionListRequests: string[] = [];
  // The session list the computer answers with at its next request.
  let answerWith = options.sessions ?? { s1: {}, s2: {} };
  /** The phone's session list now (as if the Sessions screen's poll had just brought it). */
  const setSessions = (next: Record<string, SessionState>) => {
    answerWith = next;
    useInventoryStore.setState((state) => ({
      inventoriesByMachineId: {
        ...state.inventoriesByMachineId,
        m1: {
          ...(state.inventoriesByMachineId.m1 ?? {}),
          summary: summary(next, capabilities),
          serverSummary: summary(next, capabilities),
          lastError: null,
          lastErrorCode: null,
          hasLoaded: true,
          refreshing: false,
          retrying: false,
          fingerprint: null,
        },
      },
    }));
  };
  const answer = async (machine: MachineRecord) => {
    sessionListRequests.push(machine.id);
    setSessions(answerWith);
  };
  useInventoryStore.setState({ refreshMachine: jest.fn(answer), refreshMachineFresh: jest.fn(answer) });
  setSessions(answerWith);

  return {
    feedStore,
    /** The Sessions screen's attention sound (`src/app/alerts.ts`), started as App.tsx starts it. */
    initAlerts,
    /** Settings › Notifications' attention sound switch (`doneNotificationSound`). */
    setSoundOn: (on: boolean) =>
      useSettingsStore.setState((state) => ({ settings: { ...state.settings, doneNotificationSound: on } })),
    /** The requests the phone would show, in order. */
    posted,
    /** Every attention sound: the Sessions list's own and each notification that plays one. */
    sounds: () => [
      ...jest
        .mocked(GhostexNative.playAlertSound)
        .mock.calls.filter(([kind]) => kind === 'attention')
        .map(() => 'sessions list'),
      ...posted.mock.calls.filter(([request]) => request.content.sound === true).map(() => 'notification'),
    ],
    /** The app log's lines (the exportable ring buffer). */
    logs: () => jest.mocked(logAppEvent).mock.calls.map(([line]) => line),
    notifications,
    /** The computers whose session list the phone asked for, in order. */
    sessionListRequests,
    setSessions,
    inventory: useInventoryStore,
    /** What the computer's session list says when the phone asks next (the phone's copy stays as it is). */
    setSessionsOnRequest: (next: Record<string, SessionState>) => {
      answerWith = next;
    },
    /** The attention list's rows as `AttentionList` builds them from the stores, section by section: "id:label". */
    listLabels: () => {
      const inbox = buildAttentionList(
        Object.entries(feedStore.useAttentionFeedStore.getState().feeds).map(([machineId, feed]) =>
          machineFeed(
            { id: machineId, label: MACHINE.name },
            feed,
            useInventoryStore.getState().inventoriesByMachineId[machineId],
            [],
          ),
        ),
        new Set(),
      );
      return [...inbox.needsYou, ...inbox.done, ...inbox.failed, ...inbox.accounts].map(
        (row) => `${row.id}:${row.label}`,
      );
    },
    /**
     * The Terminal screen in front with this session's terminal or Chat View, as the screen reports it
     * (`setMountedSessionKeys`); null: another screen is in front.
     */
    showOnScreen: (sessionId: string | null, view: 'terminal' | 'chat' = 'chat') => {
      if (sessionId === null) {
        setMountedSessionKeys(null, null);
        return;
      }
      const sessionKey = attachSessionKey('m1', sessionId);
      // The cast holds for the tab fields `sessionOnScreen` reads: its session key, computer and session id.
      const tab = {
        sessionKey,
        machineId: 'm1',
        title: 'Session',
        kind: 'attach',
        ghostexSessionId: sessionId,
        state: 'open',
      } as unknown as TerminalTab;
      useTerminalStore.setState({ tabs: [tab], selectedSessionKey: sessionKey });
      setMountedSessionKeys(view === 'terminal' ? sessionKey : null, view === 'chat' ? sessionKey : null);
    },
    /** iOS changing the app's state, as AppState reports it. */
    appStateChange: (next: AppStateStatus) => {
      appState.currentState = next;
      for (const listener of listeners) listener(next);
    },
  };
}

beforeEach(() => {
  // The event source's poll interval and the clock are driven by hand here; the rest runs on real time.
  jest.useFakeTimers({
    doNotFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'],
  });
  mockHost.rows = [];
  mockHost.error = null;
  mockHost.capabilities = [];
  mockHost.forward = () => Promise.resolve(null);
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('back from the background through inactive, rows written meanwhile notify nothing; the next new row does', async () => {
  mockHost.rows = [feedRow('old', 's1')];
  const app = startApp();
  app.feedStore.initAttentionNotifications();
  await settle();

  app.appStateChange('background');
  mockHost.rows = [feedRow('while-away', 's2'), ...mockHost.rows];
  app.appStateChange('inactive');
  // A read before the app is active again (the poll timer firing while iOS brings the app back).
  await app.feedStore.refreshAttentionFeeds();
  app.appStateChange('active');
  await settle();
  expect(app.posted).not.toHaveBeenCalled();

  mockHost.rows = [feedRow('after-return', 's1'), ...mockHost.rows];
  await app.feedStore.refreshAttentionFeeds();
  await settle();
  expect(app.posted.mock.calls.map(([request]) => request.content.data?.sessionId)).toEqual(['s1']);
});

test('with notifications off, a new question row still gets its session list read, so the list says "has a question"', async () => {
  // The feed row says only needsInput; whether it is a question comes from the session list.
  mockHost.rows = [feedRow('q1', 's1', { kind: 'needsInput' })];
  const app = startApp({ settings: { ...ALL_ON, enabled: false }, sessions: { s1: { activity: 'working' } } });
  // What the computer's session list says by the time it is asked: s1 has a counted pending question.
  app.setSessionsOnRequest({ s1: { activity: 'attention', pendingQuestionCount: 1 } });
  app.feedStore.initAttentionNotifications();
  await settle();
  expect(app.sessionListRequests).toEqual(['m1']);
  expect(app.listLabels()).toEqual(['s1:has a question']);
  expect(app.posted).not.toHaveBeenCalled();

  // Only read state changes (the desktop read it), seen by the next poll: nothing to join anew. (An explicit
  // refresh of the list does read the session list for waiting rows: the test further below.)
  mockHost.rows = [feedRow('q1', 's1', { kind: 'needsInput', read: true })];
  jest.advanceTimersByTime(5_000);
  await settle();
  expect(app.feedStore.useAttentionFeedStore.getState().feeds.m1?.rows.map((row) => row.read)).toEqual([true]);
  expect(app.listLabels()).toEqual(['s1:has a question']);
  expect(app.sessionListRequests).toEqual(['m1']);
});

/** Text a computer or the system could put in an error: something private and a path. */
const PRIVATE = 'SYNTHETIC_PRIVATE_PAYLOAD in /Users/someone/private/projects/secret.db';

function expectNoPrivateText(lines: readonly string[]): void {
  expect(lines.filter((line) => line.includes('SYNTHETIC_PRIVATE_PAYLOAD') || line.includes('/Users/'))).toEqual([]);
}

test.each([
  { code: 'internalError', category: 'refused' },
  { code: 'unreachable', category: 'unreachable' },
  { code: 'notFound', category: 'legacy' },
])('a feed change the computer refuses ($code) logs "$category", not its error text', async ({ code, category }) => {
  const app = startApp();
  mockHost.error = { code, message: PRIVATE };
  expect(await app.feedStore.updateAttentionFeed('m1', { action: 'markRead', notificationId: 'n1' })).toBe(false);
  expectNoPrivateText(app.logs());
  expect(app.logs()).toEqual([`Mac mini: notification markRead failed (${category})`]);
});

test('a failing permission ask logs no system error text', async () => {
  const app = startApp({ settings: { enabled: false, finished: false, waiting: false, error: false } });
  jest.mocked(app.notifications.requestPermissionsAsync).mockRejectedValueOnce(new Error(PRIVATE));
  app.feedStore.initAttentionNotifications();
  await settle();
  expect(app.notifications.requestPermissionsAsync).toHaveBeenCalledTimes(1);
  expectNoPrivateText(app.logs());
  expect(app.logs()).toContain('Notifications: the permission ask failed (unexpected)');
});

test('new rows that cannot be mapped log no error text', async () => {
  mockHost.rows = [];
  const app = startApp();
  app.feedStore.initAttentionNotifications();
  await settle();
  // The session list the phone holds fails when read (a broken store state carrying private text).
  app.inventory.setState({ refreshMachineFresh: jest.fn(() => Promise.resolve()) });
  app.inventory.setState({
    inventoriesByMachineId: {
      m1: {
        ...app.inventory.getState().inventoriesByMachineId.m1,
        // A list that throws when read: the cast only has to get the getter past the store's type.
        summary: {
          get sessions(): never {
            throw new Error(PRIVATE);
          },
        } as unknown as GhostexMobileSummary,
      },
    },
  });
  mockHost.rows = [feedRow('n1', 's1')];
  await app.feedStore.refreshAttentionFeeds();
  await settle();
  expect(app.posted).not.toHaveBeenCalled();
  expectNoPrivateText(app.logs());
  expect(app.logs()).toContain('Notifications: new notification rows not handled (unexpected)');
});

test('a session list that cannot be read for the list logs no error text', async () => {
  const app = startApp();
  app.inventory.setState({
    refreshMachineFresh: jest.fn(() => {
      throw new Error(PRIVATE);
    }),
  });
  mockHost.rows = [feedRow('n1', 's1')];
  app.feedStore.initAttentionNotifications();
  await settle();
  expectNoPrivateText(app.logs());
  expect(app.logs()).toContain('Mac mini: session list for notifications not read (unexpected)');
});

/** The Sessions list's attention sound and the agent notifications running together, as the app starts them. */
async function startWithSound(capabilities?: GhostexMobileSummary['capabilities']) {
  const app = startApp({ sessions: { s1: { activity: 'working' }, s2: { activity: 'working' } }, capabilities });
  app.initAlerts();
  app.feedStore.initAttentionNotifications();
  await settle();
  // The Sessions screen's first poll after the start: the first snapshot never sounds.
  app.setSessions({ s1: { activity: 'working' }, s2: { activity: 'working' } });
  return app;
}

test('the Sessions list announces s1 entering attention and names its row; that row 6 s later posts silently', async () => {
  const app = await startWithSound();
  app.setSessions({
    s1: { activity: 'attention', attentionEventId: 'a1', attentionNotificationId: 'n1' },
    s2: { activity: 'working' },
  });
  expect(app.sounds()).toEqual(['sessions list']);

  jest.setSystemTime(Date.now() + 6_000);
  mockHost.rows = [feedRow('n1', 's1', { kind: 'needsInput' })];
  await app.feedStore.refreshAttentionFeeds();
  await settle();
  expect(app.posted).toHaveBeenCalledTimes(1);
  expect(app.sounds()).toEqual(['sessions list']);
});

test('two events of two sessions a second apart sound twice; a computer that names no row gets no notification within 20 s of the sound', async () => {
  for (const namesRow of [true, false]) {
    mockHost.rows = [];
    const app = await startWithSound();
    app.setSessions({ s1: { activity: 'attention', attentionEventId: 'a1' }, s2: { activity: 'working' } });

    jest.setSystemTime(Date.now() + 1_000);
    // s2 finishes: its feed row comes first, the session list the phone then reads shows its attention.
    const s2 = {
      activity: 'attention',
      attentionEventId: 'a2',
      ...(namesRow ? { attentionNotificationId: 'n2' } : {}),
    };
    app.setSessionsOnRequest({ s1: { activity: 'attention', attentionEventId: 'a1' }, s2 });
    mockHost.rows = [feedRow('n2', 's2')];
    await app.feedStore.refreshAttentionFeeds();
    await settle();
    expect(app.sounds()).toEqual(['sessions list', 'sessions list']);
    // Without the name the sound and the row are two announcements of one session: the row waits for the
    // one-per-session limit and stays in the attention list.
    expect(app.posted).toHaveBeenCalledTimes(namesRow ? 1 : 0);
    expect(
      app.logs().includes('Notification held back by the rate limit (finished); it is in the attention list.'),
    ).toBe(!namesRow);
  }
});

test("the Sessions list's sound shares the rate limit: held back after eight notifications, the event later notifies and sounds once", async () => {
  const working: Record<string, SessionState> = Object.fromEntries(
    Array.from({ length: 10 }, (_, i) => [`s${i}`, { activity: 'working' }]),
  );
  const app = startApp({ sessions: working });
  app.initAlerts();
  app.feedStore.initAttentionNotifications();
  await settle();
  app.setSessions(working);
  // Eight other sessions' rows take the minute's notifications.
  mockHost.rows = Array.from({ length: 8 }, (_, i) => feedRow(`b${i}`, `s${i + 2}`));
  await app.feedStore.refreshAttentionFeeds();
  await settle();
  expect(app.posted).toHaveBeenCalledTimes(8);

  // s1 enters attention: the Sessions list's sound is held; so is the notification of its row n1.
  const inAttention = { ...working, s1: { activity: 'attention', attentionEventId: 'a1' } };
  app.setSessions(inAttention);
  app.setSessionsOnRequest(inAttention);
  mockHost.rows = [feedRow('n1', 's1'), ...mockHost.rows];
  await app.feedStore.refreshAttentionFeeds();
  await settle();
  expect(app.posted).toHaveBeenCalledTimes(8);
  expect(app.logs()).toContain('Attention sound held back by the rate limit; the session is in the list.');

  // s1 works again; a minute later n1 comes once more (as its late push would): its first announcement.
  app.setSessions(working);
  app.setSessionsOnRequest(working);
  jest.setSystemTime(Date.now() + 61_000);
  const others = mockHost.rows.filter((row) => row.id !== 'n1');
  mockHost.rows = others;
  await app.feedStore.refreshAttentionFeeds();
  await settle();
  mockHost.rows = [feedRow('n1', 's1'), ...others];
  await app.feedStore.refreshAttentionFeeds();
  await settle();
  // The feed lists its newest row first; new rows are handled oldest first.
  expect(app.posted.mock.calls.map(([request]) => request.content.data?.notificationId)).toEqual([
    'b7',
    'b6',
    'b5',
    'b4',
    'b3',
    'b2',
    'b1',
    'b0',
    'n1',
  ]);
  expect(app.sounds()).toEqual(Array.from({ length: 9 }, () => 'notification'));
});

test("s1's Chat View on screen: its event posts nothing and does not sound, its row stays; s2's event notifies", async () => {
  const app = await startWithSound();
  app.showOnScreen('s1', 'chat');
  app.setSessionsOnRequest({
    s1: { activity: 'attention', attentionEventId: 'a1', attentionNotificationId: 'n1' },
    s2: { activity: 'attention', attentionEventId: 'a2', attentionNotificationId: 'n2' },
  });
  mockHost.rows = [feedRow('n1', 's1', { kind: 'needsInput' }), feedRow('n2', 's2')];
  await app.feedStore.refreshAttentionFeeds();
  await settle();
  expect(app.posted.mock.calls.map(([request]) => request.content.data?.sessionId)).toEqual(['s2']);
  // Both sessions wait (an attention whose kind the computer does not send); s1's stays in the list.
  expect(app.listLabels()).toEqual(['s1:waiting', 's2:waiting']);
  // One sound, s2's (the Sessions list announced it first; its notification stays silent).
  expect(app.sounds()).toEqual(['sessions list']);
});

test("s1's terminal on screen: the Sessions list's attention sound stays silent for it", async () => {
  const app = await startWithSound();
  app.showOnScreen('s1', 'terminal');
  app.setSessions({ s1: { activity: 'attention', attentionEventId: 'a1' }, s2: { activity: 'working' } });
  expect(app.sounds()).toEqual([]);
});

describe("the Sessions list's sound and the feed row of its attention", () => {
  const at = (seconds: number) => new Date(Date.parse('2026-10-29T10:00:00.000Z') + seconds * 1_000);
  /** s1 enters attention at 10:00 (its row is written then), its agent works again a second later. */
  async function shortAttention(
    options: { namesRow?: boolean; onScreen?: boolean; capabilities?: GhostexMobileSummary['capabilities'] } = {},
  ) {
    jest.setSystemTime(at(0));
    const app = await startWithSound(options.capabilities);
    if (options.onScreen === true) app.showOnScreen('s1', 'chat');
    app.setSessions({
      s1: {
        activity: 'attention',
        attentionEventId: 'a0',
        attentionEnteredAt: at(0).toISOString(),
        ...(options.namesRow === true ? { attentionNotificationId: 'n0' } : {}),
      },
      s2: { activity: 'working' },
    });
    await settle();
    if (options.onScreen === true) app.showOnScreen(null);
    jest.setSystemTime(at(1));
    app.setSessions({ s1: { activity: 'working' }, s2: { activity: 'working' } });
    return app;
  }

  test('its row at 21 s, after the session left the attention: one sound when the computer names the row, two without', async () => {
    for (const namesRow of [true, false]) {
      mockHost.rows = [];
      const app = await shortAttention({ namesRow });
      expect(app.sounds()).toEqual(['sessions list']);
      jest.setSystemTime(at(21));
      mockHost.rows = [feedRow('n0', 's1')];
      await app.feedStore.refreshAttentionFeeds();
      await settle();
      expect(app.posted).toHaveBeenCalledTimes(1);
      expect(app.sounds()).toEqual(namesRow ? ['sessions list'] : ['sessions list', 'notification']);
    }
  });

  test('a computer that sends the row id without announcing it in its capabilities: the id is not used', async () => {
    const app = await shortAttention({
      namesRow: true,
      capabilities: { awaitingAnswer: true, attentionNotificationId: false },
    });
    expect(app.sounds()).toEqual(['sessions list']);
    jest.setSystemTime(at(21));
    mockHost.rows = [feedRow('n0', 's1')];
    await app.feedStore.refreshAttentionFeeds();
    await settle();
    // As from a computer that names no row: the row is its own announcement and brings its own sound.
    expect(app.posted).toHaveBeenCalledTimes(1);
    expect(app.sounds()).toEqual(['sessions list', 'notification']);
  });

  test('seen on screen: its named row at 21 s posts nothing; another row, or a row the computer did not name, notifies', async () => {
    for (const namesRow of [true, false]) {
      mockHost.rows = [];
      const app = await shortAttention({ namesRow, onScreen: true });
      jest.setSystemTime(at(21));
      mockHost.rows = [feedRow('n1', 's1', { kind: 'failed', createdAt: at(20).toISOString() })];
      await app.feedStore.refreshAttentionFeeds();
      await settle();
      expect(app.sounds()).toEqual(['notification']);
      jest.setSystemTime(at(42));
      mockHost.rows = [feedRow('n0', 's1'), ...mockHost.rows];
      await app.feedStore.refreshAttentionFeeds();
      await settle();
      expect(app.posted).toHaveBeenCalledTimes(namesRow ? 1 : 2);
    }
  });

  test('a computer that names the row: its row three minutes later is still that event; without the name it sounds again', async () => {
    for (const namesRow of [true, false]) {
      mockHost.rows = [];
      const app = await shortAttention({ namesRow });
      jest.setSystemTime(at(180));
      mockHost.rows = [feedRow('n0', 's1')];
      await app.feedStore.refreshAttentionFeeds();
      await settle();
      expect(app.posted).toHaveBeenCalledTimes(1);
      // Without the name no row is matched to the sound.
      expect(app.sounds()).toEqual(namesRow ? ['sessions list'] : ['sessions list', 'notification']);
    }
  });

  test('a later attention seen on screen and an earlier one sounded, neither naming a row: their row is its own event', async () => {
    jest.setSystemTime(at(0));
    const app = await startWithSound();
    app.setSessions({
      s1: { activity: 'attention', attentionEventId: 'a0', attentionEnteredAt: at(0).toISOString() },
      s2: { activity: 'working' },
    });
    jest.setSystemTime(at(1));
    app.setSessions({ s1: { activity: 'working' }, s2: { activity: 'working' } });
    jest.setSystemTime(at(21));
    app.showOnScreen('s1');
    app.setSessions({
      s1: { activity: 'attention', attentionEventId: 'a1', attentionEnteredAt: at(21).toISOString() },
      s2: { activity: 'working' },
    });
    await settle();
    app.showOnScreen(null);
    jest.setSystemTime(at(22));
    app.setSessions({ s1: { activity: 'working' }, s2: { activity: 'working' } });
    jest.setSystemTime(at(42));
    mockHost.rows = [feedRow('n1', 's1', { createdAt: at(21).toISOString() })];
    await app.feedStore.refreshAttentionFeeds();
    await settle();
    expect(app.posted).toHaveBeenCalledTimes(1);
    expect(app.sounds()).toEqual(['sessions list', 'notification']);
  });

  test('the sound after a notification that came without it takes its own place: held when eight came that minute', async () => {
    jest.setSystemTime(at(0));
    const working: Record<string, SessionState> = Object.fromEntries(
      Array.from({ length: 8 }, (_, i) => [`s${i}`, { activity: 'working' }]),
    );
    const app = startApp({ sessions: working });
    app.initAlerts();
    app.feedStore.initAttentionNotifications();
    await settle();
    app.setSessions(working);
    app.setSoundOn(false);
    mockHost.rows = Array.from({ length: 8 }, (_, i) => feedRow(`n${i}`, `s${i}`));
    await app.feedStore.refreshAttentionFeeds();
    await settle();
    expect(app.posted).toHaveBeenCalledTimes(8);
    expect(app.sounds()).toEqual([]);
    app.setSoundOn(true);
    jest.setSystemTime(at(5));
    app.setSessions({
      ...working,
      s0: {
        activity: 'attention',
        attentionEventId: 'a0',
        attentionNotificationId: 'n0',
        attentionEnteredAt: at(0).toISOString(),
      },
    });
    await settle();
    expect(app.sounds()).toEqual([]);
    expect(app.logs()).toContain('Attention sound held back by the rate limit; the session is in the list.');
  });

  test('eight sounds, eight other rows a minute later, then the first eight rows: at most eight notifications in that minute', async () => {
    jest.setSystemTime(at(0));
    const working: Record<string, SessionState> = Object.fromEntries(
      Array.from({ length: 16 }, (_, i) => [`s${i}`, { activity: 'working' }]),
    );
    const app = startApp({ sessions: working });
    app.initAlerts();
    app.feedStore.initAttentionNotifications();
    await settle();
    app.setSessions(working);
    const attentions: Record<string, SessionState> = { ...working };
    for (let i = 0; i < 8; i += 1) {
      attentions[`s${i}`] = {
        activity: 'attention',
        attentionEventId: `a${i}`,
        attentionNotificationId: `old${i}`,
        attentionEnteredAt: at(0).toISOString(),
      };
    }
    app.setSessions(attentions);
    app.setSessionsOnRequest(attentions);
    await settle();
    expect(app.sounds()).toEqual(['sessions list']);
    jest.setSystemTime(at(60));
    mockHost.rows = Array.from({ length: 8 }, (_, i) =>
      feedRow(`new${i}`, `s${i + 8}`, { createdAt: at(60).toISOString() }),
    );
    await app.feedStore.refreshAttentionFeeds();
    await settle();
    expect(app.posted).toHaveBeenCalledTimes(8);
    jest.setSystemTime(new Date(at(60).getTime() + 1));
    mockHost.rows = [...Array.from({ length: 8 }, (_, i) => feedRow(`old${i}`, `s${i}`)), ...mockHost.rows];
    await app.feedStore.refreshAttentionFeeds();
    await settle();
    expect(app.posted).toHaveBeenCalledTimes(8);
  });
});

test('the app not active (inactive) or another screen in front: the mounted session notifies', async () => {
  const app = await startWithSound();
  app.showOnScreen('s1', 'chat');
  app.appStateChange('inactive');
  mockHost.rows = [feedRow('n1', 's1')];
  await app.feedStore.refreshAttentionFeeds();
  await settle();
  app.appStateChange('active');
  app.showOnScreen(null);
  mockHost.rows = [feedRow('n2', 's2'), ...mockHost.rows];
  await app.feedStore.refreshAttentionFeeds();
  await settle();
  expect(app.posted.mock.calls.map(([request]) => request.content.data?.sessionId)).toEqual(['s1', 's2']);
});

test('a waiting row that stays as it is follows the question count on a list refresh, notifications off', async () => {
  mockHost.rows = [feedRow('same-wait', 's1', { kind: 'needsInput' })];
  const app = startApp({ settings: { ...ALL_ON, enabled: false }, sessions: { s1: { activity: 'attention' } } });
  app.feedStore.initAttentionNotifications();
  await settle();
  expect(app.listLabels()).toEqual(['s1:waiting']);
  // The session list now counts a pending question; the row keeps its id and kind.
  app.setSessionsOnRequest({ s1: { activity: 'attention', pendingQuestionCount: 1 } });
  await app.feedStore.refreshAttentionFeeds();
  await settle();
  expect(app.listLabels()).toEqual(['s1:has a question']);
});

test('a session row arriving during an older session-list read is mapped with a newer one, not dropped', async () => {
  const app = startApp({ sessions: { s1: { activity: 'working' } } });
  app.feedStore.initAttentionNotifications();
  await settle();
  const started = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  let reads = 0;
  const latest = {
    s1: { activity: 'attention', attentionEventId: 'a1' },
    s2: { activity: 'attention', attentionEventId: 'a2' },
  };
  app.inventory.setState({
    refreshMachineFresh: jest.fn(async () => {
      reads += 1;
      if (reads === 1) {
        // This read took its answer before s2 was listed.
        started.resolve();
        await finish.promise;
        app.setSessions({ s1: { activity: 'attention', attentionEventId: 'a1' } });
        app.setSessionsOnRequest(latest);
      } else app.setSessions(latest);
    }),
  });
  mockHost.rows = [feedRow('n1', 's1')];
  await app.feedStore.refreshAttentionFeeds();
  await started.promise;
  mockHost.rows = [feedRow('n2', 's2'), ...mockHost.rows];
  await app.feedStore.refreshAttentionFeeds();
  finish.resolve();
  await settle();
  expect(app.posted.mock.calls.map(([request]) => request.content.data?.sessionId).sort()).toEqual(['s1', 's2']);
  expect(reads).toBe(2);
});

test('a question link at a cold start is not overturned by the loading of saved terminal views', async () => {
  startApp({ sessions: { s1: { activity: 'attention', pendingQuestionCount: 1 } } });
  const { useTerminalStore, attachSessionKey } =
    jest.requireActual<typeof TerminalSessionsModule>('../terminal/sessions');
  const { openDeepLink } = jest.requireActual<typeof DeepLinksModule>('../app/deepLinks');
  const storage = jest.requireMock<{ getItem: jest.Mock }>('@react-native-async-storage/async-storage');
  const original = storage.getItem.getMockImplementation();
  const savedViews = Promise.withResolvers<string>();
  const reading = Promise.withResolvers<void>();
  storage.getItem.mockImplementation((key: string) => {
    if (key !== 'terminal.sessionViewModes.v1') return Promise.resolve(null);
    reading.resolve();
    return savedViews.promise;
  });
  try {
    // The app's start: the terminal's saved view choices are being read (this session's: its terminal).
    const hydration = useTerminalStore.getState().hydrate();
    await reading.promise;
    const key = attachSessionKey('m1', 's1');
    openDeepLink('ghostex://session?machineId=m1&sessionId=s1&view=question');
    savedViews.resolve(JSON.stringify({ [key]: 'terminal' }));
    await hydration;
    // The link is handled once the saved choices are there (it tries again every 250 ms).
    const retried = Promise.withResolvers<void>();
    setTimeout(retried.resolve, 300);
    await retried.promise;
    expect(useTerminalStore.getState().chatModeArmed(key)).toBe(true);
    expect(useTerminalStore.getState().selectedSessionKey).toBe(key);
  } finally {
    storage.getItem.mockImplementation(original);
  }
});

test('a copy of an event announced before a restart posts nothing and does not sound after it', async () => {
  type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
  const STORAGE_KEY = 'notifications.announced.v1';
  const sessions = { s1: { activity: 'attention', attentionEventId: 'a1' } };
  const first = startApp({ sessions });
  first.feedStore.initAttentionNotifications();
  await settle();
  mockHost.rows = [feedRow('n0', 's1')];
  await first.feedStore.refreshAttentionFeeds();
  await settle();
  expect(first.posted).toHaveBeenCalledTimes(1);
  expect(first.sounds()).toEqual(['notification']);
  const record = await jest.requireMock<Storage>('@react-native-async-storage/async-storage').getItem(STORAGE_KEY);
  expect(record).toContain('"rowId":"n0"');
  // Ids only, none of the row's or the session's text.
  for (const text of ['secret agent text', 'private session title', 'ghostex-mobile', 'claude', 'Mac mini']) {
    expect(record).not.toContain(text);
  }

  // The computer replaced n0 by the session's next row; the app quits and starts again with what it stored.
  const second = startApp({ sessions });
  await jest.requireMock<Storage>('@react-native-async-storage/async-storage').setItem(STORAGE_KEY, record ?? '');
  mockHost.rows = [feedRow('n1', 's1')];
  second.feedStore.initAttentionNotifications();
  await settle();
  // n0 delivered once more (the route a late push takes, `processHostEvents`).
  mockHost.rows = [feedRow('n0', 's1'), feedRow('n1', 's1')];
  await second.feedStore.refreshAttentionFeeds();
  await settle();
  expect(second.posted).not.toHaveBeenCalled();
  expect(second.sounds()).toEqual([]);
  expect(second.logs().filter((line) => line.includes('record of announced events'))).toEqual([]);
});

test('while the stored record is still read at a start, a copy of an announced event waits and stays silent; a new event waits and then notifies', async () => {
  type Storage = { getItem: jest.Mock; setItem(key: string, value: string): Promise<void> };
  const STORAGE_KEY = 'notifications.announced.v1';
  const sessions = { s1: { activity: 'attention', attentionEventId: 'a1' }, s2: {} };
  const first = startApp({ sessions });
  first.feedStore.initAttentionNotifications();
  await settle();
  mockHost.rows = [feedRow('n0', 's1')];
  await first.feedStore.refreshAttentionFeeds();
  await settle();
  expect(first.posted).toHaveBeenCalledTimes(1);
  const record = await jest.requireMock<Storage>('@react-native-async-storage/async-storage').getItem(STORAGE_KEY);

  // The app starts again; reading what it stored takes a while.
  const second = startApp({ sessions });
  const storage = jest.requireMock<Storage>('@react-native-async-storage/async-storage');
  await storage.setItem(STORAGE_KEY, record ?? '');
  const original = storage.getItem.getMockImplementation();
  const stored = Promise.withResolvers<string | null>();
  storage.getItem.mockImplementation((key: string) =>
    key === STORAGE_KEY ? stored.promise : (original?.(key) ?? Promise.resolve(null)),
  );
  try {
    mockHost.rows = [feedRow('n1', 's1')];
    second.feedStore.initAttentionNotifications();
    await settle();
    // n0 comes once more (the route a late push takes, `processHostEvents`), next to a new event n2.
    mockHost.rows = [feedRow('n2', 's2'), feedRow('n0', 's1'), feedRow('n1', 's1')];
    await second.feedStore.refreshAttentionFeeds();
    await settle();
    expect(second.posted).not.toHaveBeenCalled();
    stored.resolve(record);
    await settle();
    expect(second.posted.mock.calls.map(([request]) => request.content.data?.notificationId)).toEqual(['n2']);
    expect(second.sounds()).toEqual(['notification']);
  } finally {
    stored.resolve(record);
    storage.getItem.mockImplementation(original);
  }
});

test('a start that merges two saved records of one computer keeps the record of announced events under the record it keeps', async () => {
  type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
  const STORAGE_KEY = 'notifications.announced.v1';
  // The computer's older record, from before it was paired a second time (a synthetic id).
  const DROPPED = '11111111-1111-4111-8111-111111111111';
  const sessions = { s1: { activity: 'attention', attentionEventId: 'a1' } };
  const first = startApp({ sessions });
  first.feedStore.initAttentionNotifications();
  await settle();
  mockHost.rows = [feedRow('n0', 's1')];
  await first.feedStore.refreshAttentionFeeds();
  await settle();
  expect(first.posted).toHaveBeenCalledTimes(1);
  const record = JSON.parse(
    (await jest.requireMock<Storage>('@react-native-async-storage/async-storage').getItem(STORAGE_KEY)) ?? '',
  ) as { computers: Record<string, unknown> };
  // As a launch stored it while the computer was saved twice: n0 announced under the older record's id.
  record.computers = { [DROPPED]: record.computers[MACHINE.id] };

  // The app starts again as App.tsx starts it: the notification wiring, then the saved computers' load, which keeps
  // the newer pairing and moves what the phone saved under the dropped id to it.
  const second = startApp({ sessions });
  const storage = jest.requireMock<Storage>('@react-native-async-storage/async-storage');
  const { useMachinesStore } = jest.requireActual<typeof MachinesStoreModule>('../machines/store');
  useMachinesStore.setState({ hydrated: false, machines: [] });
  await storage.setItem(STORAGE_KEY, JSON.stringify(record));
  await storage.setItem(
    'machines.v1',
    JSON.stringify([
      { ...MACHINE, id: DROPPED, transport: 'tailcat', pairedAt: '2026-10-01T00:00:00.000Z' },
      { ...MACHINE, transport: 'tailcat', pairedAt: '2026-11-01T00:00:00.000Z' },
    ]),
  );
  // Nothing new on the computer at the start.
  mockHost.rows = [];
  second.feedStore.initAttentionNotifications();
  await useMachinesStore.getState().hydrate();
  await settle();
  expect(useMachinesStore.getState().machines.map((machine) => machine.id)).toEqual([MACHINE.id]);
  await second.feedStore.refreshAttentionFeeds();
  await settle();
  // What the start moved to the kept record stays there: n0 announced, under the kept record's id only.
  const stored = JSON.parse((await storage.getItem(STORAGE_KEY)) ?? '') as { computers: Record<string, unknown> };
  expect(Object.keys(stored.computers)).toEqual([MACHINE.id]);
  expect(JSON.stringify(stored.computers[MACHINE.id])).toContain('"rowId":"n0"');
});

// A computer that lists `notificationStream` gets its live channel once its loopback forward is looked up, which can
// take a handshake. The channel lives only while its computer is shown and the app is in front.
describe('the live feed channel while its forward is looked up', () => {
  type Forward = { localPort: number; authToken: string; capabilities: string[] };
  const FORWARD: Forward = { localPort: 12345, authToken: 'synthetic-token', capabilities: ['notificationStream'] };

  /** The computer lists the channel; each forward lookup waits until the test answers it. */
  function heldLookups(): PromiseWithResolvers<Forward>[] {
    const lookups: PromiseWithResolvers<Forward>[] = [];
    mockHost.capabilities = ['notificationStream'];
    mockHost.forward = () => {
      const lookup = Promise.withResolvers<Forward>();
      lookups.push(lookup);
      return lookup.promise;
    };
    return lookups;
  }

  /** Runs `body` with a fake WebSocket that records each channel opened. */
  async function withSockets(body: (opened: string[]) => Promise<void>): Promise<void> {
    const opened: string[] = [];
    const original = global.WebSocket;
    global.WebSocket = class {
      constructor(url: string) {
        opened.push(url);
      }
      close(): void {}
    } as unknown as typeof WebSocket;
    try {
      await body(opened);
    } finally {
      global.WebSocket = original;
    }
  }

  test('a computer shown all along gets its channel once the lookup answers', async () => {
    const lookups = heldLookups();
    await withSockets(async (opened) => {
      const app = startApp();
      app.feedStore.initAttentionNotifications();
      await settle();
      expect(lookups).toHaveLength(1);
      lookups[0].resolve(FORWARD);
      await settle();
      expect(opened).toHaveLength(1);
    });
  });

  test('hidden while its lookup waits, the computer gets no channel when the lookup answers', async () => {
    const lookups = heldLookups();
    await withSockets(async (opened) => {
      const app = startApp();
      app.feedStore.initAttentionNotifications();
      await settle();
      expect(lookups).toHaveLength(1);
      const { useMachinesStore } = jest.requireActual<typeof MachinesStoreModule>('../machines/store');
      useMachinesStore.getState().setMachineDisabled(MACHINE.id, true);
      lookups[0].resolve(FORWARD);
      await settle();
      expect(opened).toEqual([]);
    });
  });

  test('a lookup from before a stretch in the background opens no second channel beside the one after it', async () => {
    const lookups = heldLookups();
    await withSockets(async (opened) => {
      const app = startApp();
      app.feedStore.initAttentionNotifications();
      await settle();
      app.appStateChange('background');
      app.appStateChange('active');
      await settle();
      expect(lookups).toHaveLength(2);
      lookups[0].resolve(FORWARD);
      lookups[1].resolve(FORWARD);
      await settle();
      expect(opened).toHaveLength(1);
    });
  });
});
