/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. Removing a computer from its page (Remove this computer from the phone →
 * confirm): once the first notification ask was answered, the app first asks the computer over its warm link to
 * remove this phone's push token, while the computer's saved record and link still exist, and only then closes its
 * connection and removes it; a computer that does not answer is removed after the bounded wait. The confirm text
 * says so only when the removal asks the computer, also when the first ask's answer arrives while the confirm is
 * open. The real screen, machines and settings stores, first ask and push wiring (`pushStore.ts`); mocked are the
 * boundaries only: navigation (a stand-in that records where the screen goes), the
 * native module (the connection that is closed, and no Tailscale VPN), each computer's gxserver behind the warm
 * link (a fake that records every request and whether the computer's record still existed then), the Keychain
 * (no saved credentials), expo-notifications, expo-task-manager, storage, the safe area and the app log.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { useMachinesStore, type MachineRecord } from '../machines/store';
import { runFirstAsk } from '../notifications/firstAsk';
import { REMOVAL_WAIT_MS } from '../notifications/pushToken';
import type { NotificationSettings } from '../notifications/settings';
import { defaultSettings, useSettingsStore } from '../settings/store';
import MachineFormScreen from './MachineFormScreen';

/** In order: each request to a computer's gxserver and each closed connection. */
const mockEvents: string[] = [];
/** While set, the warm link's route lookup waits for it (a computer that does not answer). */
const mockLink: { routeGate: Promise<void> | null } = { routeGate: null };

jest.mock('../../modules/ghostex-native/src', () => ({
  GhostexNative: {
    addListener: () => ({ remove: () => undefined }),
    isTailscaleConnected: async () => false,
    disconnect: async (machineId: string) => {
      mockEvents.push(`disconnect ${machineId}`);
    },
  },
}));
jest.mock('../chat/rust/machine-link', () => ({
  ...jest.requireActual('../chat/rust/machine-link'),
  chatMachineLink: (machine: { id: string }) => ({
    route: async () => {
      if (mockLink.routeGate !== null) await mockLink.routeGate;
      return 'socket';
    },
    rpc: async (method: string, params: { action?: string }) => {
      const { useMachinesStore: machines } = jest.requireActual<{ useMachinesStore: typeof useMachinesStore }>(
        '../machines/store',
      );
      const saved = machines.getState().machines.some((entry) => entry.id === machine.id);
      mockEvents.push(`${method} ${params.action ?? ''} ${machine.id} (${saved ? 'record saved' : 'record gone'})`);
      return { result: {}, error: null };
    },
  }),
}));
jest.mock('expo-notifications', () => ({}));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-safe-area-context', () => {
  const { View: MockView } = jest.requireActual('react-native');
  return { SafeAreaView: MockView, useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) };
});
// The side bar's rail keys this screen's buttons by its route (`useStackScreenRail`).
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: () => ({ key: 'form', name: 'MachineForm' }),
}));
// The Keychain: this computer has no saved credentials.
jest.mock('expo-secure-store', () => ({
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
  deleteItemAsync: async () => undefined,
}));
jest.mock('../app/appLog', () => ({ logAppEvent: jest.fn() }));

const MACHINE: MachineRecord = {
  id: 'm1',
  name: 'Mac mini',
  host: 'mac-mini.local',
  username: 'owner',
  port: 22,
  savePassword: false,
  lastConnectedAt: null,
};

const ANSWERED: NotificationSettings = {
  enabled: true,
  finished: true,
  waiting: true,
  error: true,
  askedAt: new Date(0).toISOString(),
};
const NOT_ASKED: NotificationSettings = { enabled: false, finished: false, waiting: false, error: false };

/** Where the screen sent the navigation after the removal. */
const resets: unknown[] = [];

function renderScreen(notifications: NotificationSettings) {
  useMachinesStore.setState({ hydrated: true, machines: [MACHINE], selectedMachineId: 'm1' });
  useSettingsStore.setState({ hydrated: true, settings: { ...defaultSettings(), notifications } });
  const navigation = {
    addListener: () => () => undefined,
    setOptions: () => undefined,
    navigate: () => undefined,
    goBack: () => undefined,
    canGoBack: () => false,
    reset: (state: unknown) => void resets.push(state),
  };
  // The cast holds for what the screen calls on its navigation (above) and reads of its route (the machine id).
  const props = { navigation, route: { key: 'form', name: 'MachineForm', params: { machineId: 'm1' } } };
  return render(<MachineFormScreen {...(props as unknown as Parameters<typeof MachineFormScreen>[0])} />);
}

async function openRemove() {
  await fireEvent.press(screen.getByRole('button', { name: 'Remove this computer from the phone' }));
}

async function confirmRemove() {
  await fireEvent.press(screen.getByRole('button', { name: 'Remove' }));
}

beforeEach(() => {
  mockEvents.length = 0;
  mockLink.routeGate = null;
  resets.length = 0;
});

test('the computer is asked once to remove the push token while its record still exists, then disconnected and removed', async () => {
  await renderScreen(ANSWERED);
  await openRemove();
  expect(
    screen.getByText(
      'Mac mini is removed from this phone, along with its saved password and pairing key. If Mac mini can be reached, it also stops sending push notifications. Nothing else changes on the computer.',
    ),
  ).toBeTruthy();
  await confirmRemove();
  await waitFor(() => expect(resets).toEqual([{ index: 0, routes: [{ name: 'Welcome' }] }]));
  expect(useMachinesStore.getState().machines).toEqual([]);
  expect(mockEvents).toEqual(['registerPushToken unregister m1 (record saved)', 'disconnect m1']);
});

test('before the first notification ask was answered nothing is asked, and the text says nothing changes on the computer', async () => {
  await renderScreen(NOT_ASKED);
  await openRemove();
  expect(
    screen.getByText(
      'Mac mini is removed from this phone, along with its saved password and pairing key. Nothing changes on the computer.',
    ),
  ).toBeTruthy();
  await confirmRemove();
  await waitFor(() => expect(useMachinesStore.getState().machines).toEqual([]));
  expect(mockEvents).toEqual(['disconnect m1']);
});

test('the open confirm says what removing does once the first ask is answered, and removing then asks the computer', async () => {
  await renderScreen(NOT_ASKED);
  await openRemove();
  const before =
    'Mac mini is removed from this phone, along with its saved password and pairing key. Nothing changes on the computer.';
  expect(screen.getByText(before)).toBeTruthy();
  await act(async () => {
    await runFirstAsk(
      { current: async () => 'denied', request: async () => 'denied' },
      {
        get: () => useSettingsStore.getState().settings.notifications,
        set: (next) => useSettingsStore.getState().setSetting('notifications', next),
      },
      () => new Date(0),
    );
  });
  expect(
    screen.getByText(
      'Mac mini is removed from this phone, along with its saved password and pairing key. If Mac mini can be reached, it also stops sending push notifications. Nothing else changes on the computer.',
    ),
  ).toBeTruthy();
  expect(screen.queryByText(before)).toBeNull();
  await confirmRemove();
  await waitFor(() => expect(useMachinesStore.getState().machines).toEqual([]));
  expect(mockEvents).toEqual(['registerPushToken unregister m1 (record saved)', 'disconnect m1']);
});

test('a computer that does not answer is removed after the bounded wait, without its removal going out later', async () => {
  const route = Promise.withResolvers<void>();
  mockLink.routeGate = route.promise;
  await renderScreen(ANSWERED);
  await openRemove();
  await confirmRemove();
  expect(useMachinesStore.getState().machines).toEqual([MACHINE]);
  await waitFor(() => expect(useMachinesStore.getState().machines).toEqual([]), {
    timeout: REMOVAL_WAIT_MS + 1_000,
  });
  mockLink.routeGate = null;
  route.resolve();
  await waitFor(() => expect(mockEvents).toEqual(['disconnect m1']));
});
