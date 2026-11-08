/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. The attention list's entry: the bell on the Sessions screen carries the number of
 * sessions under Needs you as a figure, not as a colour alone, counted across every enabled computer from its session
 * list; finished and failed sessions do not count, and with nothing waiting it shows no number. A number that holds a
 * wait of a computer that cannot be reached is marked as last known ("2?"); one of current waits only is not. The probe
 * composes the bell exactly as `SessionsScreen` does: `useNeedsYouCount` into `bellLabel` and `BellWithCount`. Session
 * lists are fed through the inventory store, as its reads do.
 */

import { Pressable } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';

import { parseMobileSummary, type GhostexMobileSummary } from '../contract/mobileSummary';
import { useInventoryStore, type MachineInventory } from '../inventory/store';
import { useMachinesStore, type MachineRecord } from '../machines/store';
import type { FeedRow } from './feedContract';
import { useAttentionFeedStore } from './feedStore';
import { bellLabel, BellWithCount, useNeedsYouCount } from './NotificationsBell';

// Boundaries only: the native module and expo-notifications (nothing here calls them) and storage.
jest.mock('../../modules/ghostex-native/src', () => ({ GhostexNative: {} }));
jest.mock('expo-notifications', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

/** The badge is drawn for the eye; VoiceOver reads the count from the button's label, so it is hidden there. */
const SHOWN = { includeHiddenElements: true };

const computer = (id: string): MachineRecord => ({
  id,
  name: id,
  host: `${id}.local`,
  username: 'me',
  port: 22,
  savePassword: false,
  lastConnectedAt: null,
});

/** A computer's session list: `waiting` sessions wait for the user, `idle` ones do not. */
function list(waiting: string[], idle: string[] = []): MachineInventory {
  const summary: GhostexMobileSummary | null = parseMobileSummary(
    JSON.stringify({
      sessions: [
        ...waiting.map((sessionId) => ({
          sessionId,
          projectId: 'p1',
          provider: 'zmx',
          activity: 'attention',
          attention: { kind: 'needsInput', enteredAt: '2026-11-07T10:00:00Z' },
        })),
        ...idle.map((sessionId) => ({ sessionId, projectId: 'p1', provider: 'zmx', activity: 'idle' })),
      ],
    }),
  );
  // Only `summary` of the inventory is read by the bell.
  return { summary } as unknown as MachineInventory;
}

function finished(id: string, sessionId: string, kind: FeedRow['kind'] = 'finished'): FeedRow {
  return {
    id,
    projectId: 'p1',
    sessionId,
    kind,
    title: 'Session',
    subtitle: 'ghostex-mobile',
    agentName: 'claude',
    createdAt: '2026-11-07T10:00:00.000Z',
    read: false,
  };
}

function SessionsBell() {
  const needsYou = useNeedsYouCount();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={bellLabel(needsYou)}>
      <BellWithCount size={22} color="white" count={needsYou} />
    </Pressable>
  );
}

beforeEach(() => {
  useMachinesStore.setState({ machines: [computer('m1'), computer('m2')] });
  useInventoryStore.setState({ inventoriesByMachineId: {} });
  useAttentionFeedStore.setState({ feeds: {}, permission: null });
});

test('the bell counts the sessions under Needs you on every computer, not the Done or Failed ones', async () => {
  useInventoryStore.setState({
    inventoriesByMachineId: { m1: list(['a', 'b'], ['done', 'failed']), m2: list(['c'], ['d']) },
  });
  useAttentionFeedStore.setState({
    feeds: {
      m1: { status: 'ready', rows: [finished('n1', 'done'), finished('n2', 'failed', 'failed'), finished('n3', 'a')] },
      m2: { status: 'ready', rows: [finished('n4', 'd')] },
    },
  });
  await render(<SessionsBell />);
  expect(screen.getByRole('button').props.accessibilityLabel).toBe('Notifications, 3 need you');
  expect(screen.getByText('3', SHOWN)).toBeTruthy();
});

test('with nothing waiting the bell shows no number, however many sessions finished', async () => {
  useInventoryStore.setState({ inventoriesByMachineId: { m1: list([], ['done']) } });
  useAttentionFeedStore.setState({ feeds: { m1: { status: 'ready', rows: [finished('n1', 'done')] } } });
  await render(<SessionsBell />);
  expect(screen.getByRole('button').props.accessibilityLabel).toBe('Notifications');
  expect(screen.queryByText(/^\d+\+?$/, SHOWN)).toBeNull();
});

test("the number follows the session lists (a wait answered anywhere leaves it); a hidden computer's waits do not count", async () => {
  useInventoryStore.setState({ inventoriesByMachineId: { m1: list(['a', 'b']) } });
  await render(<SessionsBell />);
  expect(screen.getByText('2', SHOWN)).toBeTruthy();
  await act(() => {
    useInventoryStore.setState({ inventoriesByMachineId: { m1: list(['b'], ['a']) } });
  });
  expect(screen.getByText('1', SHOWN)).toBeTruthy();
  expect(screen.getByRole('button').props.accessibilityLabel).toBe('Notifications, 1 need you');
  await act(() => {
    useMachinesStore.setState({ machines: [{ ...computer('m1'), disabled: true }, computer('m2')] });
  });
  expect(screen.getByRole('button').props.accessibilityLabel).toBe('Notifications');
});

test('a number holding a wait of a computer that cannot be reached is marked as last known, until it answers again', async () => {
  useInventoryStore.setState({ inventoriesByMachineId: { m1: list(['a']), m2: list(['c']) } });
  useAttentionFeedStore.setState({
    feeds: { m1: { status: 'ready', rows: [] }, m2: { status: 'unreachable', rows: [] } },
  });
  await render(<SessionsBell />);
  expect(screen.getByRole('button').props.accessibilityLabel).toBe('Notifications, last known count 2');
  expect(screen.getByText('2?', SHOWN)).toBeTruthy();
  await act(() => {
    useAttentionFeedStore.setState({ feeds: { m1: { status: 'ready', rows: [] }, m2: { status: 'ready', rows: [] } } });
  });
  expect(screen.getByRole('button').props.accessibilityLabel).toBe('Notifications, 2 need you');
  expect(screen.getByText('2', SHOWN)).toBeTruthy();
});

test('a computer that cannot be reached and holds no wait leaves a number of current waits unmarked', async () => {
  useInventoryStore.setState({
    inventoriesByMachineId: { m1: list(['a']), m2: { ...list([], ['d']), lastError: 'unreachable' } as MachineInventory },
  });
  useAttentionFeedStore.setState({ feeds: { m1: { status: 'ready', rows: [] }, m2: { status: 'unreachable', rows: [] } } });
  await render(<SessionsBell />);
  expect(screen.getByRole('button').props.accessibilityLabel).toBe('Notifications, 1 need you');
  expect(screen.getByText('1', SHOWN)).toBeTruthy();
  expect(screen.queryByText('1?', SHOWN)).toBeNull();
});
