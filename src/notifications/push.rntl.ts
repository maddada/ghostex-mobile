/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. Push as the app wires it (`initAttentionNotifications` in `feedStore.ts`,
 * `initPushNotifications` and the background task in `pushStore.ts`), with the real stores, event source,
 * mapper, record of announced events, rate limiter, registration and notification centre adapter; mocked are
 * the boundaries only: React Native's AppState (driven here), expo-notifications (the handler iOS asks while
 * the app is in front, the taps, the token, the scheduled requests the phone would show), expo-task-manager
 * (the background task iOS runs), the build's push project, navigation (the deep link a tap opens), the native
 * module (the Sessions list's attention sound), storage, the app log and each computer's gxserver reached over the
 * warm link (a fake endpoint that records every request). A push iOS shows itself is an input here (the background
 * task's payload), not a measured delivery.
 *
 * - One notification per event: a push the app gets while it is in front and the feed row of the same event
 *   announce once, in either order, and a push without a feed row id follows the record's rule for deliveries
 *   without one (matched within the attention it provably came in, else an event of its own).
 * - Out of front (in the background, or inactive), a computer that confirmed it accepted this phone's push
 *   registration notifies by its push only: its feed rows post nothing of their own, also a row read on one side of a
 *   change of state and handled on the other, also when the app is back in front by then. Every other computer keeps
 *   the app's own notification: one without a push route, one whose registration was refused or has no answer, and
 *   one whose acceptance was lost with the stored record (a push of that older registration can then come as well).
 *   Accepted computers are kept across launches (computer ids only), also through a start whose computers' load
 *   merges two records of one computer (the acceptance moves to the record it keeps): one stays while it cannot be
 *   reached, while a registration is on its way or when it does not take one (refused, or an answer the phone cannot
 *   read), and goes when it removes the token or answers that it has no push route; a hidden one stays, a removed one
 *   goes. Back in
 *   front from inactive, a row such a computer wrote meanwhile posts nothing (iOS may have shown its push), also
 *   when the stored record is read only after the return; a row a later read brings notifies. A build without a
 *   push project and a phone without iOS's permission keep the app's own notifications, also after a stored record
 *   that could not be read.
 * - A push iOS showed while the app was in the background goes to the record, so the feed row of its event that
 *   a read in that background run brings is not announced a second time, whatever the switches and the rate
 *   limit said; it is recorded with the sound it actually had and takes its session's 20 s, so a silent one
 *   leaves the Sessions list's attention sound to come once those passed; the run refreshes the session list.
 * - A tapped push opens its session and marks its row read, at a cold start once the computers are loaded and
 *   once only; a waiting event's push opens the question card when the session's fresh list has a question, also
 *   when that list comes after the session opened (also while the app is inactive). Each opening holds only while no
 *   later tap came and the person did not leave for another screen or session since the tap, up to the link
 *   handler's navigation (the real handler here, its stores and navigator stood in for); what counts as the person
 *   leaving is tested on the real `deepLinks.ts`.
 * - The push token: registered over the warm link with each enabled computer whose `ghostex server endpoint` lists
 *   `pushNotifications` (one that does not gets no registration, counts as holding none and is looked at again at
 *   the next occasion, also one that took the token before its link settled an endpoint without the flag; a link
 *   that knows no endpoint says nothing), with the phone's own id for that computer, which a push carries back to
 *   be the app's (any other computer id is left to iOS), the finished, waiting and error switches, and the pairing
 *   device id of a computer paired by QR code; a change of those switches registers again once with each enabled
 *   computer, other settings and the master switch off send none; removed by the master switch, also from a
 *   computer that does not list `pushNotifications`, registered again when it is turned on; every removal names the
 *   computer; a
 *   registration the master switch or a new token overtook while its computer's route was looked up is not sent; a
 *   computer that does not know the route is not asked again until the token changes; no log line carries the
 *   token, and storage keeps none. Removing a computer (hidden or not, master switch on or off) asks it once to
 *   remove the token once the first ask was answered, waits for that at most the bounded wait and never asks again;
 *   hiding asks nothing. On Android none of it runs.
 */

import type * as ReactNative from 'react-native';
import type { AppStateStatus } from 'react-native';
import type * as NotificationsModule from 'expo-notifications';
import type * as TaskManagerModule from 'expo-task-manager';
import type { NavigationContainerRef } from '@react-navigation/native';

import type * as GhostexNativeModule from '../../modules/ghostex-native/src';
import type * as AlertsModule from '../app/alerts';
import type * as AppLogModule from '../app/appLog';
import type * as DeepLinkHandlerModule from '../app/deepLinkHandler';
import type * as DeepLinksModule from '../app/deepLinks';
import type { GhostexMobileSummary } from '../contract/mobileSummary';
import type { RootStackParamList } from '../navigation/types';
import type * as InventoryStoreModule from '../inventory/store';
import type * as MachinesStoreModule from '../machines/store';
import type { MachineRecord } from '../machines/store';
import type * as SettingsStoreModule from '../settings/store';
import type * as TerminalSessionsModule from '../terminal/sessions';
import type { TerminalTab } from '../terminal/sessions';
import type * as ZmxDisplayModule from '../terminal/zmxDisplay';
import type * as EventIdentityModule from './eventIdentity';
import type * as FeedStoreModule from './feedStore';
import type * as PushStoreModule from './pushStore';
import type * as PushTokenModule from './pushToken';
import type { NotificationSettings } from './settings';

/** The phone's Expo push token as iOS and Expo hand it out (a send credential). */
const mockToken = { current: 'ExponentPushToken[abcdefgh12345678]' };
const TOKEN = mockToken.current;
const NEW_TOKEN = 'ExponentPushToken[zyxwvuts87654321]';

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
  BackgroundNotificationTaskResult: { NewData: 0, NoData: 1, Failed: 2 },
  setNotificationHandler: jest.fn(),
  getLastNotificationResponse: jest.fn(() => null),
  clearLastNotificationResponse: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(),
  getPermissionsAsync: jest.fn(() => Promise.resolve({ ios: { status: 2 } })),
  requestPermissionsAsync: jest.fn(() => Promise.resolve({ ios: { status: 2 } })),
  scheduleNotificationAsync: jest.fn(() => Promise.resolve('scheduled')),
  getExpoPushTokenAsync: jest.fn(() => Promise.resolve({ type: 'expo', data: mockToken.current })),
  addPushTokenListener: jest.fn(() => ({ remove: jest.fn() })),
  registerTaskAsync: jest.fn(() => Promise.resolve(null)),
}));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
/** The build's push project (the project's EAS project); null: a build without one. */
const mockProject: { id: string | null } = { id: 'project-1' };
jest.mock('expo-constants', () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: { eas: { projectId: mockProject.id } } };
    },
  },
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
 * The person's navigation as `personNavigations` in `deepLinks.ts` counts it (every navigation but the app's first
 * screen and a tapped notification's own opening, which that module's own test covers).
 */
const mockNavigation = { changes: 0 };
jest.mock('../app/deepLinks', () => ({
  openDeepLink: jest.fn(),
  personNavigations: jest.fn(() => mockNavigation.changes),
  setSessionOpenedMarker: jest.fn(),
  tapOpens: jest.fn(),
}));

type HostRequest = { machineId: string; method: string; params: Record<string, unknown> };

/**
 * Each computer's gxserver behind the warm link: its feed rows, its error per method, the computers that cannot be
 * reached for the registration (they may still hold the token an earlier launch registered), the computers the
 * phone reaches only on the exec route, the computers whose `ghostex server endpoint` does not list
 * `pushNotifications` (every other one lists it), the computers whose link has not settled an endpoint yet (it knows
 * no capabilities), the link's route lookup held while `routeGate` is set, a registration answer held back while
 * `registrationGate` is set, and every request.
 */
const mockHost: {
  rows: Record<string, unknown>[];
  errors: Record<string, { code: string | null; message: string }>;
  registrationUnreachable: Set<string>;
  legacy: Set<string>;
  withoutPushFlag: Set<string>;
  capabilitiesUnknown: Set<string>;
  routeGate: Promise<void> | null;
  registrationGate: Promise<void> | null;
  requests: HostRequest[];
} = {
  rows: [],
  errors: {},
  registrationUnreachable: new Set(),
  legacy: new Set(),
  withoutPushFlag: new Set(),
  capabilitiesUnknown: new Set(),
  routeGate: null,
  registrationGate: null,
  requests: [],
};
jest.mock('../chat/rust/machine-link', () => ({
  chatMachineLink: (machine: { id: string }) => ({
    route: async () => {
      if (mockHost.routeGate !== null) await mockHost.routeGate;
      return mockHost.legacy.has(machine.id) ? 'legacy' : 'socket';
    },
    capabilities: () => {
      if (mockHost.capabilitiesUnknown.has(machine.id)) return null;
      return mockHost.withoutPushFlag.has(machine.id) ? [] : ['pushNotifications'];
    },
    gxserverLink: () => Promise.resolve(null),
    rpc: async (method: string, params: Record<string, unknown>) => {
      mockHost.requests.push({ machineId: machine.id, method, params: { ...params } });
      if (method === 'registerPushToken' && mockHost.registrationGate !== null) await mockHost.registrationGate;
      const error = mockHost.errors[method];
      if (error !== undefined) return { error };
      if (method === 'registerPushToken') {
        if (mockHost.registrationUnreachable.has(machine.id)) {
          return { error: { code: 'unreachable', message: 'no answer' } };
        }
        return { result: {}, error: null };
      }
      return { result: { items: mockHost.rows.map((row) => ({ ...row })) }, error: null };
    },
  }),
}));

/** A computer whose Ghostex does not know the registration route: it has no push and holds no token. */
const NO_PUSH_ROUTE = {
  registerPushToken: { code: 'notFound', message: 'registerPushToken is not a gxserver HTTP endpoint.' },
};

function machine(id: string, name: string): MachineRecord {
  return {
    id,
    name,
    host: `${id}.local`,
    username: 'owner',
    port: 22,
    savePassword: false,
    lastConnectedAt: null,
  };
}

const ALL_ON: NotificationSettings = {
  enabled: true,
  finished: true,
  waiting: true,
  error: true,
  askedAt: '2031-05-04T08:00:00.000Z',
};

/** When the attention of a session in attention began, and when the feed rows below were written. */
const ATTENTION_ENTERED_AT = '2031-05-04T09:59:00.000Z';
const ROW_CREATED_AT = '2031-05-04T10:00:00.000Z';
/** The phone's clock when a test starts: the push comes half a minute after its row. */
const NOW = new Date('2031-05-04T10:00:30.000Z');

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
    createdAt: ROW_CREATED_AT,
    read: false,
    ...fields,
  };
}

type SessionState = {
  activity?: string;
  attentionEventId?: string;
  /** The feed row the computer names for the attention ('' none). */
  attentionNotificationId?: string;
  pendingQuestionCount?: number;
  awaitingAnswer?: boolean;
};

/**
 * The computer's session list as the inventory store holds it (parsed). The cast holds for the fields the
 * notification wiring reads (`sessionFacts`, the capabilities); the rest stays unset.
 */
function summary(sessions: Record<string, SessionState>): GhostexMobileSummary {
  return {
    agents: [],
    workspaces: null,
    capabilities: { awaitingAnswer: true, attentionNotificationId: true },
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
      awaitingAnswer: state.awaitingAnswer ?? false,
      attentionEventId: state.activity === 'attention' ? (state.attentionEventId ?? 'a1') : '',
      attentionNotificationId: state.attentionNotificationId ?? '',
      attentionEnteredAt: state.activity === 'attention' ? ATTENTION_ENTERED_AT : '',
    })),
  } as unknown as GhostexMobileSummary;
}

/** Lets the reads, the session-list waits, the registrations and the posts that one step started finish. */
async function settle(): Promise<void> {
  for (let i = 0; i < 16; i += 1) {
    const { promise, resolve } = Promise.withResolvers<void>();
    setImmediate(resolve);
    await promise;
  }
}

/** The response iOS reports for a tap on a notification with `data` (its default action). */
function tapResponse(
  data: Record<string, unknown>,
  identifier = 'push-tapped',
): NotificationsModule.NotificationResponse {
  // The cast holds for the fields the tap reads: the action, the identifier and the content's data.
  return {
    actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
    notification: {
      date: 0,
      request: { identifier, content: { data }, trigger: { type: 'push', payload: {} } },
    },
  } as unknown as NotificationsModule.NotificationResponse;
}

/** The data of a push for the event of row `notificationId` ('' for a push without one). */
function pushData(sessionId: string, notificationId: string, kind = 'finished'): Record<string, unknown> {
  return {
    kind,
    machineId: 'm1',
    sessionId,
    ...(notificationId.length > 0 ? { notificationId } : {}),
  };
}

/** A fresh app, both wirings installed as `App.tsx` installs them, the computers answering with `sessions`. */
async function startApp(
  options: {
    settings?: NotificationSettings;
    sessions?: Record<string, SessionState>;
    machines?: MachineRecord[];
    /** iOS answers that the person did not allow notifications. */
    permissionDenied?: boolean;
    /** A build without a push project (no EAS project id in the app config). */
    noPushProject?: boolean;
    /** A cold start from this tapped push: the saved computers are not loaded yet when the app installs its wiring. */
    coldTap?: Record<string, unknown>;
    /**
     * The saved computers are still loading when the app installs its wiring; `machines.getState().hydrate()` then
     * loads them from `stored`, after it, as App.tsx does.
     */
    computersLoading?: boolean;
    /** What an earlier launch left in the app's storage (`stored()` of that launch). */
    stored?: Record<string, string>;
    /** The stored record of announced events is read only when `releaseRecord` lets it (a slow storage read). */
    holdRecord?: boolean;
    /** Reading the stored record of announced events fails (storage that cannot be read). */
    recordReadFails?: boolean;
    /** Writing the record of announced events fails (storage that takes no writes). */
    recordWritesFail?: boolean;
    /** The app runs on Android, where agent notifications and push are not offered. */
    android?: boolean;
    /** The first notification ask is still on screen: the person has not answered it. */
    firstAskOpen?: boolean;
  } = {},
) {
  jest.resetModules();
  mockProject.id = options.noPushProject === true ? null : 'project-1';
  const { AppState, Platform } = jest.requireActual<typeof ReactNative>('react-native');
  // Typed read-only; the modules read it as they load (below), so it is set first.
  const platform = Platform as { OS: string };
  platform.OS = options.android === true ? 'android' : 'ios';
  const listeners: ((state: AppStateStatus) => void)[] = [];
  jest.mocked(AppState.addEventListener).mockImplementation((_type, listener) => {
    listeners.push(listener as (state: AppStateStatus) => void);
    return { remove: () => undefined };
  });
  const appState = AppState as { currentState: AppStateStatus };
  appState.currentState = 'active';

  const feedStore = jest.requireActual<typeof FeedStoreModule>('./feedStore');
  const pushStore = jest.requireActual<typeof PushStoreModule>('./pushStore');
  const { useMachinesStore } = jest.requireActual<typeof MachinesStoreModule>('../machines/store');
  const { useSettingsStore, defaultSettings } = jest.requireActual<typeof SettingsStoreModule>('../settings/store');
  const { useInventoryStore } = jest.requireActual<typeof InventoryStoreModule>('../inventory/store');
  const { sessionDeepLink } = jest.requireActual<typeof DeepLinkHandlerModule>('../app/deepLinkHandler');
  const { logAppEvent } = jest.requireMock<typeof AppLogModule>('../app/appLog');
  const { openDeepLink } = jest.requireMock<typeof DeepLinksModule>('../app/deepLinks');
  const notifications = jest.requireMock<typeof NotificationsModule>('expo-notifications');
  const taskManager = jest.requireMock<typeof TaskManagerModule>('expo-task-manager');
  const storage = jest.requireMock<{
    __INTERNAL_MOCK_STORAGE__: Record<string, string>;
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
  }>('@react-native-async-storage/async-storage');
  Object.assign(storage.__INTERNAL_MOCK_STORAGE__, options.stored ?? {});
  const recordRead = Promise.withResolvers<void>();
  if (options.holdRecord !== true) recordRead.resolve();
  jest.mocked(storage.getItem).mockImplementation(async (key) => {
    if (key === 'notifications.announced.v1') {
      await recordRead.promise;
      if (options.recordReadFails === true) throw new Error('storage read failed');
    }
    return storage.__INTERNAL_MOCK_STORAGE__[key] ?? null;
  });
  jest.mocked(storage.setItem).mockImplementation(async (key, value) => {
    if (key === 'notifications.announced.v1' && options.recordWritesFail === true) {
      throw new Error('storage write failed');
    }
    storage.__INTERNAL_MOCK_STORAGE__[key] = value;
  });
  const posted = jest.mocked(notifications.scheduleNotificationAsync);
  if (options.coldTap !== undefined) {
    jest.mocked(notifications.getLastNotificationResponse).mockReturnValue(tapResponse(options.coldTap));
  }
  if (options.permissionDenied === true) {
    // The cast holds for the field the permission adapter reads (`ios.status`, 1: denied).
    const denied = { ios: { status: 1 } } as unknown as NotificationsModule.NotificationPermissionsStatus;
    jest.mocked(notifications.getPermissionsAsync).mockResolvedValue(denied);
    jest.mocked(notifications.requestPermissionsAsync).mockResolvedValue(denied);
  }
  if (options.firstAskOpen === true) {
    jest.mocked(notifications.requestPermissionsAsync).mockReturnValue(Promise.withResolvers<never>().promise);
  }

  const computers = options.machines ?? [machine('m1', 'Mac mini')];
  useMachinesStore.setState(
    options.coldTap === undefined && options.computersLoading !== true
      ? { hydrated: true, machines: computers }
      : { hydrated: false, machines: [] },
  );
  useSettingsStore.setState({
    hydrated: true,
    settings: { ...defaultSettings(), notifications: options.settings ?? ALL_ON, doneNotificationSound: true },
  });
  let sessions = options.sessions ?? { s1: { activity: 'attention' } };
  const sessionListReads: string[] = [];
  /** While set, session-list reads wait for it before they answer. */
  let sessionListGate: Promise<void> | null = null;
  /** While true, session-list reads fail as a computer that does not answer. */
  let sessionListFails = false;
  const answer = async (target: MachineRecord) => {
    sessionListReads.push(target.id);
    if (sessionListGate !== null) await sessionListGate;
    const previous = useInventoryStore.getState().inventoriesByMachineId[target.id];
    useInventoryStore.setState((state) => ({
      inventoriesByMachineId: {
        ...state.inventoriesByMachineId,
        [target.id]: {
          ...(previous ?? {}),
          summary: sessionListFails ? (previous?.summary ?? null) : summary(sessions),
          serverSummary: sessionListFails ? (previous?.serverSummary ?? null) : summary(sessions),
          lastError: sessionListFails ? 'The computer did not answer.' : null,
          lastErrorCode: sessionListFails ? 'timeout' : null,
          hasLoaded: true,
          refreshing: false,
          retrying: false,
          fingerprint: null,
        },
      },
    }));
  };
  useInventoryStore.setState({ refreshMachine: jest.fn(answer), refreshMachineFresh: jest.fn(answer) });
  for (const target of useMachinesStore.getState().machines) await answer(target);
  sessionListReads.length = 0;

  feedStore.initAttentionNotifications();
  pushStore.initPushNotifications();
  await settle();

  /** Whether iOS shows each push the app got while in front (the handler's answer), in order. */
  const pushesShownByIos: boolean[] = [];

  return {
    feedStore,
    pushStore,
    notifications,
    posted,
    openDeepLink: jest.mocked(openDeepLink),
    /** The links the taps opened, in order. */
    opened: () => jest.mocked(openDeepLink).mock.calls.map(([url]) => url),
    sessionDeepLink,
    sessionListReads,
    settings: useSettingsStore,
    logs: () => jest.mocked(logAppEvent).mock.calls.map(([line]) => line),
    /**
     * Everything the person sees announced: the app's notifications (by identifier) and each push iOS showed
     * itself while the app was in front.
     */
    announced: () => [
      ...posted.mock.calls.map(([request]) => request.identifier),
      ...pushesShownByIos.filter(Boolean).map(() => 'push shown by iOS'),
    ],
    /** A push arriving while the app is in front: iOS asks the app's handler how to show it. */
    receivePush: async (data: Record<string, unknown>) => {
      const handler = jest.mocked(notifications.setNotificationHandler).mock.calls[0]?.[0];
      if (handler === null || handler === undefined) throw new Error('no notification handler installed');
      // The cast holds for the fields the handler reads: the request's trigger and content data.
      const behavior = await handler.handleNotification({
        date: 0,
        request: {
          identifier: `push-${pushesShownByIos.length}`,
          content: { title: 'Claude Code · ghostex-mobile', body: 'Finished', data },
          trigger: { type: 'push', payload: {} },
        },
      } as unknown as NotificationsModule.Notification);
      pushesShownByIos.push(behavior.shouldShowBanner || behavior.shouldShowList || behavior.shouldPlaySound);
      await settle();
      return behavior;
    },
    /** iOS runs the background task for a push with content-available and an alert, with `aps.sound` when `sound`. */
    runBackgroundTask: async (
      data: Record<string, unknown>,
      state: 'active' | 'inactive' | 'background',
      options: { sound?: boolean } = {},
    ) => {
      const executor = jest.mocked(taskManager.defineTask).mock.calls[0]?.[1];
      if (executor === undefined) throw new Error('no background task defined');
      const result: unknown = await executor({
        data: {
          data: { body: data, dataString: JSON.stringify(data) },
          aps: {
            'content-available': 1,
            alert: { title: 'Claude Code · ghostex-mobile', body: 'Finished' },
            ...(options.sound === true ? { sound: 'default' } : {}),
          },
          notification: { title: 'Claude Code · ghostex-mobile', body: 'Finished' },
        },
        error: null,
        executionInfo: { eventId: 'e1', taskName: 'ghostex-background-push', appState: state },
      });
      await settle();
      return result;
    },
    /** The user taps a push iOS showed (`identifier`: the notification's, as iOS reports it). */
    tapPush: async (data: Record<string, unknown>, identifier = 'push-tapped') => {
      const listener = jest.mocked(notifications.addNotificationResponseReceivedListener).mock.calls[0]?.[0];
      if (listener === undefined) throw new Error('no tap listener installed');
      listener(tapResponse(data, identifier));
      await settle();
    },
    /** The saved computers finish loading (a cold start). */
    hydrateMachines: async () => {
      useMachinesStore.setState({ hydrated: true, machines: computers });
      await settle();
    },
    /** What the computers' session lists answer from the next read on. */
    setSessions: (next: Record<string, SessionState>) => {
      sessions = next;
    },
    /** Holds every session-list read until the returned function lets them answer. */
    holdSessionLists: () => {
      const held = Promise.withResolvers<void>();
      sessionListGate = held.promise;
      return () => {
        sessionListGate = null;
        held.resolve();
      };
    },
    /** From the next read on, the computers' session lists fail as a computer that does not answer. */
    failSessionLists: () => {
      sessionListFails = true;
    },
    /** What this launch left in the app's storage, for the next launch (`stored`). */
    stored: () => ({ ...storage.__INTERNAL_MOCK_STORAGE__ }),
    /** The Sessions list's attention sound as `App.tsx` installs it, and how often it played. */
    startAttentionSound: () => {
      jest.requireActual<typeof AlertsModule>('../app/alerts').initAlerts();
      const { GhostexNative } = jest.requireMock<typeof GhostexNativeModule>('../../modules/ghostex-native/src');
      return () =>
        jest.mocked(GhostexNative.playAlertSound).mock.calls.filter(([sound]) => sound === 'attention').length;
    },
    inventory: useInventoryStore,
    machines: useMachinesStore,
    /** The registration requests each computer got, as `computer:action[:token]`. */
    pushRequests: () =>
      mockHost.requests
        .filter((request) => request.method === 'registerPushToken')
        .map((request) =>
          [request.machineId, request.params.action, request.params.token]
            .filter((part) => part !== undefined)
            .join(':'),
        ),
    /** iOS issues a new push token. */
    tokenChanges: async (token: string) => {
      mockToken.current = token;
      const listener = jest.mocked(notifications.addPushTokenListener).mock.calls[0]?.[0];
      if (listener === undefined) throw new Error('no token listener installed');
      listener({ type: 'ios', data: 'device-token' });
      await settle();
    },
    /** iOS changing the app's state, as AppState reports it. */
    appStateChange: async (next: AppStateStatus) => {
      appState.currentState = next;
      for (const listener of listeners) listener(next);
      await settle();
    },
    /** The stored record of announced events is read now (`holdRecord`). */
    releaseRecord: async () => {
      recordRead.resolve();
      await settle();
    },
    /**
     * The Terminal screen in front with this session of m1 (its Chat View), as the screen reports it
     * (`setMountedSessionKeys`); null: another screen is in front.
     */
    showOnScreen: (sessionId: string | null) => {
      const { setMountedSessionKeys } = jest.requireActual<typeof ZmxDisplayModule>('../terminal/zmxDisplay');
      if (sessionId === null) {
        setMountedSessionKeys(null, null);
        return;
      }
      const { attachSessionKey, useTerminalStore } =
        jest.requireActual<typeof TerminalSessionsModule>('../terminal/sessions');
      const sessionKey = attachSessionKey('m1', sessionId);
      // The cast holds for the tab fields `sessionOnScreen` reads: its session key, computer and session id.
      const tab = {
        sessionKey,
        machineId: 'm1',
        title: 'Session',
        kind: 'attach',
        ghostexSessionId: sessionId,
        state: 'detached',
      } as unknown as TerminalTab;
      useTerminalStore.setState({ tabs: [tab], selectedSessionKey: sessionKey });
      setMountedSessionKeys(null, sessionKey);
    },
    /** The person leaves for another screen or session (a navigation, or another session's tab picked). */
    navigate: () => {
      mockNavigation.changes += 1;
    },
    taskManager,
  };
}

beforeEach(() => {
  // The event source's poll interval and the clock are driven by hand here; the rest runs on real time.
  jest.useFakeTimers({
    now: NOW,
    doNotFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'],
  });
  mockHost.rows = [];
  mockHost.errors = {};
  mockHost.requests = [];
  mockHost.registrationUnreachable = new Set();
  mockHost.legacy = new Set();
  mockHost.withoutPushFlag = new Set();
  mockHost.capabilitiesUnknown = new Set();
  mockHost.routeGate = null;
  mockHost.registrationGate = null;
  mockToken.current = TOKEN;
  mockNavigation.changes = 0;
});

afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

/** Past the one-notification-per-session-every-20-s limit, so only the event's identity can hold a copy back. */
const PAST_SESSION_LIMIT_MS = 21_000;

describe('one notification per event while the app runs', () => {
  test('a push in front, then the feed row of the same event: the app announces it once, iOS shows no banner', async () => {
    const app = await startApp();
    const behavior = await app.receivePush(pushData('s1', 'n1'));
    expect(behavior).toMatchObject({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false });
    expect(app.announced()).toEqual(['ghostex-attention:m1:n1']);

    jest.advanceTimersByTime(PAST_SESSION_LIMIT_MS);
    mockHost.rows = [feedRow('n1', 's1')];
    await app.feedStore.refreshAttentionFeeds();
    await settle();
    expect(app.announced()).toEqual(['ghostex-attention:m1:n1']);
  });

  test('the feed row first, then the push of the same event: still once', async () => {
    const app = await startApp();
    mockHost.rows = [feedRow('n1', 's1')];
    await app.feedStore.refreshAttentionFeeds();
    await settle();
    expect(app.announced()).toEqual(['ghostex-attention:m1:n1']);

    jest.advanceTimersByTime(PAST_SESSION_LIMIT_MS);
    await app.receivePush(pushData('s1', 'n1'));
    expect(app.announced()).toEqual(['ghostex-attention:m1:n1']);
  });

  test('pushes in front share the one rate limit with the feed: one per session every 20 s', async () => {
    const app = await startApp({ sessions: { s1: { activity: 'attention' } } });
    mockHost.rows = [feedRow('n1', 's1')];
    await app.feedStore.refreshAttentionFeeds();
    await settle();
    // Another event of the same session ten seconds later, by push: held back, not shown by iOS either.
    jest.advanceTimersByTime(10_000);
    const behavior = await app.receivePush(pushData('s1', 'n2', 'needsInput'));
    expect(behavior.shouldShowBanner).toBe(false);
    expect(app.announced()).toEqual(['ghostex-attention:m1:n1']);
    expect(app.logs()).toContain('Notification held back by the rate limit (waiting); it is in the attention list.');
  });

  test('a push of a kind switched off is not shown while the app runs', async () => {
    const app = await startApp({ settings: { ...ALL_ON, finished: false } });
    const behavior = await app.receivePush(pushData('s1', 'n1'));
    expect(behavior.shouldShowBanner).toBe(false);
    expect(app.announced()).toEqual([]);
  });

  test('a push naming a computer the phone does not have is left to iOS, nothing is lost', async () => {
    const app = await startApp();
    const behavior = await app.receivePush({ ...pushData('s1', 'n1'), machineId: 'unknown-computer' });
    expect(behavior).toMatchObject({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true });
    expect(app.posted).not.toHaveBeenCalled();
  });

  test("a push naming the computer by anything but the phone's own id for it is left to iOS", async () => {
    const app = await startApp();
    const behavior = await app.receivePush({ ...pushData('s1', 'n1'), machineId: 'm1.local' });
    expect(behavior).toMatchObject({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true });
    expect(app.posted).not.toHaveBeenCalled();
  });

  test('a push without an alert (an agent started) shows nothing', async () => {
    const app = await startApp();
    const behavior = await app.receivePush(pushData('s1', '', 'agentStarted'));
    expect(behavior.shouldShowBanner).toBe(false);
    expect(app.announced()).toEqual([]);
  });
});

describe('a push without a feed row id follows the record of announced events', () => {
  test('in the attention it provably came in, it is the attention event the feed row of that kind joins', async () => {
    const app = await startApp({ sessions: { s1: { activity: 'attention' } } });
    await app.receivePush(pushData('s1', ''));
    expect(app.posted).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(PAST_SESSION_LIMIT_MS);
    mockHost.rows = [feedRow('n1', 's1')];
    await app.feedStore.refreshAttentionFeeds();
    await settle();
    expect(app.posted).toHaveBeenCalledTimes(1);
  });

  test('outside an attention nothing ties it to a row: the row is an announcement of its own', async () => {
    const app = await startApp({ sessions: { s1: { activity: 'working' } } });
    await app.receivePush(pushData('s1', ''));
    expect(app.posted).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(PAST_SESSION_LIMIT_MS);
    mockHost.rows = [feedRow('n1', 's1')];
    await app.feedStore.refreshAttentionFeeds();
    await settle();
    expect(app.posted).toHaveBeenCalledTimes(2);
  });
});

describe('a push iOS showed while the app was in the background', () => {
  test('the background run refreshes the session list, completes, and the feed row of its event stays silent', async () => {
    const app = await startApp();
    await app.appStateChange('background');
    const result = await app.runBackgroundTask(pushData('s1', 'n1'), 'background');
    expect(result).toBe(app.notifications.BackgroundNotificationTaskResult.NewData);
    expect(app.sessionListReads).toEqual(['m1']);
    // iOS showed the push; the app posted nothing of its own.
    expect(app.posted).not.toHaveBeenCalled();

    // A read of the feed in the same background run brings the event's row.
    jest.advanceTimersByTime(PAST_SESSION_LIMIT_MS);
    mockHost.rows = [feedRow('n1', 's1')];
    await app.feedStore.refreshAttentionFeeds();
    await settle();
    expect(app.posted).not.toHaveBeenCalled();
  });

  test('back in front, the rows written while the app was away notify nothing', async () => {
    const app = await startApp();
    await app.appStateChange('background');
    mockHost.rows = [feedRow('n1', 's1')];
    await app.appStateChange('inactive');
    await app.appStateChange('active');
    await app.feedStore.refreshAttentionFeeds();
    await settle();
    expect(app.posted).not.toHaveBeenCalled();
  });

  test('a run while the app is in front leaves the push to the app in front', async () => {
    const app = await startApp();
    const result = await app.runBackgroundTask(pushData('s1', 'n1'), 'active');
    expect(result).toBe(app.notifications.BackgroundNotificationTaskResult.NewData);
    // The push itself reaches the handler in front, which announces it once.
    await app.receivePush(pushData('s1', 'n1'));
    expect(app.announced()).toEqual(['ghostex-attention:m1:n1']);
  });
});

describe('a tapped push', () => {
  test('opens its session and marks its row read on its computer', async () => {
    const app = await startApp();
    await app.tapPush(pushData('s1', 'n1'));
    expect(app.opened()).toEqual([app.sessionDeepLink({ machineId: 'm1', sessionId: 's1' })]);
    expect(mockHost.requests).toContainEqual({
      machineId: 'm1',
      method: 'updateNotificationFeed',
      params: { action: 'markRead', notificationId: 'n1' },
    });
  });
});

describe('the push token', () => {
  const twoComputers = [machine('m1', 'Mac mini'), machine('m2', 'MacBook')];
  /** The body of each registration request, as the computer's route gets it. */
  const registrationBodies = () =>
    mockHost.requests.filter((request) => request.method === 'registerPushToken').map((request) => request.params);

  test('goes to each enabled computer over the warm link, and only there', async () => {
    const app = await startApp({ machines: twoComputers });
    expect(app.pushRequests()).toEqual([`m1:register:${TOKEN}`, `m2:register:${TOKEN}`]);
    expect(app.notifications.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: 'project-1' });
  });

  test("names each computer with the phone's own id for it; a push carrying that id back is the app's", async () => {
    const app = await startApp({ machines: twoComputers });
    const registrations = mockHost.requests.filter((request) => request.method === 'registerPushToken');
    expect(registrations.map((request) => [request.machineId, request.params.machineId])).toEqual([
      ['m1', 'm1'],
      ['m2', 'm2'],
    ]);
    // The computer returns what it was given as `data.machineId` of every push it sends.
    const behavior = await app.receivePush({ ...pushData('s1', 'n1'), machineId: registrations[1]?.params.machineId });
    expect(behavior).toMatchObject({ shouldShowBanner: false, shouldShowList: false, shouldPlaySound: false });
    expect(app.announced()).toEqual(['ghostex-attention:m2:n1']);
  });

  test('the master switch off removes it from each computer, on registers it again', async () => {
    const app = await startApp({ machines: twoComputers });
    app.settings.getState().setSetting('notifications', { ...ALL_ON, enabled: false });
    await settle();
    expect(app.pushRequests().slice(2)).toEqual(['m1:unregister', 'm2:unregister']);
    app.settings.getState().setSetting('notifications', ALL_ON);
    await settle();
    expect(app.pushRequests().slice(4)).toEqual([`m1:register:${TOKEN}`, `m2:register:${TOKEN}`]);
  });

  test('each registration carries the three switches, and the pairing device id only for a computer paired by QR code', async () => {
    const app = await startApp({
      settings: { ...ALL_ON, error: false },
      machines: [{ ...machine('m1', 'Mac mini'), deviceId: 'device-7' }, machine('m2', 'MacBook')],
    });
    expect(app.pushRequests()).toHaveLength(2);
    const kinds = { finished: true, waiting: true, error: false };
    expect(registrationBodies()).toStrictEqual([
      { action: 'register', token: TOKEN, machineId: 'm1', kinds, deviceId: 'device-7' },
      { action: 'register', token: TOKEN, machineId: 'm2', kinds },
    ]);
  });

  test('a change of finished, waiting or error goes to each enabled computer once; other settings send nothing', async () => {
    const app = await startApp({ machines: twoComputers });
    app.settings.getState().setSetting('notifications', { ...ALL_ON, finished: false });
    await settle();
    app.settings.getState().setSetting('doneNotificationSound', false);
    await settle();
    await app.appStateChange('background');
    await app.appStateChange('active');
    const kinds = { finished: false, waiting: true, error: true };
    expect(registrationBodies().slice(2)).toStrictEqual([
      { action: 'register', token: TOKEN, machineId: 'm1', kinds },
      { action: 'register', token: TOKEN, machineId: 'm2', kinds },
    ]);
  });

  test('with the master switch off a change of the three sends nothing', async () => {
    const app = await startApp({ settings: { ...ALL_ON, enabled: false } });
    app.settings.getState().setSetting('notifications', { ...ALL_ON, enabled: false, waiting: false });
    await settle();
    expect(app.pushRequests()).toEqual(['m1:unregister']);
  });

  test('every removal names the computer: the master switch off and removing the computer', async () => {
    const app = await startApp({ machines: twoComputers });
    app.settings.getState().setSetting('notifications', { ...ALL_ON, enabled: false });
    await settle();
    await app.pushStore.unregisterBeforeRemoval('m1');
    expect(registrationBodies().filter((body) => body.action === 'unregister')).toStrictEqual([
      { action: 'unregister', machineId: 'm1' },
      { action: 'unregister', machineId: 'm2' },
      { action: 'unregister', machineId: 'm1' },
    ]);
  });

  test.each(['the master switch is turned off', 'iOS issues a new token'] as const)(
    'when %s while the computer’s route is looked up for a registration, that registration is not sent',
    async (change) => {
      const route = Promise.withResolvers<void>();
      mockHost.routeGate = route.promise;
      const app = await startApp();
      expect(app.pushRequests()).toEqual([]);
      const off = change === 'the master switch is turned off';
      if (off) {
        app.settings.getState().setSetting('notifications', { ...ALL_ON, enabled: false });
        await settle();
      } else await app.tokenChanges(NEW_TOKEN);
      mockHost.routeGate = null;
      route.resolve();
      await settle();
      expect(app.pushRequests()).toEqual(off ? ['m1:unregister'] : [`m1:register:${NEW_TOKEN}`]);
    },
  );

  test('without iOS permission no token is fetched and nothing is sent', async () => {
    const app = await startApp({ permissionDenied: true });
    expect(app.notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(app.pushRequests()).toEqual([]);
  });

  test('a computer that does not know the route is not asked again until the token changes', async () => {
    mockHost.errors = {
      registerPushToken: { code: 'notFound', message: 'registerPushToken is not a gxserver HTTP endpoint.' },
    };
    const app = await startApp();
    expect(app.pushRequests()).toEqual([`m1:register:${TOKEN}`]);
    await app.appStateChange('background');
    await app.appStateChange('active');
    app.settings.getState().setSetting('notifications', { ...ALL_ON, enabled: false });
    await settle();
    expect(app.pushRequests()).toEqual([`m1:register:${TOKEN}`]);
    expect(app.logs()).toContain('Mac mini: this computer has no push yet; not asked again until the app starts again');

    app.settings.getState().setSetting('notifications', ALL_ON);
    mockHost.errors = {};
    await app.tokenChanges(NEW_TOKEN);
    expect(app.pushRequests()).toEqual([`m1:register:${TOKEN}`, `m1:register:${NEW_TOKEN}`]);
  });

  test('a computer whose endpoint does not list pushNotifications gets no registration; one that lists it does', async () => {
    mockHost.withoutPushFlag.add('m1');
    const app = await startApp({ machines: [machine('m1', 'Mac mini'), machine('m2', 'MacBook')] });
    expect(app.pushRequests()).toEqual([`m2:register:${TOKEN}`]);
    expect(app.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual(['m2']);
    expect(app.logs()).toContain('Mac mini: this computer does not offer push; no push token registered');

    // Its Ghostex is updated and lists the flag: the next occasion registers it.
    mockHost.withoutPushFlag.clear();
    await app.appStateChange('background');
    await app.appStateChange('active');
    expect(app.pushRequests()).toEqual([`m2:register:${TOKEN}`, `m1:register:${TOKEN}`]);
  });

  test('a computer without pushNotifications is still asked to remove the token: the master switch off, its removal', async () => {
    mockHost.withoutPushFlag.add('m1');
    const app = await startApp();
    expect(app.pushRequests()).toEqual([]);
    app.settings.getState().setSetting('notifications', { ...ALL_ON, enabled: false });
    await settle();
    expect(app.pushRequests()).toEqual(['m1:unregister']);
    await app.pushStore.unregisterBeforeRemoval('m1');
    expect(app.pushRequests()).toEqual(['m1:unregister', 'm1:unregister']);
  });

  test('no log line and no console output carries the token', async () => {
    const consoleCalls: string[] = [];
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) =>
      jest.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        consoleCalls.push(args.map(String).join(' '));
      }),
    );
    try {
      mockHost.errors = { registerPushToken: { code: 'badRequest', message: `refused ${TOKEN}` } };
      const app = await startApp({ machines: [machine('m1', 'Mac mini'), machine('m2', 'MacBook')] });
      mockHost.errors = {};
      await app.tokenChanges(NEW_TOKEN);
      app.settings.getState().setSetting('notifications', { ...ALL_ON, waiting: false });
      await settle();
      app.settings.getState().setSetting('notifications', { ...ALL_ON, enabled: false });
      await settle();
      expect(app.pushRequests().length).toBeGreaterThan(0);
      const lines = [...app.logs(), ...consoleCalls];
      expect(lines.filter((line) => line.includes('PushToken['))).toEqual([]);
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe('removing a computer', () => {
  const twoComputers = [machine('m1', 'Mac mini'), machine('m2', 'MacBook')];
  /**
   * Whether `removal` finished within `ms` of real time (the test clock is faked; `setTimeout` is not). Polls in
   * steps of 50 ms, so it returns soon after the removal finished.
   */
  async function finishesWithin(removal: Promise<void>, ms: number): Promise<boolean> {
    let done = false;
    void removal.then(() => {
      done = true;
    });
    for (let waited = 0; waited <= ms && !done; waited += 50) {
      const step = Promise.withResolvers<void>();
      setTimeout(step.resolve, 50);
      await step.promise;
    }
    return done;
  }

  test('a computer that can be reached is asked once to remove the token while its record is there; then nothing more', async () => {
    const app = await startApp({ machines: twoComputers });
    expect(app.pushStore.removalAsksComputer()).toBe(true);
    await app.pushStore.unregisterBeforeRemoval('m1');
    expect(app.pushRequests().slice(2)).toEqual(['m1:unregister']);
    expect(app.machines.getState().machines.map((entry) => entry.id)).toEqual(['m1', 'm2']);
    await app.machines.getState().removeMachine('m1');
    await settle();
    expect(app.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual(['m2']);
    await app.appStateChange('background');
    await app.appStateChange('active');
    await app.tokenChanges(NEW_TOKEN);
    app.settings.getState().setSetting('notifications', { ...ALL_ON, enabled: false });
    await settle();
    expect(app.pushRequests().filter((request) => request.startsWith('m1:'))).toEqual([
      `m1:register:${TOKEN}`,
      'm1:unregister',
    ]);
    expect(app.logs().filter((line) => line.includes('PushToken['))).toEqual([]);
  });

  test('with the master switch off it is asked as well: it may hold the token of an earlier registration', async () => {
    const app = await startApp({ settings: { ...ALL_ON, enabled: false } });
    expect(app.pushRequests()).toEqual(['m1:unregister']);
    await app.pushStore.unregisterBeforeRemoval('m1');
    expect(app.pushRequests()).toEqual(['m1:unregister', 'm1:unregister']);
  });

  test('a hidden computer is asked as well', async () => {
    const app = await startApp({ machines: twoComputers });
    app.machines.getState().setMachineDisabled('m1', true);
    await settle();
    await app.pushStore.unregisterBeforeRemoval('m1');
    expect(app.pushRequests().slice(2)).toEqual(['m1:unregister']);
  });

  test('before the first ask was answered nothing is sent and nothing waits', async () => {
    const app = await startApp({
      settings: { enabled: false, finished: false, waiting: false, error: false },
      firstAskOpen: true,
    });
    expect(app.pushStore.removalAsksComputer()).toBe(false);
    mockHost.routeGate = Promise.withResolvers<void>().promise;
    expect(await finishesWithin(app.pushStore.unregisterBeforeRemoval('m1'), 200)).toBe(true);
    expect(app.pushRequests()).toEqual([]);
  });

  test('a computer that does not answer is removed after the bounded wait; nothing goes out after it', async () => {
    const { REMOVAL_WAIT_MS } = jest.requireActual<typeof PushTokenModule>('./pushToken');
    const app = await startApp({ machines: twoComputers });
    const route = Promise.withResolvers<void>();
    mockHost.routeGate = route.promise;
    const removal = app.pushStore.unregisterBeforeRemoval('m1');
    expect(await finishesWithin(removal, REMOVAL_WAIT_MS - 300)).toBe(false);
    expect(await finishesWithin(removal, 800)).toBe(true);
    expect(app.logs()).toContain('Mac mini: no answer to the push token removal within 2 s; the computer may keep it');
    await app.machines.getState().removeMachine('m1');
    mockHost.routeGate = null;
    route.resolve();
    await settle();
    await app.appStateChange('background');
    await app.appStateChange('active');
    expect(app.pushRequests().filter((request) => request.startsWith('m1:'))).toEqual([`m1:register:${TOKEN}`]);
  });

  test('a computer out of reach is removed at once, asked once, never again; it keeps the token', async () => {
    const app = await startApp({ machines: twoComputers });
    mockHost.registrationUnreachable.add('m1');
    expect(await finishesWithin(app.pushStore.unregisterBeforeRemoval('m1'), 200)).toBe(true);
    await app.machines.getState().removeMachine('m1');
    await app.appStateChange('background');
    await app.appStateChange('active');
    expect(app.pushRequests().filter((request) => request.startsWith('m1:'))).toEqual([
      `m1:register:${TOKEN}`,
      'm1:unregister',
    ]);
    expect(app.logs()).toContain('Mac mini: push token removal not taken (unreachable); the computer may keep it');
  });

  test('hiding a computer asks it nothing', async () => {
    const app = await startApp({ machines: twoComputers });
    app.machines.getState().setMachineDisabled('m1', true);
    await settle();
    expect(app.pushRequests()).toEqual([`m1:register:${TOKEN}`, `m2:register:${TOKEN}`]);
  });
});

describe('while the app runs out of front, a computer that took the registration notifies by its push only', () => {
  test('in the background its feed row posts no notification of its own', async () => {
    const app = await startApp();
    expect(app.pushRequests()).toEqual([`m1:register:${TOKEN}`]);
    await app.appStateChange('background');
    mockHost.rows = [feedRow('n1', 's1')];
    await app.feedStore.refreshAttentionFeeds();
    await settle();
    expect(app.posted).not.toHaveBeenCalled();
  });

  test('inactive counts as out of front: its feed row posts nothing of its own', async () => {
    const app = await startApp();
    await app.appStateChange('inactive');
    mockHost.rows = [feedRow('n1', 's1')];
    await app.feedStore.refreshAttentionFeeds();
    await settle();
    expect(app.posted).not.toHaveBeenCalled();
  });

  test('a computer whose Ghostex has no push route keeps the app’s own notification in the background', async () => {
    mockHost.errors = NO_PUSH_ROUTE;
    const app = await startApp();
    await app.appStateChange('background');
    mockHost.rows = [feedRow('n1', 's1')];
    await app.feedStore.refreshAttentionFeeds();
    await settle();
    expect(app.announced()).toEqual(['ghostex-attention:m1:n1']);
  });

  test('a computer its first registration went to without an answer did not accept: its row gets the app’s own notification', async () => {
    mockHost.registrationUnreachable.add('m1');
    const app = await startApp();
    expect(app.pushRequests()).toEqual([`m1:register:${TOKEN}`]);
    expect(app.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual([]);
    await app.appStateChange('background');
    mockHost.rows = [feedRow('n1', 's1')];
    await app.feedStore.refreshAttentionFeeds();
    await settle();
    expect(app.announced()).toEqual(['ghostex-attention:m1:n1']);
  });

  test.each(['background', 'inactive'] as const)(
    'a row read while the app is out of front (%s) stays the push’s when the app is back in front before it is handled',
    async (away) => {
      const app = await startApp();
      const release = app.holdSessionLists();
      await app.appStateChange(away);
      mockHost.rows = [feedRow('n1', 's1')];
      const reading = app.feedStore.refreshAttentionFeeds();
      await settle();
      if (away === 'background') await app.appStateChange('inactive');
      await app.appStateChange('active');
      release();
      await reading;
      await settle();
      expect(app.posted).not.toHaveBeenCalled();
    },
  );

  test('a row read in front stays the push’s when the app left the front before it is handled', async () => {
    const app = await startApp();
    const release = app.holdSessionLists();
    mockHost.rows = [feedRow('n1', 's1')];
    const reading = app.feedStore.refreshAttentionFeeds();
    await settle();
    await app.appStateChange('background');
    release();
    await reading;
    await settle();
    expect(app.posted).not.toHaveBeenCalled();
  });

  test.each([[['inactive']], [['background', 'inactive']]] as const)(
    'a row read in front and still waiting while the app leaves the front (%j) stays the push’s back in front',
    async (away) => {
      const app = await startApp();
      const release = app.holdSessionLists();
      mockHost.rows = [feedRow('n1', 's1')];
      const reading = app.feedStore.refreshAttentionFeeds();
      await settle();
      // Stipulated: iOS showed the push itself meanwhile, without asking the app (a run there records nothing).
      for (const state of away) await app.appStateChange(state);
      await app.appStateChange('active');
      release();
      await reading;
      await settle();
      expect(app.posted).not.toHaveBeenCalled();
    },
  );

  test('such a row of a computer without a push route keeps the app’s own notification', async () => {
    mockHost.errors = NO_PUSH_ROUTE;
    const app = await startApp();
    const release = app.holdSessionLists();
    mockHost.rows = [feedRow('n1', 's1')];
    const reading = app.feedStore.refreshAttentionFeeds();
    await settle();
    await app.appStateChange('inactive');
    await app.appStateChange('active');
    release();
    await reading;
    await settle();
    expect(app.announced()).toEqual(['ghostex-attention:m1:n1']);
  });

  test('a push iOS asks about while such a row waits is the app’s, once', async () => {
    const app = await startApp();
    const release = app.holdSessionLists();
    mockHost.rows = [feedRow('n1', 's1')];
    const reading = app.feedStore.refreshAttentionFeeds();
    await settle();
    await app.appStateChange('inactive');
    const behavior = await app.receivePush(pushData('s1', 'n1'));
    await app.appStateChange('active');
    release();
    await reading;
    await settle();
    expect(behavior.shouldShowBanner).toBe(false);
    expect(app.announced()).toEqual(['ghostex-attention:m1:n1']);
  });

  test('a push iOS asks about while the app is inactive is the app’s, once, also with its row', async () => {
    const app = await startApp();
    await app.appStateChange('inactive');
    const behavior = await app.receivePush(pushData('s1', 'n1'));
    expect(behavior.shouldShowBanner).toBe(false);
    expect(app.announced()).toEqual(['ghostex-attention:m1:n1']);
    jest.advanceTimersByTime(PAST_SESSION_LIMIT_MS);
    await app.appStateChange('active');
    mockHost.rows = [feedRow('n1', 's1')];
    await app.feedStore.refreshAttentionFeeds();
    await settle();
    expect(app.announced()).toEqual(['ghostex-attention:m1:n1']);
  });
});

describe('a push iOS showed is its event’s notification, whatever the switches and the rate limit say', () => {
  // The computer's Ghostex has no push route, so its feed rows keep the app's own notifications and only the record
  // can tell a copy of a push iOS showed (the stipulated input here).
  beforeEach(() => {
    mockHost.errors = NO_PUSH_ROUTE;
  });

  test('shown while its kind was switched off: its row read after the switch is on announces nothing', async () => {
    const app = await startApp({ settings: { ...ALL_ON, finished: false } });
    await app.appStateChange('background');
    await app.runBackgroundTask(pushData('s1', 'n1'), 'background');
    app.settings.getState().setSetting('notifications', ALL_ON);
    await settle();
    jest.advanceTimersByTime(PAST_SESSION_LIMIT_MS);
    mockHost.rows = [feedRow('n1', 's1')];
    await app.feedStore.refreshAttentionFeeds();
    await settle();
    expect(app.posted).not.toHaveBeenCalled();
  });

  test('shown while its session’s rate slot was taken: its row read later announces nothing', async () => {
    const app = await startApp();
    await app.receivePush(pushData('s1', 'previous'));
    expect(app.announced()).toEqual(['ghostex-attention:m1:previous']);
    await app.appStateChange('background');
    await app.runBackgroundTask(pushData('s1', 'n1', 'needsInput'), 'background');
    jest.advanceTimersByTime(PAST_SESSION_LIMIT_MS);
    mockHost.rows = [feedRow('n1', 's1', { kind: 'needsInput' })];
    await app.feedStore.refreshAttentionFeeds();
    await settle();
    expect(app.announced()).toEqual(['ghostex-attention:m1:previous']);
  });
});

describe('a push iOS showed is recorded with the channels it used', () => {
  /** s1 works; the push's background run reads the list again and finds s1 in the attention of row n1. */
  async function attentionAfterPush() {
    const app = await startApp({ sessions: { s1: { activity: 'working' } } });
    const plays = app.startAttentionSound();
    // The Sessions list's first look at the computer, which never sounds.
    app.inventory.setState({});
    await settle();
    app.setSessions({ s1: { activity: 'attention', attentionNotificationId: 'n1' } });
    await app.appStateChange('background');
    return { app, plays };
  }

  test('a push without a sound takes its session’s 20 s: the Sessions list’s sound in the same run stays silent', async () => {
    const { app, plays } = await attentionAfterPush();
    await app.runBackgroundTask(pushData('s1', 'n1'), 'background');
    expect(plays()).toBe(0);
    expect(app.logs()).toContain('Attention sound held back by the rate limit; the session is in the list.');
  });

  test('a push without a sound leaves its event’s attention sound to the Sessions list after its session’s 20 s', async () => {
    const { app, plays } = await attentionAfterPush();
    const release = app.holdSessionLists();
    const run = app.runBackgroundTask(pushData('s1', 'n1'), 'background');
    await settle();
    jest.advanceTimersByTime(PAST_SESSION_LIMIT_MS);
    release();
    await run;
    expect(plays()).toBe(1);
  });

  test('a push that sounded is its event’s sound, also when the app’s sound was off as it came', async () => {
    const { app, plays } = await attentionAfterPush();
    app.settings.getState().setSetting('doneNotificationSound', false);
    const release = app.holdSessionLists();
    const run = app.runBackgroundTask(pushData('s1', 'n1'), 'background', { sound: true });
    await settle();
    // Past the one-per-session interval, so only what the record knows of the push can hold the sound back.
    jest.advanceTimersByTime(PAST_SESSION_LIMIT_MS);
    app.settings.getState().setSetting('doneNotificationSound', true);
    release();
    await run;
    expect(plays()).toBe(0);
  });
});

describe('a tapped push of a waiting event', () => {
  const waitingPush = pushData('s1', 'n1', 'needsInput');

  test('opens the question card when the session counts a pending question; the link reaches the card', async () => {
    const app = await startApp({ sessions: { s1: { activity: 'attention', pendingQuestionCount: 1 } } });
    await app.tapPush(waitingPush);
    const question = app.sessionDeepLink({ machineId: 'm1', sessionId: 's1', view: 'question' });
    expect(app.opened()).toEqual([question]);

    const { handleDeepLink } = jest.requireActual<typeof DeepLinkHandlerModule>('../app/deepLinkHandler');
    const showChatView = jest.fn();
    const target = { id: 'm1', host: 'm1.local', username: 'owner', port: 22 };
    handleDeepLink(question, {
      storesReady: () => true,
      machine: () => target,
      session: () => ({ projectId: 'p1', title: '', hasChatView: true, opensInChatView: false }),
      loadSession: () => Promise.resolve(undefined),
      revealWorkspace: () => undefined,
      openChatTab: () => 'm1:s1',
      showChatView,
      attachSession: () => Promise.resolve('m1:s1'),
      navigate: () => undefined,
      later: () => undefined,
      markOpened: () => undefined,
    });
    expect(showChatView).toHaveBeenCalledWith('m1:s1');
  });

  test('opens the question card when the session has an open question card', async () => {
    const app = await startApp({ sessions: { s1: { activity: 'attention', awaitingAnswer: true } } });
    await app.tapPush(waitingPush);
    expect(app.opened()).toEqual([app.sessionDeepLink({ machineId: 'm1', sessionId: 's1', view: 'question' })]);
  });

  test('reads the session list anew at the tap: a question that came after the push opens the card', async () => {
    const app = await startApp({ sessions: { s1: { activity: 'attention' } } });
    app.setSessions({ s1: { activity: 'attention', pendingQuestionCount: 1 } });
    await app.tapPush(waitingPush);
    expect(app.sessionListReads).toContain('m1');
    expect(app.opened()).toEqual([app.sessionDeepLink({ machineId: 'm1', sessionId: 's1', view: 'question' })]);
  });

  test('without a pending question it opens the session as a tap in the Sessions list does', async () => {
    const app = await startApp({ sessions: { s1: { activity: 'attention' } } });
    await app.tapPush(waitingPush);
    expect(app.opened()).toEqual([app.sessionDeepLink({ machineId: 'm1', sessionId: 's1' })]);
  });

  test('from a cold start: once the computers are loaded and the list is read, the question card; the row read once', async () => {
    const app = await startApp({
      coldTap: waitingPush,
      sessions: { s1: { activity: 'attention', pendingQuestionCount: 1 } },
    });
    await app.hydrateMachines();
    expect(app.opened()).toEqual([app.sessionDeepLink({ machineId: 'm1', sessionId: 's1', view: 'question' })]);
    expect(mockHost.requests.filter((request) => request.params.action === 'markRead')).toEqual([
      { machineId: 'm1', method: 'updateNotificationFeed', params: { action: 'markRead', notificationId: 'n1' } },
    ]);
  });
});

describe('a tapped waiting push whose session list comes late', () => {
  const waitingPush = pushData('s1', 'n1', 'needsInput');
  const plain = { machineId: 'm1', sessionId: 's1' };
  /** How long a tapped waiting push waits for its session's fresh list before the session opens (`feedStore.ts`). */
  const LIST_WAIT_MS = 5_000;

  beforeEach(() => {
    // The wait for the session list runs on the faked clock here, so five seconds pass at once.
    jest.useFakeTimers({ now: NOW, doNotFake: ['setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask'] });
  });

  /** A cold start from the tapped push; the session list is held past the wait and has no copy from before. */
  async function coldTapWithLateList(sessions: Record<string, SessionState>) {
    const app = await startApp({ coldTap: waitingPush, sessions });
    const release = app.holdSessionLists();
    await app.hydrateMachines();
    expect(app.openDeepLink).not.toHaveBeenCalled();
    jest.advanceTimersByTime(LIST_WAIT_MS);
    await settle();
    expect(app.opened()).toEqual([app.sessionDeepLink(plain)]);
    return { app, release };
  }

  test('the session opens after the wait; the question card replaces it once the list shows the question', async () => {
    // Nothing navigated since the session opened: its opening is still under way (a terminal attaches first).
    const { app, release } = await coldTapWithLateList({ s1: { activity: 'attention', pendingQuestionCount: 1 } });
    release();
    await settle();
    expect(app.opened()).toEqual([app.sessionDeepLink(plain), app.sessionDeepLink({ ...plain, view: 'question' })]);
  });

  test('the question card replaces the view while the person stays on that session, also while the app is inactive', async () => {
    const { app, release } = await coldTapWithLateList({ s1: { activity: 'attention', pendingQuestionCount: 1 } });
    app.showOnScreen('s1');
    // Notification Centre over the session: the app is inactive as the list comes; nothing else navigated.
    await app.appStateChange('inactive');
    release();
    await settle();
    await app.appStateChange('active');
    expect(app.opened()).toEqual([app.sessionDeepLink(plain), app.sessionDeepLink({ ...plain, view: 'question' })]);
  });

  test.each([
    ['opened another session', 's2'],
    ['went to another screen', null],
  ] as const)('after the person %s, the list with the question opens nothing', async (_navigation, onScreen) => {
    const { app, release } = await coldTapWithLateList({ s1: { activity: 'attention', pendingQuestionCount: 1 } });
    app.navigate();
    app.showOnScreen(onScreen);
    release();
    await settle();
    expect(app.opened()).toEqual([app.sessionDeepLink(plain)]);
  });

  test('a list without a question leaves the session as it opened', async () => {
    const { app, release } = await coldTapWithLateList({ s1: { activity: 'attention' } });
    release();
    await settle();
    expect(app.opened()).toEqual([app.sessionDeepLink(plain)]);
  });

  test('a computer that does not answer for the list leaves the session as it opened', async () => {
    const { app, release } = await coldTapWithLateList({ s1: { activity: 'attention', pendingQuestionCount: 1 } });
    app.failSessionLists();
    release();
    await settle();
    expect(app.opened()).toEqual([app.sessionDeepLink(plain)]);
  });

  test('a tap on another notification meanwhile ends the wait for the question card', async () => {
    const { app, release } = await coldTapWithLateList({ s1: { activity: 'attention', pendingQuestionCount: 1 } });
    await app.tapPush(pushData('s2', 'n2'), 'other-push');
    release();
    await settle();
    expect(app.opened()).toEqual([
      app.sessionDeepLink(plain),
      app.sessionDeepLink({ machineId: 'm1', sessionId: 's2' }),
    ]);
  });

  describe('a tap on another notification before the waiting push’s session opened', () => {
    const sessions = { s1: { activity: 'attention', pendingQuestionCount: 1 } };
    const other = { machineId: 'm1', sessionId: 's2' };

    test('only the later tap opens, when the list then comes within the wait', async () => {
      const app = await startApp({ sessions });
      const release = app.holdSessionLists();
      await app.tapPush(waitingPush);
      await app.tapPush(pushData('s2', 'n2'), 'other-push');
      release();
      await settle();
      expect(app.opened()).toEqual([app.sessionDeepLink(other)]);
    });

    test('only the later tap opens, when the wait runs out and the list comes after it', async () => {
      const app = await startApp({ sessions });
      const release = app.holdSessionLists();
      await app.tapPush(waitingPush);
      await app.tapPush(pushData('s2', 'n2'), 'other-push');
      jest.advanceTimersByTime(LIST_WAIT_MS);
      await settle();
      expect(app.opened()).toEqual([app.sessionDeepLink(other)]);
      release();
      await settle();
      expect(app.opened()).toEqual([app.sessionDeepLink(other)]);
    });

    test('only the later tap opens, when the first came at a cold start before the computers were loaded', async () => {
      const app = await startApp({ coldTap: waitingPush, sessions });
      await app.tapPush(pushData('s2', 'n2'), 'other-push');
      await app.hydrateMachines();
      expect(app.opened()).toEqual([app.sessionDeepLink(other)]);
    });

    test('only the later tap opens, when it was a notification of the app and the first waited for the computers', async () => {
      const app = await startApp({ coldTap: waitingPush, sessions });
      const url = app.sessionDeepLink({ ...other, view: 'question' });
      await app.tapPush({ ...pushData('s2', 'n2', 'needsInput'), url }, 'local-notification');
      await app.hydrateMachines();
      expect(app.opened()).toEqual([url]);
    });
  });

  test.each([
    ['opened another session', 's2'],
    ['went to another screen', null],
  ] as const)(
    'when the person %s before the session opened, nothing opens, also once the list comes',
    async (_how, onScreen) => {
      const app = await startApp({ sessions: { s1: { activity: 'attention', pendingQuestionCount: 1 } } });
      const release = app.holdSessionLists();
      await app.tapPush(waitingPush);
      app.navigate();
      app.showOnScreen(onScreen);
      jest.advanceTimersByTime(LIST_WAIT_MS);
      await settle();
      expect(app.opened()).toEqual([]);
      release();
      await settle();
      expect(app.opened()).toEqual([]);
    },
  );

  describe('the opening of a tap whose terminal attaches slowly (the real link handler)', () => {
    /** `openDeepLink` hands each link to the real handler; s1's terminal attaches when `attach` lets it, s2's at once. */
    function slowAttachOfS1(openDeepLink: jest.MockedFunction<(typeof DeepLinksModule)['openDeepLink']>) {
      const { handleDeepLink } = jest.requireActual<typeof DeepLinkHandlerModule>('../app/deepLinkHandler');
      const attach = Promise.withResolvers<string>();
      const navigatedTo: string[] = [];
      openDeepLink.mockImplementation((url, current) =>
        handleDeepLink(
          url,
          {
            storesReady: () => true,
            machine: () => ({ id: 'm1', host: 'm1.local', username: 'owner', port: 22 }),
            session: () => undefined,
            loadSession: () => Promise.resolve(undefined),
            revealWorkspace: () => undefined,
            openChatTab: (_machine, session) => `m1:${session.sessionId}`,
            showChatView: () => undefined,
            attachSession: (_machine, session) =>
              session.sessionId === 's1' ? attach.promise : Promise.resolve(`m1:${session.sessionId}`),
            navigate: (route) => {
              if (route.name === 'Terminal') navigatedTo.push(route.params.sessionKey);
            },
            later: () => undefined,
            markOpened: () => undefined,
          },
          current,
        ),
      );
      return { attach, navigatedTo };
    }

    test('a waiting push’s opening after its wait does not navigate over a later tap', async () => {
      const app = await startApp({ sessions: { s1: { activity: 'attention' } } });
      const { attach, navigatedTo } = slowAttachOfS1(app.openDeepLink);
      const release = app.holdSessionLists();
      await app.tapPush(waitingPush);
      jest.advanceTimersByTime(LIST_WAIT_MS);
      await settle();
      await app.tapPush(pushData('s2', 'n2'), 'other-push');
      expect(navigatedTo).toEqual(['m1:s2']);
      attach.resolve('m1:s1');
      release();
      await settle();
      expect(navigatedTo).toEqual(['m1:s2']);
    });

    test('an app notification’s opening does not navigate over a later tap', async () => {
      const app = await startApp();
      const { attach, navigatedTo } = slowAttachOfS1(app.openDeepLink);
      await app.tapPush({ ...pushData('s1', 'n1'), url: app.sessionDeepLink(plain) }, 'local-notification');
      await app.tapPush(pushData('s2', 'n2'), 'other-push');
      attach.resolve('m1:s1');
      await settle();
      expect(navigatedTo).toEqual(['m1:s2']);
    });

    test('without a later tap, the slow opening still navigates to its session', async () => {
      const app = await startApp();
      const { attach, navigatedTo } = slowAttachOfS1(app.openDeepLink);
      await app.tapPush({ ...pushData('s1', 'n1'), url: app.sessionDeepLink(plain) }, 'local-notification');
      expect(navigatedTo).toEqual([]);
      attach.resolve('m1:s1');
      await settle();
      expect(navigatedTo).toEqual(['m1:s1']);
    });
  });
});

describe('which computers accepted this phone’s push registration, also in an earlier launch', () => {
  /** A launch whose registration m1 took; what it stored is the next launch's. */
  async function acceptedBefore(): Promise<Record<string, string>> {
    const first = await startApp();
    expect(first.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual(['m1']);
    return first.stored();
  }

  /** In the background, a row of m1 is read; how many notifications the app posted of its own. */
  async function rowInBackground(app: {
    appStateChange(next: AppStateStatus): Promise<void>;
    feedStore: typeof FeedStoreModule;
    posted: { mock: { calls: readonly unknown[] } };
  }): Promise<number> {
    await app.appStateChange('background');
    mockHost.rows = [feedRow('n1', 's1')];
    await app.feedStore.refreshAttentionFeeds();
    await settle();
    return app.posted.mock.calls.length;
  }

  test('still announces by its push while this launch’s registration is on its way; Settings names it', async () => {
    const stored = await acceptedBefore();
    mockHost.registrationGate = Promise.withResolvers<void>().promise;
    const app = await startApp({ stored });
    expect(app.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual(['m1']);
    expect(await rowInBackground(app)).toBe(0);
  });

  test('still announces by its push while it cannot be reached for the registration', async () => {
    const stored = await acceptedBefore();
    mockHost.registrationUnreachable.add('m1');
    const app = await startApp({ stored });
    expect(app.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual(['m1']);
    expect(await rowInBackground(app)).toBe(0);
  });

  test('stays one while the phone reaches it only on the exec route, which is not asked', async () => {
    const stored = await acceptedBefore();
    mockHost.requests = [];
    mockHost.legacy.add('m1');
    const app = await startApp({ stored });
    expect(app.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual(['m1']);
    expect(app.pushRequests()).toEqual([]);
  });

  test('once it removed the token (Notifications turned off), the stored record names it no more', async () => {
    const first = await startApp();
    first.settings.getState().setSetting('notifications', { ...ALL_ON, enabled: false });
    await settle();
    expect(first.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual([]);
    expect(JSON.parse(first.stored()['notifications.announced.v1'] ?? '{}').pushComputers).toBeUndefined();
  });

  // A registration the computer does not take leaves the token it took before (the registration contract), so
  // neither a refusal nor an answer the phone cannot read confirms that it holds none.
  test.each([
    ['a refusal', { code: 'badRequest', message: 'refused' }],
    ['an answer the phone cannot read', { code: null, message: 'unreadable' }],
  ])('still announces by its push when this launch’s registration gets %s', async (_answer, error) => {
    const stored = await acceptedBefore();
    mockHost.errors = { registerPushToken: error };
    const app = await startApp({ stored });
    expect(app.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual(['m1']);
    expect(await rowInBackground(app)).toBe(0);
  });

  test('a refused first registration keeps the local fallback: its rows get the app’s own notification', async () => {
    mockHost.errors = { registerPushToken: { code: 'badRequest', message: 'refused' } };
    const app = await startApp();
    expect(app.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual([]);
    expect(await rowInBackground(app)).toBe(1);
  });

  test('once its Ghostex answers that it has no push route, its rows notify by the app again', async () => {
    const stored = await acceptedBefore();
    mockHost.errors = { registerPushToken: { code: 'notFound', message: 'not a gxserver HTTP endpoint' } };
    const app = await startApp({ stored });
    expect(app.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual([]);
    expect(await rowInBackground(app)).toBe(1);
  });

  test('once its endpoint no longer lists pushNotifications, Settings names it no more and its rows notify by the app', async () => {
    const stored = await acceptedBefore();
    mockHost.requests = [];
    mockHost.withoutPushFlag.add('m1');
    const app = await startApp({ stored });
    expect(app.pushRequests()).toEqual([]);
    expect(app.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual([]);
    expect(await rowInBackground(app)).toBe(1);
  });

  // Its link settles a new endpoint during the launch (a reconnect) that no longer lists the flag: the next occasion
  // takes it out, although the registration it took is still the one wanted.
  test('once its endpoint stops listing pushNotifications during the launch, the return to front takes it out', async () => {
    const app = await startApp();
    expect(app.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual(['m1']);
    mockHost.withoutPushFlag.add('m1');
    await app.appStateChange('background');
    await app.appStateChange('active');
    expect(app.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual([]);
    expect(app.pushRequests()).toEqual([`m1:register:${TOKEN}`]);
  });

  test('a link that knows no endpoint at the return to front says nothing about push: it stays accepted', async () => {
    const app = await startApp();
    mockHost.capabilitiesUnknown.add('m1');
    await app.appStateChange('background');
    await app.appStateChange('active');
    expect(app.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual(['m1']);
    expect(app.pushRequests()).toEqual([`m1:register:${TOKEN}`]);
  });

  // A launch that reaches it only on the exec route (its endpoint unknown) keeps the earlier acceptance and does not
  // ask it again; once a later handshake settles an endpoint without the flag, the next occasion takes it out.
  test('accepted before, reached only on the exec route this launch, then known without pushNotifications: taken out', async () => {
    const stored = await acceptedBefore();
    mockHost.requests = [];
    mockHost.legacy.add('m1');
    mockHost.capabilitiesUnknown.add('m1');
    const app = await startApp({ stored });
    expect(app.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual(['m1']);
    mockHost.legacy.clear();
    mockHost.capabilitiesUnknown.clear();
    mockHost.withoutPushFlag.add('m1');
    await app.appStateChange('background');
    await app.appStateChange('active');
    expect(app.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual([]);
    expect(app.pushRequests()).toEqual([]);
  });

  test('what is stored of it is its computer id, never the token', async () => {
    const stored = await acceptedBefore();
    expect(Object.values(stored).filter((value) => value.includes('PushToken['))).toEqual([]);
  });

  test('a computer asked for the first time has not accepted yet: a row read before its answer gets the app’s own notification', async () => {
    mockHost.registrationGate = Promise.withResolvers<void>().promise;
    const app = await startApp();
    expect(app.pushRequests()).toEqual([`m1:register:${TOKEN}`]);
    expect(await rowInBackground(app)).toBe(1);
  });

  test('a registration whose answer was lost, refused at the next launch, confirmed nothing: its rows get the app’s own notification', async () => {
    // Stipulated: the computer took the first registration, but its answer did not reach the phone.
    mockHost.registrationUnreachable.add('m1');
    const first = await startApp();
    expect(first.pushRequests()).toEqual([`m1:register:${TOKEN}`]);
    mockHost.registrationUnreachable = new Set();
    mockHost.errors = { registerPushToken: { code: 'badRequest', message: 'refused' } };
    const app = await startApp({ stored: first.stored() });
    expect(app.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual([]);
    expect(await rowInBackground(app)).toBe(1);
  });

  // What the phone no longer knows a computer confirmed counts as not accepted: the app's own notification stands,
  // and a push of the older registration can come as well.
  test.each(['could not be read', 'is missing', 'was not saved by the launch the computer took it in'] as const)(
    'when the stored record %s and no registration is answered in this launch, its rows get the app’s own notification',
    async (loss) => {
      const notSaved = loss === 'was not saved by the launch the computer took it in';
      const first = await startApp({ recordWritesFail: notSaved });
      // The computer took the registration: the request went out and was answered.
      expect(first.pushRequests()).toEqual([`m1:register:${TOKEN}`]);
      expect(first.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual(['m1']);
      if (notSaved) expect(first.stored()['notifications.announced.v1']).toBeUndefined();
      mockHost.requests = [];
      const stored = loss === 'is missing' ? {} : first.stored();
      const app = await startApp({ stored, recordReadFails: loss === 'could not be read', noPushProject: true });
      expect(app.pushRequests()).toEqual([]);
      expect(app.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual([]);
      expect(await rowInBackground(app)).toBe(1);
    },
  );

  test('a record written anew after one that could not be read names it no more at the next launch either', async () => {
    const sessions = { s1: { activity: 'attention' }, s2: { activity: 'attention' } };
    const stored = (await startApp({ sessions })).stored();
    const recovering = await startApp({ sessions, stored, recordReadFails: true, noPushProject: true });
    expect(await rowInBackground(recovering)).toBe(1);
    const rewritten = recovering.stored();
    expect(JSON.parse(rewritten['notifications.announced.v1'] ?? '{}').pushComputers).toBeUndefined();
    const next = await startApp({ sessions, stored: rewritten, noPushProject: true });
    await next.appStateChange('background');
    mockHost.rows = [feedRow('n2', 's2'), feedRow('n1', 's1')];
    await next.feedStore.refreshAttentionFeeds();
    await settle();
    expect(next.announced()).toEqual(['ghostex-attention:m1:n2']);
  });

  test('after a stored record that could not be read, the computer’s answer in this launch names it again', async () => {
    const stored = await acceptedBefore();
    const app = await startApp({ stored, recordReadFails: true });
    expect(app.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual(['m1']);
    expect(await rowInBackground(app)).toBe(0);
  });

  test('after a stored record that could not be read, Settings names no computer that has not answered', async () => {
    mockHost.legacy.add('m1');
    const app = await startApp({ recordReadFails: true });
    expect(app.pushRequests()).toEqual([]);
    expect(app.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual([]);
  });

  test.each([
    ['a build without a push project', 'read', { noPushProject: true }],
    ['a build without a push project', 'could not be read', { noPushProject: true, recordReadFails: true }],
    ['a phone without iOS’s permission', 'read', { permissionDenied: true }],
    ['a phone without iOS’s permission', 'could not be read', { permissionDenied: true, recordReadFails: true }],
  ] as const)(
    '%s registers nothing and keeps the app’s own notification out of front (stored record %s)',
    async (_build, _record, options) => {
      const app = await startApp(options);
      expect(app.pushRequests()).toEqual([]);
      expect(await rowInBackground(app)).toBe(1);
    },
  );

  test('a push iOS showed, then its row, after a stored record that could not be read: nothing more, also hours later', async () => {
    const app = await startApp({ recordReadFails: true, noPushProject: true });
    await app.appStateChange('background');
    await app.runBackgroundTask(pushData('s1', 'n1'), 'background');
    mockHost.rows = [feedRow('n1', 's1')];
    await app.feedStore.refreshAttentionFeeds();
    await settle();
    expect(app.posted).not.toHaveBeenCalled();
    // The session leaves its attention and the row the feed; two hours pass; then the computer confirms none.
    jest.requireActual<typeof EventIdentityModule>('./eventIdentity').announcedEvents.sessionLeftAttention('m1', 's1');
    jest.setSystemTime(Date.now() + 2 * 60 * 60 * 1000 + 1);
    mockHost.rows = [];
    await app.feedStore.refreshAttentionFeeds();
    app.feedStore.pushAccepted('m1', false);
    await settle();
    expect(app.posted).not.toHaveBeenCalled();
  });

  test('a start that merges two saved records of one computer keeps the acceptance stored under the dropped one', async () => {
    // The computer's older record, from before it was paired a second time (a synthetic id).
    const DROPPED = '11111111-1111-4111-8111-111111111111';
    const stored = await acceptedBefore();
    // As a launch stored it while the computer was saved twice: the acceptance under the older record's id.
    stored['notifications.announced.v1'] = (stored['notifications.announced.v1'] ?? '').split('"m1"').join(`"${DROPPED}"`);
    stored['machines.v1'] = JSON.stringify([
      { ...machine(DROPPED, 'Mac mini'), transport: 'tailcat', pairedAt: '2026-10-01T00:00:00.000Z' },
      { ...machine('m1', 'Mac mini'), transport: 'tailcat', pairedAt: '2026-11-01T00:00:00.000Z' },
    ]);
    // The computer cannot be reached at this start, so nothing confirms the acceptance again.
    mockHost.registrationUnreachable.add('m1');
    const app = await startApp({ stored, computersLoading: true });
    await app.machines.getState().hydrate();
    await settle();
    expect(app.machines.getState().machines.map((computer) => computer.id)).toEqual(['m1']);
    expect(app.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual(['m1']);
    expect(JSON.parse(app.stored()['notifications.announced.v1'] ?? '{}').pushComputers).toEqual(['m1']);
  });

  test('a hidden computer stays accepted; a removed one goes', async () => {
    const app = await startApp();
    app.machines.setState({ machines: [{ ...machine('m1', 'Mac mini'), disabled: true }] });
    await settle();
    expect(app.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual(['m1']);
    expect(JSON.parse(app.stored()['notifications.announced.v1'] ?? '{}').pushComputers).toEqual(['m1']);
    app.machines.setState({ machines: [] });
    await settle();
    expect(app.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual([]);
    expect(JSON.parse(app.stored()['notifications.announced.v1'] ?? '{}').pushComputers).toBeUndefined();
  });

  test('a row read in the background while the stored record is still read waits for it and posts nothing', async () => {
    const stored = await acceptedBefore();
    mockHost.registrationUnreachable.add('m1');
    const app = await startApp({ stored, holdRecord: true });
    expect(await rowInBackground(app)).toBe(0);
    await app.releaseRecord();
    expect(app.posted).not.toHaveBeenCalled();
  });

  test('Settings learns which computers accepted the registration only once the stored record is read', async () => {
    const stored = await acceptedBefore();
    mockHost.registrationUnreachable.add('m1');
    const app = await startApp({ stored, holdRecord: true });
    expect(app.feedStore.useAttentionFeedStore.getState().pushComputers).toBeNull();
    await app.releaseRecord();
    expect(app.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual(['m1']);
  });
});

describe('back in front from inactive, without a background phase in between', () => {
  test('a row of a computer that accepted the registration, first read after the return, posts nothing', async () => {
    const app = await startApp();
    await app.appStateChange('inactive');
    // Stipulated: iOS showed the push itself while the app was inactive; the run there records nothing.
    await app.runBackgroundTask(pushData('s1', 'n1'), 'inactive');
    mockHost.rows = [feedRow('n1', 's1')];
    await app.appStateChange('active');
    await app.feedStore.refreshAttentionFeeds();
    await settle();
    expect(app.posted).not.toHaveBeenCalled();
    // The row stays in the attention list.
    expect(app.feedStore.useAttentionFeedStore.getState().feeds.m1?.rows.map((row) => row.id)).toEqual(['n1']);
  });

  test('a row written after the return still notifies in front', async () => {
    const app = await startApp({ sessions: { s1: { activity: 'attention' }, s2: { activity: 'attention' } } });
    await app.appStateChange('inactive');
    mockHost.rows = [feedRow('n1', 's1')];
    await app.appStateChange('active');
    mockHost.rows = [feedRow('n2', 's2'), feedRow('n1', 's1')];
    await app.feedStore.refreshAttentionFeeds();
    await settle();
    expect(app.announced()).toEqual(['ghostex-attention:m1:n2']);
  });

  test('a computer without a push route keeps the app’s own notification for such a row', async () => {
    mockHost.errors = NO_PUSH_ROUTE;
    const app = await startApp();
    await app.appStateChange('inactive');
    mockHost.rows = [feedRow('n1', 's1')];
    await app.appStateChange('active');
    await app.feedStore.refreshAttentionFeeds();
    await settle();
    expect(app.announced()).toEqual(['ghostex-attention:m1:n1']);
  });

  describe('while the stored record that names the computers is still being read', () => {
    const sessions = { s1: { activity: 'attention' }, s2: { activity: 'attention' } };

    test('a row of a computer an earlier launch registered with, read then, posts nothing; a later row does', async () => {
      const stored = (await startApp({ sessions })).stored();
      mockHost.registrationUnreachable.add('m1');
      const app = await startApp({ sessions, stored, holdRecord: true });
      await app.appStateChange('inactive');
      mockHost.rows = [feedRow('n1', 's1')];
      await app.appStateChange('active');
      await app.feedStore.refreshAttentionFeeds();
      await settle();
      await app.releaseRecord();
      expect(app.feedStore.useAttentionFeedStore.getState().pushComputers).toEqual(['m1']);
      expect(app.posted).not.toHaveBeenCalled();
      mockHost.rows = [feedRow('n2', 's2'), feedRow('n1', 's1')];
      await app.feedStore.refreshAttentionFeeds();
      await settle();
      expect(app.announced()).toEqual(['ghostex-attention:m1:n2']);
    });

    test('a computer without a push route keeps the app’s own notification for such a row', async () => {
      mockHost.errors = NO_PUSH_ROUTE;
      const app = await startApp({ sessions, holdRecord: true });
      await app.appStateChange('inactive');
      mockHost.rows = [feedRow('n1', 's1')];
      await app.appStateChange('active');
      await app.feedStore.refreshAttentionFeeds();
      await settle();
      await app.releaseRecord();
      expect(app.announced()).toEqual(['ghostex-attention:m1:n1']);
    });
  });

  test.each(['still being read', 'read'] as const)(
    'a row written after the return notifies in front while the stored record is %s',
    async (record) => {
      const sessions = { s1: { activity: 'attention' } };
      const stored = (await startApp({ sessions })).stored();
      mockHost.registrationUnreachable.add('m1');
      const app = await startApp({ sessions, stored, holdRecord: record === 'still being read' });
      await app.appStateChange('inactive');
      await app.appStateChange('active');
      mockHost.rows = [feedRow('n1', 's1')];
      await app.feedStore.refreshAttentionFeeds();
      await settle();
      await app.releaseRecord();
      expect(app.announced()).toEqual(['ghostex-attention:m1:n1']);
    },
  );
});

describe('a cold-start tap on a push marks its row read', () => {
  const markRead = () => mockHost.requests.filter((request) => request.params.action === 'markRead');

  test('once its computer is loaded, exactly once, also when iOS reports the same tap again', async () => {
    const app = await startApp({ coldTap: pushData('s1', 'n1') });
    expect(markRead()).toEqual([]);
    await app.hydrateMachines();
    await app.tapPush(pushData('s1', 'n1'));
    app.machines.setState({ machines: [...app.machines.getState().machines] });
    await settle();
    expect(markRead()).toEqual([
      { machineId: 'm1', method: 'updateNotificationFeed', params: { action: 'markRead', notificationId: 'n1' } },
    ]);
    expect(app.opened()).toEqual([app.sessionDeepLink({ machineId: 'm1', sessionId: 's1' })]);
  });
});

describe('on Android', () => {
  test('none of the iOS notification and push entry points is called', async () => {
    const app = await startApp({ android: true });
    expect(app.taskManager.defineTask).not.toHaveBeenCalled();
    expect(app.notifications.registerTaskAsync).not.toHaveBeenCalled();
    expect(app.notifications.getExpoPushTokenAsync).not.toHaveBeenCalled();
    expect(app.notifications.setNotificationHandler).not.toHaveBeenCalled();
    expect(app.pushRequests()).toEqual([]);
    expect(app.pushStore.removalAsksComputer()).toBe(false);
    await app.pushStore.unregisterBeforeRemoval('m1');
    expect(app.pushRequests()).toEqual([]);
  });
});

describe('what counts as the person leaving a tapped notification’s session (`deepLinks.ts`)', () => {
  type FocusedRoute = { name: string; params?: { sessionKey: string } };

  /** The real `deepLinks.ts` on a stand-in navigation container whose focused route the test sets. */
  function realNavigation() {
    jest.resetModules();
    const deepLinks = jest.requireActual<typeof DeepLinksModule>('../app/deepLinks');
    const { useTerminalStore } = jest.requireActual<typeof TerminalSessionsModule>('../terminal/sessions');
    let route: FocusedRoute = { name: 'Sessions' };
    const listeners: (() => void)[] = [];
    // The cast holds for what the ref uses of its container here: its listeners and its focused route.
    const container = {
      addListener: (event: string, listener: () => void) => {
        if (event === 'state') listeners.push(listener);
        return () => undefined;
      },
      removeListener: () => undefined,
      isReady: () => true,
      getCurrentRoute: () => route,
    } as unknown as NavigationContainerRef<RootStackParamList>;
    deepLinks.navigationRef.current = container;
    /** The navigation's state changes to this focused route. */
    const show = (next: FocusedRoute) => {
      route = next;
      for (const listener of listeners) listener();
    };
    return { deepLinks, show, useTerminalStore };
  }

  test('the first screen at launch is the app’s; every later screen is the person’s', () => {
    const { deepLinks, show } = realNavigation();
    show({ name: 'Sessions' });
    expect(deepLinks.personNavigations()).toBe(0);
    show({ name: 'Settings' });
    show({ name: 'Sessions' });
    expect(deepLinks.personNavigations()).toBe(2);
  });

  test('the tapped notification’s session is the app’s to open; another session is the person’s', () => {
    const { deepLinks, show } = realNavigation();
    show({ name: 'Sessions' });
    deepLinks.tapOpens('m1', 's1');
    show({ name: 'Terminal', params: { sessionKey: 'm1:s1' } });
    expect(deepLinks.personNavigations()).toBe(0);
    show({ name: 'Terminal', params: { sessionKey: 'm1:s2' } });
    expect(deepLinks.personNavigations()).toBe(1);
  });

  test('picking another session’s tab in the Terminal screen is the person’s; the tapped session’s tab is the app’s', () => {
    const { deepLinks, show, useTerminalStore } = realNavigation();
    show({ name: 'Sessions' });
    deepLinks.tapOpens('m1', 's1');
    useTerminalStore.setState({ selectedSessionKey: 'm1:s1' });
    expect(deepLinks.personNavigations()).toBe(0);
    useTerminalStore.setState({ selectedSessionKey: 'm1:s3' });
    expect(deepLinks.personNavigations()).toBe(1);
  });
});
