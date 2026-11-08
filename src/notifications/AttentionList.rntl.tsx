/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. The attention list as it is drawn, as a state inbox: one row per session in Needs you
 * (longest wait first, "has a question" for a pending question), Done and Failed, account notices last; opening a
 * row marks its session's unread rows read on the computer, never its failure rows; a long press opens the row's menu
 * at the held row (Open Session, Mark as Done on a Failed row; an account row keeps Mark as Read / Unread and Clear),
 * the row lifted above the dimmed screen (`rowMenuOrigin`); an ended session's row opens the "Session ended" sheet
 * instead of the session, and a stored removal holds before the settings load. Accessibility: each command, the lifted
 * row and a Close menu button are their own accessibility elements, none grouped into an ancestor that iOS would read
 * as one element.
 *
 * The real `AttentionList`, list model, `ContextMenu`, `BottomSheet` and stores; mocked are the boundaries only: the
 * native module, expo-notifications, storage, the safe area and the requests to the computer (`updateAttentionFeed`,
 * `markAttentionRowsRead`, `refreshAttentionFeeds`, `restoreEndedSession`). The test renderer lays nothing out, so the
 * held row's window frame comes from the native `measureInWindow` and the menu card's height from a fired `onLayout`.
 * Window: an iPhone 17 (402x874).
 */

import { Dimensions, Platform, StyleSheet } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import type { TestInstance } from 'test-renderer';

import { NotificationsCopy } from '../copy';
import type { GhostexMobileSummary } from '../contract/mobileSummary';
import { useInventoryStore, type MachineInventory } from '../inventory/store';
import { useMachinesStore, type MachineRecord } from '../machines/store';
import type { ClosedSession } from '../sessions/sessionSearch';
import { SidebarPalette } from '../theme/palette';
import { defaultSettings, useSettingsStore } from '../settings/store';
import { THEME_PRESETS, themePresetPatch } from '../theme/presets';
import { resolveAppearance } from '../theme/useAppearance';
import AttentionList from './AttentionList';
import type { FeedRow } from './feedContract';
import {
  markAttentionRowsRead,
  restoreEndedSession,
  updateAttentionFeed,
  useAttentionFeedStore,
} from './feedStore';

/** The native methods React Native's Jest preset gives every View (`measureInWindow` measures nothing). */
const mockNativeMethods = jest.requireActual<{ default: { measureInWindow: jest.Mock } }>(
  '@react-native/jest-preset/jest/MockNativeMethods',
).default;

/**
 * A menu command's role: a button on iOS, `menuitem` on Android (`ContextMenu.tsx`); `android/*.onAndroid.rntl.tsx`
 * runs these tests with React Native reporting Android.
 */
const COMMAND = Platform.OS === 'ios' ? 'button' : 'menuitem';

jest.mock('../../modules/ghostex-native/src', () => ({ GhostexNative: {} }));
jest.mock('expo-notifications', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('./feedStore', () => ({
  ...jest.requireActual('./feedStore'),
  updateAttentionFeed: jest.fn(() => Promise.resolve(true)),
  markAttentionRowsRead: jest.fn(() => Promise.resolve(true)),
  refreshAttentionFeeds: jest.fn(() => Promise.resolve()),
  restoreEndedSession: jest.fn(() => Promise.resolve(true)),
}));

const update = jest.mocked(updateAttentionFeed);
const markRead = jest.mocked(markAttentionRowsRead);
const restore = jest.mocked(restoreEndedSession);

const MACHINE: MachineRecord = {
  id: 'm1',
  name: 'Mac mini',
  host: 'mac-mini.local',
  username: 'owner',
  port: 22,
  savePassword: false,
  lastConnectedAt: null,
};

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function feedRow(id: string, minutes: number, fields: Partial<FeedRow>): FeedRow {
  return {
    id,
    projectId: 'p1',
    sessionId: `s-${id}`,
    kind: 'finished',
    title: '',
    subtitle: '',
    agentName: 'claude',
    createdAt: minutesAgo(minutes),
    read: false,
    ...fields,
  };
}

/** The feed as the computer sends it, newest first. */
const FEED: FeedRow[] = [
  // Rows of s1, which waits on two pending questions: under Needs you once, whatever its rows say.
  feedRow('n1', 1, { kind: 'needsInput', sessionId: 's1' }),
  feedRow('n8', 3, { kind: 'finished', sessionId: 's1' }),
  feedRow('n2', 6, { kind: 'failed', sessionId: 's6' }),
  feedRow('n3', 14, {
    kind: 'resetExpiring',
    sessionId: 'account:work',
    accountId: 'work',
    title: 'Claude reset expires in 22 hours',
    subtitle: 'Claude · Work',
    agentName: '',
  }),
  feedRow('n4', 21, { kind: 'finished', sessionId: 's3' }),
  // Read: s4 is under no section.
  feedRow('n5', 60, { kind: 'finished', sessionId: 's4', read: true }),
  feedRow('n6', 120, { kind: 'needsInput', sessionId: 's2', read: true }),
  feedRow('n7', 180, { kind: 'needsInput', sessionId: 's9', subtitle: 'ghostex', read: true }),
];

function session(
  sessionId: string,
  agent: string,
  projectName: string,
  displayTitle: string,
  wait: { since: number; questions?: number; card?: boolean; approval?: boolean } | null = null,
) {
  return {
    sessionId,
    projectId: 'p1',
    projectName,
    displayTitle,
    agent,
    agentName: agent,
    agentIcon: '',
    activity: wait === null ? 'idle' : 'attention',
    attentionKind: wait === null ? '' : 'needsInput',
    attentionEnteredAt: wait === null ? '' : minutesAgo(wait.since),
    attentionEventId: '',
    pendingQuestionCount: wait?.questions ?? 0,
    awaitingAnswer: wait?.card === true,
    awaitingApproval: wait?.approval === true,
  };
}

// A partial session list: the cast holds for the fields the attention list reads from it (each session's id, agent,
// project, title, activity, attention and question fields, and the summary's capabilities); the rest stays unset.
const SUMMARY = {
  agents: [],
  capabilities: { awaitingAnswer: true, attentionNotificationId: true },
  sessions: [
    session('s1', 'Claude Code', 'ghostex-mobile', 'Duo layout spike', { since: 30, questions: 2 }),
    session('s6', 'Codex', 'ghostex-mobile', 'Theme notices'),
    session('s3', 'Claude Code', 'ghostex', 'Feed stream'),
    session('s4', 'Codex', 'ghostex-mobile', 'Key repeat'),
    session('s2', 'Codex', 'ghostex-mobile', 'Pad tests', { since: 10 }),
    session('s9', 'Claude Code', 'ghostex', 'Spec notes', { since: 5, card: true }),
    session('s5', 'Codex', 'ghostex', 'Release script', { since: 2, approval: true }),
  ],
} as unknown as GhostexMobileSummary;

/** Every row the list draws, in order. */
const ALL_ROWS = ['s1', 's2', 's9', 's5', 's3', 's6', 'n3'];

/** The held row's frame in window points: a full-width row 200 pt from the top, 72 pt tall. */
const ROW_FRAME = { x: 0, y: 200, width: 402, height: 72 };

const rowIds = (within: { getAllByTestId: typeof screen.getAllByTestId }) =>
  within.getAllByTestId(/^attention-row-/).map((node) => String(node.props.testID).replace('attention-row-', ''));

/** The rows under a section title, in order: in the drawn tree each row follows its section's title. */
function sectionRows(title: string): string[] {
  const nodes =
    screen.root?.queryAll(
      (node) =>
        typeof node.type === 'string' &&
        (node.props.accessibilityRole === 'header' || /^attention-row-/.test(String(node.props.testID ?? ''))),
    ) ?? [];
  const rows: string[] = [];
  let inside = false;
  for (const node of nodes) {
    if (node.props.accessibilityRole === 'header') inside = node.props.children === title;
    else if (inside) rows.push(String(node.props.testID).replace('attention-row-', ''));
  }
  return rows;
}

/**
 * The menu card's position style: the nearest container of a menu command that has a `maxHeight`. A command
 * is a button on iOS (React Native's `menuitem` has no role there; `ContextMenu.tsx`).
 */
function cardStyle(item: string) {
  let card = screen.getByRole(COMMAND, { name: item }).parent;
  while (card !== null && StyleSheet.flatten(card.props.style)?.maxHeight === undefined) card = card.parent;
  if (card === null) throw new Error('no menu card');
  return { card, style: StyleSheet.flatten(card.props.style) };
}

/** Ancestors iOS reads as one accessibility element together with `node` (React Native's `accessible`). */
function groupingAncestors(node: TestInstance) {
  const grouping: string[] = [];
  for (let parent = node.parent; parent !== null; parent = parent.parent) {
    if (parent.props.accessible === true) grouping.push(String(parent.props.accessibilityLabel ?? parent.type));
  }
  return grouping;
}

/** The open menu's commands in order: the buttons in the card beside "Close menu". */
function menuLabels() {
  const card = screen
    .getByRole('button', { name: 'Close menu' })
    .parent?.children.find(
      (child) => typeof child !== 'string' && StyleSheet.flatten(child.props.style)?.maxHeight !== undefined,
    );
  if (card === undefined || typeof card === 'string') throw new Error('no menu card');
  return within(card)
    .getAllByRole(COMMAND)
    .map((command) => String(within(command).getByText(/./).props.children));
}

let opened: { machineId: string; sessionId: string; question: boolean }[] = [];

async function renderList() {
  opened = [];
  await render(<AttentionList onOpenSession={(target) => opened.push(target)} />);
}

beforeEach(async () => {
  update.mockClear();
  markRead.mockClear();
  restore.mockClear();
  // Test-only: the window React Native reports, read by the menu through `useWindowDimensions`; no code under
  // test reads `Dimensions`.
  await act(() => {
    Dimensions.set({
      window: { width: 402, height: 874, scale: 3, fontScale: 1 },
      screen: { width: 402, height: 874, scale: 3, fontScale: 1 },
    });
  });
  mockNativeMethods.measureInWindow.mockImplementation(
    (onFrame: (x: number, y: number, width: number, height: number) => void) =>
      onFrame(ROW_FRAME.x, ROW_FRAME.y, ROW_FRAME.width, ROW_FRAME.height),
  );
  useMachinesStore.setState({ machines: [MACHINE] });
  useInventoryStore.setState({
    // The list reads `summary` and `lastError` of the inventory (as SUMMARY above).
    inventoriesByMachineId: { m1: { summary: SUMMARY, lastError: null } as unknown as MachineInventory },
  });
  useSettingsStore.setState((state) => ({
    hydrated: true,
    settings: { ...state.settings, attentionRemovedSessions: [] },
  }));
  useAttentionFeedStore.setState({
    feeds: { m1: { status: 'ready', rows: FEED } },
    permission: 'granted',
    closed: {},
    restores: {},
  });
});

afterEach(() => {
  mockNativeMethods.measureInWindow.mockReset();
});

test('Needs you (longest wait first), Done, Failed, then account notices, each session once', async () => {
  await renderList();
  expect(rowIds(screen)).toEqual(ALL_ROWS);
  expect(sectionRows('Needs you')).toEqual(['s1', 's2', 's9', 's5']);
  expect(sectionRows('Done')).toEqual(['s3']);
  expect(sectionRows('Failed')).toEqual(['s6']);
  expect(sectionRows('Accounts')).toEqual(['n3']);

  expect(within(screen.getByTestId('attention-row-s6')).getByText('ended with an error')).toBeTruthy();
  expect(within(screen.getByTestId('attention-row-s6')).getByText('Codex · ghostex-mobile')).toBeTruthy();
  expect(within(screen.getByTestId('attention-row-s3')).getByText('finished · not opened')).toBeTruthy();
  expect(within(screen.getByTestId('attention-row-s5')).getByText('Waiting for approval')).toBeTruthy();
  // The account row is named by the account.
  expect(within(screen.getByTestId('attention-row-n3')).getByText('reset expiring')).toBeTruthy();
  expect(within(screen.getByTestId('attention-row-n3')).getByText('Claude · Work')).toBeTruthy();
  // VoiceOver hears the state as a word, not a colour.
  expect(screen.getByTestId('attention-row-s6').props.accessibilityLabel).toMatch(
    /^Codex · ghostex-mobile, ended with an error\. Theme notices\. 6m ago\.$/,
  );
  expect(screen.getByTestId('attention-row-n3').props.accessibilityLabel).toMatch(/^Unread\. /);
});

test('a waiting session says "has a question" with a pending question, "waiting" without one', async () => {
  await renderList();
  expect(within(screen.getByTestId('attention-row-s1')).getByText('has a question')).toBeTruthy();
  expect(within(screen.getByTestId('attention-row-s9')).getByText('has a question')).toBeTruthy();
  expect(within(screen.getByTestId('attention-row-s2')).getByText('waiting')).toBeTruthy();
  expect(within(screen.getByTestId('attention-row-s2')).queryByText('has a question')).toBeNull();
});

test("opening a row marks its session's unread rows read and opens it; a question row asks for the question card", async () => {
  await renderList();
  await fireEvent.press(screen.getByTestId('attention-row-s1'));
  expect(markRead.mock.calls).toEqual([['m1', ['n1', 'n8']]]);
  expect(opened).toEqual([{ machineId: 'm1', sessionId: 's1', question: true }]);

  // A wait without unread rows only opens; an account row has no session and is only marked read.
  markRead.mockClear();
  await fireEvent.press(screen.getByTestId('attention-row-s2'));
  await fireEvent.press(screen.getByTestId('attention-row-n3'));
  expect(markRead).not.toHaveBeenCalled();
  expect(update.mock.calls).toEqual([['m1', { action: 'markRead', notificationId: 'n3' }]]);
  expect(opened.slice(1)).toEqual([{ machineId: 'm1', sessionId: 's2', question: false }]);
});

describe('a message the computer could not send (sendFailed)', () => {
  test('"not sent" with a red glyph under Failed; a tap opens its session and leaves the failure unread', async () => {
    // The desktop's bell draws a sendFailed row "Not sent" in the urgent red (`GpuiNotificationFeedKind::SendFailed`).
    useAttentionFeedStore.setState({
      feeds: { m1: { status: 'ready', rows: [feedRow('n9', 2, { kind: 'sendFailed', sessionId: 's4' }), ...FEED] } },
    });
    await renderList();
    expect(sectionRows('Failed')).toEqual(['s4', 's6']);
    const row = screen.getByTestId('attention-row-s4');
    expect(row.props.accessibilityLabel).toMatch(/^Codex · ghostex-mobile, not sent\. Key repeat\. 2m ago\.$/);
    expect(StyleSheet.flatten(within(row).getByText('not sent').props.style).color).toBe(
      resolveAppearance(useSettingsStore.getState().settings, true).foreground,
    );
    const glyph = row.queryAll((node) => node.props.d === 'M 12 4 L 21 19.5 H 3 Z M 12 10 v 4');
    expect(glyph).toHaveLength(1);
    const stroke: unknown = glyph[0]?.props.stroke;
    if (typeof stroke !== 'object' || stroke === null || !('payload' in stroke) || typeof stroke.payload !== 'number') {
      throw new Error('The state glyph must have a native colour brush.');
    }
    expect(stroke.payload & 0xffffff).toBe(Number.parseInt(SidebarPalette.MENU_DANGER.slice(1), 16));

    await fireEvent.press(row);
    expect(markRead).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(opened).toEqual([{ machineId: 'm1', sessionId: 's4', question: false }]);
    expect(sectionRows('Failed')).toEqual(['s4', 's6']);
  });
});

test('a long press opens the menu at the held row, under it, the row lifted; a Failed row offers Mark as Done', async () => {
  await renderList();
  await fireEvent(screen.getByTestId('attention-row-s6'), 'longPress');

  expect(menuLabels()).toEqual(['Open Session', 'Mark as Done']);

  // The card appears once its height is known, then stands under the row: the row spans the window, so it
  // is lifted as a card 8 pt in from each edge and the menu's leading edge lines up with it, 8 pt below.
  const before = cardStyle('Mark as Done');
  expect(before.style.opacity).toBe(0);
  await fireEvent(before.card, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 160 } } });
  const { style } = cardStyle('Mark as Done');
  expect({ position: style.position, left: style.left, top: style.top, opacity: style.opacity }).toEqual({
    position: 'absolute',
    left: 8,
    top: ROW_FRAME.y + ROW_FRAME.height + 8,
    opacity: 1,
  });
  // The list's own row and its lifted copy above the dimmed screen carry the same label; the copy has no testID.
  const lifted = screen
    .getAllByRole('button', { name: /^Codex · ghostex-mobile, ended with an error\./ })
    .filter((node) => node.props.testID === undefined);
  expect(lifted).toHaveLength(1);
  expect(StyleSheet.flatten(lifted[0].props.style)).toMatchObject({ left: 8, top: 200, width: 386, height: 72 });

  // Mark as Done marks the failure rows read on the computer and closes the menu.
  await fireEvent.press(screen.getByRole(COMMAND, { name: 'Mark as Done' }));
  expect(markRead.mock.calls).toEqual([['m1', ['n2']]]);
  expect(opened).toEqual([]);
  expect(screen.queryByRole('button', { name: 'Close menu' })).toBeNull();
});

test('each command, the lifted row and Close menu are separate accessibility elements', async () => {
  await renderList();
  await fireEvent(screen.getByTestId('attention-row-s6'), 'longPress');
  expect(menuLabels()).toEqual(['Open Session', 'Mark as Done']);
  for (const name of ['Open Session', 'Mark as Done']) {
    const command = screen.getByRole(COMMAND, { name });
    expect(command.props.accessibilityState).toEqual({ disabled: false, selected: false });
    expect(groupingAncestors(command)).toEqual([]);
  }
  const lifted = screen
    .getAllByRole('button', { name: /^Codex · ghostex-mobile, ended with an error\./ })
    .filter((node) => node.props.testID === undefined);
  expect(groupingAncestors(lifted[0])).toEqual([]);

  const close = screen.getByRole('button', { name: 'Close menu' });
  expect(groupingAncestors(close)).toEqual([]);
  await fireEvent.press(close);
  expect(screen.queryByRole('button', { name: 'Close menu' })).toBeNull();
  expect(update).not.toHaveBeenCalled();
  expect(markRead).not.toHaveBeenCalled();
});

test('Needs you and Done rows offer Open Session only; an account row keeps Mark as Read / Unread and Clear', async () => {
  await renderList();

  await fireEvent(screen.getByTestId('attention-row-s3'), 'longPress');
  expect(menuLabels()).toEqual(['Open Session']);
  await fireEvent.press(screen.getByRole(COMMAND, { name: 'Open Session' }));
  expect(markRead.mock.calls).toEqual([['m1', ['n4']]]);
  expect(opened).toEqual([{ machineId: 'm1', sessionId: 's3', question: false }]);

  await fireEvent(screen.getByTestId('attention-row-s2'), 'longPress');
  expect(menuLabels()).toEqual(['Open Session']);
  await fireEvent.press(screen.getByRole('button', { name: 'Close menu' }));

  await fireEvent(screen.getByTestId('attention-row-n3'), 'longPress');
  expect(menuLabels()).toEqual(['Mark as Read', 'Clear']);
  await fireEvent.press(screen.getByRole(COMMAND, { name: 'Clear' }));
  expect(update.mock.calls.at(-1)).toEqual(['m1', { action: 'dismiss', notificationId: 'n3' }]);

  // The computer now has the account row read.
  await act(() => {
    useAttentionFeedStore.setState({
      feeds: { m1: { status: 'ready', rows: FEED.map((row) => (row.id === 'n3' ? { ...row, read: true } : row)) } },
    });
  });
  await fireEvent(screen.getByTestId('attention-row-n3'), 'longPress');
  expect(menuLabels()).toEqual(['Mark as Unread', 'Clear']);
  await fireEvent.press(screen.getByRole(COMMAND, { name: 'Mark as Unread' }));
  expect(update.mock.calls.at(-1)).toEqual(['m1', { action: 'markUnread', notificationId: 'n3' }]);
});

test('with nothing waiting Needs you says "Nothing needs you", and Done, Failed and Accounts stay below it', async () => {
  useInventoryStore.setState({
    inventoriesByMachineId: {
      m1: {
        // Every wait answered: no session is in attention, none holds a question or an approval.
        summary: {
          ...SUMMARY,
          sessions: SUMMARY.sessions.map((entry) => ({
            ...entry,
            activity: 'idle',
            pendingQuestionCount: 0,
            awaitingAnswer: false,
            awaitingApproval: false,
          })),
        },
        lastError: null,
      } as unknown as MachineInventory,
    },
  });
  await renderList();
  expect(screen.getByText('Nothing needs you')).toBeTruthy();
  expect(screen.getByText('No open approvals, questions or replies waiting for you.')).toBeTruthy();
  expect(sectionRows('Needs you')).toEqual([]);
  // s1's wait was answered; its unread finished row now puts it under Done.
  expect(sectionRows('Done')).toEqual(['s1', 's3']);
  expect(sectionRows('Failed')).toEqual(['s6']);
  expect(sectionRows('Accounts')).toEqual(['n3']);
});

test("a computer that cannot be reached keeps its rows as last known, with today's notice", async () => {
  useAttentionFeedStore.setState({ feeds: { m1: { status: 'unreachable', rows: FEED } } });
  await renderList();
  expect(screen.getByText(NotificationsCopy.offline('Mac mini'))).toBeTruthy();
  expect(rowIds(screen)).toEqual(ALL_ROWS);
  expect(within(screen.getByTestId('attention-row-s1')).getByText('has a question · last known')).toBeTruthy();
  expect(sectionRows('Needs you · last known')).toEqual(['s1', 's2', 's9', 's5']);
});

test('Needs you is titled as last known only while one of its waits comes from a computer that cannot be reached', async () => {
  // A second computer cannot be reached and holds no wait: the waits under Needs you are current.
  useMachinesStore.setState({ machines: [MACHINE, { ...MACHINE, id: 'm2', name: 'Studio' }] });
  useAttentionFeedStore.setState({
    feeds: { m1: { status: 'ready', rows: FEED }, m2: { status: 'unreachable', rows: [] } },
  });
  await renderList();
  expect(sectionRows('Needs you')).toEqual(['s1', 's2', 's9', 's5']);
  expect(screen.queryByText('Needs you · last known')).toBeNull();
  // Now the computer whose waits they are cannot be reached.
  await act(() => {
    useAttentionFeedStore.setState({
      feeds: { m1: { status: 'unreachable', rows: FEED }, m2: { status: 'ready', rows: [] } },
    });
  });
  expect(sectionRows('Needs you · last known')).toEqual(['s1', 's2', 's9', 's5']);
});

describe('an ended session', () => {
  const closed = (fields: Partial<ClosedSession> = {}): ClosedSession => ({
    projectId: 'p1',
    sessionId: 's7',
    projectTitle: 'ghostex',
    displayTitle: 'Import scanner',
    primaryTitle: '',
    terminalTitle: '',
    title: '',
    agentIcon: '',
    agentName: 'claude',
    sessionTag: '',
    isFavorite: false,
    closedAt: '2026-11-07T09:00:00.000Z',
    lastActiveAt: '2026-11-07T09:00:00.000Z',
    isRestorable: true,
    restoreUnavailableReason: '',
    externalSession: false,
    forkBranchCount: 0,
    ...fields,
  });

  beforeEach(() => {
    // s7 finished, and its computer lists it as closed.
    useAttentionFeedStore.setState({
      feeds: { m1: { status: 'ready', rows: [...FEED, feedRow('e1', 45, { kind: 'finished', sessionId: 's7' })] } },
      closed: { m1: [closed()] },
    });
  });

  test('reads Ended; its tap opens the "Session ended" sheet with Restore and Remove, never the session', async () => {
    await renderList();
    expect(sectionRows('Done')).toEqual(['s3', 's7']);
    expect(within(screen.getByTestId('attention-row-s7')).getByText('Ended')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('attention-row-s7'));
    expect(opened).toEqual([]);
    expect(markRead).not.toHaveBeenCalled();
    expect(screen.getByRole('header', { name: 'Session ended' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Restore' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: 'Restore' }));
    expect(restore.mock.calls).toEqual([['m1', closed()]]);
  });

  test('Remove asks first, then hides the row on this phone only, with no request to the computer', async () => {
    await renderList();
    await fireEvent.press(screen.getByTestId('attention-row-s7'));
    await fireEvent.press(screen.getByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('header', { name: 'Remove from this list?' })).toBeTruthy();
    expect(screen.getByText('The session and the bell on your computer stay as they are.')).toBeTruthy();
    expect(useSettingsStore.getState().settings.attentionRemovedSessions).toEqual([]);

    await fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('header', { name: 'Session ended' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Remove' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Remove' }));

    expect(useSettingsStore.getState().settings.attentionRemovedSessions).toEqual(['m1\ns7']);
    expect(screen.queryByTestId('attention-row-s7')).toBeNull();
    expect(update).not.toHaveBeenCalled();
    expect(markRead).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
  });

  test('a closed session the computer cannot restore offers Remove only', async () => {
    useAttentionFeedStore.setState({ closed: { m1: [closed({ isRestorable: false })] } });
    await renderList();
    await fireEvent.press(screen.getByTestId('attention-row-s7'));
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });

  test('while it restores the sheet says so and offers Close; a failed restore offers Try Again', async () => {
    useAttentionFeedStore.setState({ restores: { 'm1\ns7': 'running' } });
    await renderList();
    await fireEvent.press(screen.getByTestId('attention-row-s7'));
    expect(screen.getByRole('header', { name: 'Restoring session…' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();

    await act(() => {
      useAttentionFeedStore.setState({ restores: { 'm1\ns7': 'failed' } });
    });
    expect(screen.getByRole('header', { name: 'Couldn’t restore session' })).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Try Again' }));
    expect(restore.mock.calls).toEqual([['m1', closed()]]);
  });

  test('a session only missing from the session list is no Ended row: its tap opens it', async () => {
    useAttentionFeedStore.setState({ closed: {} });
    await renderList();
    expect(within(screen.getByTestId('attention-row-s7')).getByText('finished · not opened')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('attention-row-s7'));
    expect(opened).toEqual([{ machineId: 'm1', sessionId: 's7', question: false }]);
  });

  test('a stored removal holds before the settings load, also while the computer cannot be reached', async () => {
    // s7 was removed on this phone in an earlier run; its computer cannot be reached now, so its rows are last known.
    await AsyncStorage.setItem('settings.v1', JSON.stringify({ ...defaultSettings(), attentionRemovedSessions: ['m1\ns7'] }));
    useSettingsStore.setState({ hydrated: false, settings: defaultSettings() });
    useAttentionFeedStore.setState({
      feeds: { m1: { status: 'unreachable', rows: [...FEED, feedRow('e1', 45, { kind: 'finished', sessionId: 's7' })] } },
    });
    await renderList();
    // Until the settings load no Done or Failed row shows (any could be a removed one); Needs you and Accounts do.
    expect(rowIds(screen)).toEqual(['s1', 's2', 's9', 's5', 'n3']);
    await act(() => useSettingsStore.getState().hydrate());
    expect(rowIds(screen)).toEqual(ALL_ROWS);
    expect(screen.queryByTestId('attention-row-s7')).toBeNull();
  });
});

/** WCAG contrast of two `#rrggbb` colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5]
      .map((at) => parseInt(hex.slice(at, at + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * bl!;
  };
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** A row's identity and state word, as its accessibility label names them ("Unread. who, word."). */
function rowTexts(id: string) {
  const row = screen.getByTestId(`attention-row-${id}`);
  const [, who, word] = /^(?:Unread\. )?(.+?), (.+?)\./.exec(String(row.props.accessibilityLabel))!;
  const color = (text: string) => StyleSheet.flatten(within(row).getByText(text).props.style).color as string;
  return { who: color(who!), word: color(word!) };
}

describe("the rows in the appearance's colours", () => {
  const initialSettings = useSettingsStore.getState().settings;
  afterEach(async () => {
    await act(() => {
      useSettingsStore.setState({ settings: initialSettings });
    });
  });

  test.each(THEME_PRESETS.filter((preset) => preset.mode === 'light').map((preset) => preset.id))(
    'light preset %s: every identity and state word reads on the light row',
    async (preset) => {
      useSettingsStore.getState().patchSettings(themePresetPatch(preset, false)!);
      const page = resolveAppearance(useSettingsStore.getState().settings, true);
      await renderList();
      for (const id of ALL_ROWS) {
        const { who, word } = rowTexts(id);
        expect(contrast(who, page.card)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(word, page.card)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  test('dark: a plain identity keeps its dimmer ink and the state words their status colours', async () => {
    useSettingsStore.getState().patchSettings({ sidebarTheme: 'dark-2' });
    await renderList();
    expect(rowTexts('s3').who).toBe(SidebarPalette.FOREGROUND);
    expect(rowTexts('s2').word).toBe(SidebarPalette.ROW_ATTENTION);
    expect(rowTexts('s9').word).toBe(SidebarPalette.ROW_QUESTION);
    expect(rowTexts('s6').word).toBe(SidebarPalette.MENU_DANGER);
  });
});

/** `fill` (`#rrggbb` or `rgba(r,g,b,a)`) as it shows painted over the opaque `base`. */
function over(fill: string, base: string): string {
  if (fill.startsWith('#')) return fill;
  const [r, g, b, a] = fill.match(/[0-9.]+/g)!.map(Number);
  return `#${[r!, g!, b!]
    .map((channel, at) => Math.round(parseInt(base.slice(1 + 2 * at, 3 + 2 * at), 16) * (1 - a!) + channel * a!))
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')}`;
}

/** A row's texts by role, as its accessibility label names them ("Unread. who, word. detail. time."). */
function rowParts(row: TestInstance) {
  const parts = String(row.props.accessibilityLabel)
    .replace(/^Unread\. /, '')
    .replace(/\.$/, '')
    .split('. ');
  const [who, word] = parts[0]!.split(', ');
  const color = (text: string) => StyleSheet.flatten(within(row).getByText(text).props.style).color as string;
  return {
    who: color(who!),
    word: color(word!),
    time: color(parts.at(-1)!),
    detail: parts.length === 3 ? color(parts[1]!) : null,
  };
}

describe('secondary text reads on the surface it is drawn on', () => {
  const initialSettings = useSettingsStore.getState().settings;
  afterEach(async () => {
    await act(() => {
      useSettingsStore.setState({ settings: initialSettings });
    });
  });

  test.each(THEME_PRESETS.map((preset) => [preset.id, preset.mode] as const))(
    '%s (%s): every row keeps its time, detail and state word at 4.5:1 on its card or wash, pressed or not',
    async (preset, mode) => {
      useSettingsStore.getState().patchSettings(themePresetPatch(preset, false)!);
      const page = resolveAppearance(useSettingsStore.getState().settings, mode === 'light');
      await renderList();
      const failures: string[] = [];
      for (const id of ALL_ROWS) {
        const row = screen.getByTestId(`attention-row-${id}`);
        const rowFill = StyleSheet.flatten(row.props.style).backgroundColor as string;
        const surfaces = [over(rowFill, page.background), page.cardActive];
        const { time, detail, word } = rowParts(row);
        // The state word: a status colour (has a question, waiting, approval, an error, reset expiring) or, for a
        // finished session, the secondary ink on a dark row; the foreground on a light one.
        const texts = { time, detail, word };
        for (const [name, color] of Object.entries(texts)) {
          if (color === null) continue;
          for (const surface of surfaces) {
            const ratio = contrast(color, surface);
            if (ratio < 4.5) failures.push(`${id} ${name} ${color} on ${surface}: ${ratio.toFixed(2)}`);
          }
        }
      }
      expect(failures).toEqual([]);
    },
  );

  test.each(['latte', 'tn-day', 'mocha', 'nord'])(
    '%s in a pane: the list body paints the page colour its ink is made for, as on the full screen',
    async (preset) => {
      const light = THEME_PRESETS.find((entry) => entry.id === preset)!.mode === 'light';
      useSettingsStore.getState().patchSettings(themePresetPatch(preset, false)!);
      const page = resolveAppearance(useSettingsStore.getState().settings, light);
      await render(
        <AttentionList
          pane={{ controlInset: { left: 0, right: 0 } }}
          onOpenSession={(target) => opened.push(target)}
        />,
      );
      // The nearest painted ancestor of the list's content: the pane card under it is the terminal's black.
      let body = screen.getByRole('header', { name: 'Needs you' }).parent;
      while (body !== null && StyleSheet.flatten(body.props.style)?.backgroundColor === undefined) body = body.parent;
      expect(body === null ? null : StyleSheet.flatten(body.props.style).backgroundColor).toBe(page.background);
      const title = StyleSheet.flatten(screen.getByRole('header', { name: 'Needs you' }).props.style).color as string;
      expect(contrast(title, page.background)).toBeGreaterThanOrEqual(4.5);
    },
  );

  test.each(THEME_PRESETS.map((preset) => [preset.id, preset.mode] as const))(
    "%s (%s): the lifted row's text reads on the menu's dark card",
    async (preset, mode) => {
      useSettingsStore.getState().patchSettings(themePresetPatch(preset, false)!);
      await renderList();
      const failures: string[] = [];
      for (const id of ['s6', 's3']) {
        await fireEvent(screen.getByTestId(`attention-row-${id}`), 'longPress');
        const label = String(screen.getByTestId(`attention-row-${id}`).props.accessibilityLabel);
        const lifted = screen.getAllByLabelText(label).find((node) => node.props.testID === undefined)!;
        const card = StyleSheet.flatten(lifted.props.style).backgroundColor as string;
        for (const [name, color] of Object.entries(rowParts(lifted))) {
          if (color === null) continue;
          const ratio = contrast(color, card);
          if (ratio < 4.5) failures.push(`${mode} ${id} ${name} ${color} on ${card}: ${ratio.toFixed(2)}`);
        }
        await fireEvent.press(screen.getByRole('button', { name: 'Close menu' }));
      }
      expect(failures).toEqual([]);
    },
  );

  test.each(THEME_PRESETS.map((preset) => [preset.id, preset.mode] as const))(
    '%s (%s): the line for a change the computer did not take keeps 4.5:1 on the list page',
    async (preset) => {
      useSettingsStore.getState().patchSettings(themePresetPatch(preset, false)!);
      markRead.mockResolvedValueOnce(false);
      await renderList();
      // Opening a session with unread rows marks them read on the computer, which says no.
      await fireEvent.press(screen.getByTestId('attention-row-s1'));
      await act(async () => undefined);
      const line = screen.getByText(NotificationsCopy.actionFailed);
      let page = line.parent;
      while (page !== null && !String(StyleSheet.flatten(page.props.style)?.backgroundColor ?? '').startsWith('#')) {
        page = page.parent;
      }
      const surface = String(StyleSheet.flatten(page!.props.style).backgroundColor);
      const ink = StyleSheet.flatten(line.props.style).color as string;
      expect(contrast(ink, surface)).toBeGreaterThanOrEqual(4.5);
    },
  );
});
