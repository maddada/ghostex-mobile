/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. The Home Screen widgets as the app wires them: the real app lifecycle runs the real
 * summary refresh, the real inventory store reads the summary through the real inventory client, and the real
 * `initWidgets` turns the stores into App Group writes and timeline reloads. Fakes only at the boundaries: the SSH
 * exec answers with a summary in the CLI's wire form, the chat transport answers `agentAccounts` with an account
 * list, the core bridge supplies projected window names, the native module records what it is asked, and the clock
 * is Jest's.
 *
 * A refresh writes the snapshot and asks for one reload; a refresh that changes nothing in the same minute writes
 * nothing; the usage is read once and again only after 2 minutes, while the poll runs; in the background nothing is
 * read or written; removing the last computer deletes the snapshot. The widgets add no session-list read: one per
 * poll, as before.
 */

import { AppState, type AppStateStatus } from 'react-native';

import { GhostexWidgets } from '../../modules/ghostex-widgets/src/GhostexWidgets';
import { initAppLifecycle } from '../app/lifecycle';
import { sessionChatRpc } from '../chat/rust/transport';
import { useMachinesStore, type MachineRecord } from '../machines/store';
import { execRemoteCommand } from '../remote/commands';
import { useSettingsStore } from '../settings/store';
import { initWidgets } from './widgets';
import type { WidgetSnapshot } from './widgetSnapshot';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../../modules/ghostex-native/src', () => ({
  GhostexNative: { addListener: () => ({ remove: () => undefined }) },
}));
jest.mock('../app/autoReconnect', () => ({ recoverConnections: () => undefined }));
let mockWire: object = { sessions: [] };
jest.mock('../remote/connection', () => ({
  ensureConnected: () => Promise.resolve(),
  reconnectMachine: () => Promise.resolve(),
  cancelConnectionAttempt: () => undefined,
}));
jest.mock('../remote/commands', () => {
  const list = jest.requireActual('../commands/ghostexCli').sessionsListCommand();
  return {
    execRemoteCommand: jest.fn((_machineId: string, command: string) =>
      Promise.resolve({ stdout: command === list ? JSON.stringify(mockWire) : '', stderr: '', exitCode: 0 }),
    ),
  };
});
// The computer's account list: one Claude account at 40 % on its 5-hour window.
jest.mock('../chat/rust/transport', () => ({
  sessionChatRpc: jest.fn(() =>
    Promise.resolve({
      error: null,
      result: {
        accounts: [
          {
            id: 'work',
            provider: 'claude',
            name: 'work',
            registered: true,
            usage: [{ id: 'fiveHour', label: 'fiveHour', usedPercent: 40, limitWindowSeconds: 18_000 }],
          },
        ],
      },
    }),
  ),
}));
// The existing native core bridge supplies the same window name as the Accounts panel.
jest.mock('../chat/rust/wasm-core/bridge', () => ({
  wasmCoreBridge: { call: jest.fn(async () => [{ usage: [{ name: '5h' }] }]) },
}));
jest.mock('../../modules/ghostex-widgets/src/GhostexWidgets', () => ({
  GhostexWidgets: {
    writeSnapshot: jest.fn(() => Promise.resolve()),
    removeSnapshot: jest.fn(() => Promise.resolve()),
    reloadTimelines: jest.fn(),
  },
}));

const T0 = Date.parse('2026-10-29T20:00:00Z');
const MACHINE: MachineRecord = {
  id: 'wiring-mac',
  name: 'Wiring Mac',
  host: 'wiring.invalid',
  username: 'me',
  port: 22,
  savePassword: false,
  lastConnectedAt: null,
};

const session = (sessionId: string, fields: object) => ({
  sessionId,
  provider: 'zmx',
  agent: 'claude',
  projectName: 'p',
  ...fields,
});
const working = (sessionId: string, since: number) =>
  session(sessionId, { activity: 'working', workingStartedAt: new Date(since).toISOString() });
const waiting = (sessionId: string, since: number) =>
  session(sessionId, {
    activity: 'attention',
    attention: { enteredAt: new Date(since).toISOString(), kind: 'needsInput' },
  });

const native = jest.mocked(GhostexWidgets!);
const listCalls = () =>
  jest
    .mocked(execRemoteCommand)
    .mock.calls.filter(([, command]) => command === 'ghostex sessions --json --mobile-summary').length;
const usageReads = () => jest.mocked(sessionChatRpc).mock.calls.filter(([, method]) => method === 'agentAccounts');
const lastWritten = () => JSON.parse(String(native.writeSnapshot.mock.calls.at(-1)?.[0])) as WidgetSnapshot;

let appState: AppStateStatus = 'active';
const appStateListeners: Array<(state: AppStateStatus) => void> = [];
function moveApp(next: AppStateStatus): void {
  appState = next;
  for (const listener of appStateListeners) listener(next);
}

beforeAll(() => {
  jest.useFakeTimers({ now: T0 });
  Object.defineProperty(AppState, 'currentState', { get: () => appState, configurable: true });
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, listener) => {
    appStateListeners.push(listener as (state: AppStateStatus) => void);
    return { remove: () => undefined };
  });
});

afterAll(() => {
  jest.useRealTimers();
});

test('through the app wiring: each refresh reaches the widgets with one reload per write, usage every 2 minutes, nothing in the background', async () => {
  useMachinesStore.setState({ machines: [MACHINE], selectedMachineId: MACHINE.id, hydrated: true });
  useSettingsStore.setState({ hydrated: true });
  mockWire = { sessions: [working('s1', T0 - 60_000)] };

  // App start, as App.tsx installs them.
  initAppLifecycle();
  initWidgets();
  await jest.advanceTimersByTimeAsync(0);

  // The first refresh: written with the counts and its data time, then again with the usage that arrived.
  expect(listCalls()).toBe(1);
  expect(usageReads()).toHaveLength(1);
  expect(usageReads()[0]?.[2]).toEqual({ operation: 'list' });
  expect(native.writeSnapshot).toHaveBeenCalledTimes(2);
  expect(native.reloadTimelines).toHaveBeenCalledTimes(2);
  expect(lastWritten()).toMatchObject({
    writtenAt: new Date(T0).toISOString(),
    counts: { working: 1, waiting: 0 },
    attention: false,
    usage: { bars: [{ label: 'Claude 5h', usedPercent: 40 }] },
  });

  // 5 seconds later, nothing changed in the same minute: one more session-list read, no write.
  await jest.advanceTimersByTimeAsync(5_000);
  expect(listCalls()).toBe(2);
  expect(native.writeSnapshot).toHaveBeenCalledTimes(2);

  // An agent starts waiting: written at the next refresh, one reload.
  mockWire = { sessions: [working('s1', T0 - 60_000), waiting('s2', T0 + 7_000)] };
  await jest.advanceTimersByTimeAsync(5_000);
  expect(native.writeSnapshot).toHaveBeenCalledTimes(3);
  expect(native.reloadTimelines).toHaveBeenCalledTimes(3);
  expect(lastWritten()).toMatchObject({ counts: { working: 1, waiting: 1 }, attention: true });

  // The usage is read again only after 2 minutes; one session-list read per poll throughout.
  await jest.advanceTimersByTimeAsync(100_000);
  expect(usageReads()).toHaveLength(1);
  await jest.advanceTimersByTimeAsync(10_000);
  expect(usageReads()).toHaveLength(2);
  expect(listCalls()).toBe(25);

  // In the background nothing is read or written.
  const writes = native.writeSnapshot.mock.calls.length;
  moveApp('background');
  await jest.advanceTimersByTimeAsync(300_000);
  expect(listCalls()).toBe(25);
  expect(usageReads()).toHaveLength(2);
  expect(native.writeSnapshot).toHaveBeenCalledTimes(writes);

  // The last computer removed: the snapshot is deleted and the widgets reloaded.
  const reloads = native.reloadTimelines.mock.calls.length;
  useMachinesStore.setState({ machines: [], selectedMachineId: null });
  await jest.advanceTimersByTimeAsync(0);
  expect(native.removeSnapshot).toHaveBeenCalledTimes(1);
  expect(native.reloadTimelines).toHaveBeenCalledTimes(reloads + 1);
});
