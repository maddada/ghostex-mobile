/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. The Unified list has no project header, so a session's long-press menu offers the
 * Actions… list of that session's computer and project: the same list the Project list's project menu opens, under
 * the same condition, running on the row's own computer. Drawn through the real Unified list, the real menu hook and
 * the real ContextMenu, wired the way SessionsScreen wires the two overlays.
 */

import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { EMPTY_AGENT_CHOICES } from '../../components/sessions/agentChoice';
import ContextMenu, { type ContextMenuItem } from '../../components/sessions/ContextMenu';
import { EMPTY_UNIFIED_FILTER } from '../../contract/unified/build';
import { parseMobileSummary, type GhostexMobileSummary } from '../../contract/mobileSummary';
import { emptyMachineInventory, useInventoryStore } from '../../inventory/store';
import type { MachineRecord } from '../../machines/store';
import { useSettingsStore } from '../../settings/store';
import { NONE, type Overlay, type SessionContext } from './session-actions';
import { useSessionsScreenMenus, type SessionsScreenMenusDeps } from './use-sessions-screen-menus';
import { useUnifiedList, useUnifiedListStore } from './use-unified-list';

jest.mock('../../../modules/ghostex-native/src', () => ({ GhostexNative: { addListener: () => ({ remove() {} }) } }));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../../updates/updateNotice', () => ({ useUpdateNotice: () => null }));
jest.mock('../../voice/VoiceButton', () => ({ voiceAgentOnFor: () => false }));
jest.mock('../../voice/conversation', () => ({ VOICE_SUPPORTED: false }));
jest.mock('../../voice/callAbout', () => ({ callVoiceAbout: jest.fn() }));
jest.mock('../../chat/rust/machine-link', () => ({ chatMachineLink: jest.fn() }));
// The card's swipe row needs Reanimated's native runtime: a plain row.
jest.mock('../machines-screen/SwipeRevealRow', () => {
  const { View: PlainRow } = jest.requireActual('react-native');
  return { __esModule: true, default: PlainRow, SWIPE_REVEAL_WIDTH: 176 };
});
jest.mock('react-native-safe-area-context', () => {
  const { View: PlainView } = jest.requireActual('react-native');
  return { useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }), SafeAreaView: PlainView };
});

/** The jest preset's `measureInWindow`, which answers nothing unless a test says what; a long press measures the card. */
const measureInWindow = jest.requireActual<{ default: { measureInWindow: jest.Mock } }>(
  '@react-native/jest-preset/jest/MockNativeMethods',
).default.measureInWindow;

function machineOf(id: string, name: string): MachineRecord {
  return { id, name, host: `${id}.local`, username: 'me', port: 22, savePassword: false, lastConnectedAt: null };
}

const MAC = machineOf('m1', 'Mac');
const STUDIO = machineOf('m2', 'Studio');

function wireSession(sessionId: string, projectId: string, title: string) {
  return {
    sessionId,
    projectId,
    title,
    agentIcon: 'claude',
    agentName: 'Claude',
    status: 'running',
    activity: 'idle',
    isLive: true,
    provider: 'zmx',
  };
}

function summaryOf(json: object): GhostexMobileSummary {
  const summary = parseMobileSummary(JSON.stringify({ ok: true, sidebarView: 'unified', ...json }));
  if (summary === null) throw new Error('fixture does not parse');
  return summary;
}

/**
 * Both computers have a project `P1` with a project action `test`; only the Studio offers Global Actions. On the Mac,
 * `P3` has no action at all, so its session's menu has no Actions…, and `P2`, with an action, sits in a saved
 * collection.
 */
const MAC_SUMMARY = summaryOf({
  projects: [
    { projectId: 'P1', name: 'Mac Project', path: '/mac/project' },
    { projectId: 'P2', name: 'Collected Project', path: '/mac/collected' },
    { projectId: 'P3', name: 'Quiet Project', path: '/mac/quiet' },
  ],
  sessions: [wireSession('a', 'P1', 'Alpha'), wireSession('g', 'P2', 'Gamma'), wireSession('q', 'P3', 'Quiet')],
  quickActionsByProject: {
    P1: [{ actionType: 'terminal', commandId: 'test', name: 'Mac Tests' }],
    P2: [{ actionType: 'terminal', commandId: 'lint', name: 'Collected Lint' }],
  },
  sidebarProjectCollections: {
    order: ['c1'],
    collections: { c1: { title: 'Work', color: '#3366cc', projectIds: ['P2'] } },
  },
});
const STUDIO_SUMMARY = summaryOf({
  projects: [{ projectId: 'P1', name: 'Studio Project', path: '/studio/project' }],
  sessions: [wireSession('b', 'P1', 'Beta')],
  quickActionsByProject: { P1: [{ actionType: 'terminal', commandId: 'test', name: 'Studio Tests' }] },
  globalQuickActions: [{ actionType: 'terminal', commandId: 'build', name: 'Studio Build' }],
  capabilities: { globalQuickActions: true },
});

const runQuickAction = jest.fn();
/** The last session menu the Unified list opened. */
let openedSessionMenu: SessionContext | null = null;
/** The menu hook's session menu, kept to draw the Project list's menu of the same session. */
let sessionMenuView: ((ctx: SessionContext, menuPath: readonly string[]) => { items: ContextMenuItem[] }) | null = null;

/** The Unified list and the two overlays as SessionsScreen draws them (`sessionMenu`, `actionsMenu`). */
function UnifiedHarness() {
  const [overlay, setOverlayState] = useState<Overlay>(NONE);
  const setOverlay = (next: Overlay): void => {
    if (next.kind === 'sessionMenu') openedSessionMenu = next.ctx;
    setOverlayState(next);
  };
  const inventoriesByMachineId = useInventoryStore((state) => state.inventoriesByMachineId);
  const deps: SessionsScreenMenusDeps = {
    entries: [],
    collapse: { collapseAllProjects: jest.fn(), expandAllProjects: jest.fn() },
    lastActionByProject: {},
    navigation: {} as SessionsScreenMenusDeps['navigation'],
    openSessionTerminal: jest.fn(),
    agentChoices: EMPTY_AGENT_CHOICES,
    agentChoiceContext: () => ({ scope: 'project', place: { project: null, space: null } }),
    setProgress: jest.fn(),
    reconnectMachine: jest.fn(),
    refreshAll: jest.fn(),
    refreshMachine: jest.fn(),
    runBulkSessionActions: jest.fn(),
    runCreationFlow: jest.fn(),
    runQuickAction,
    runSessionCommand: jest.fn(),
    sessionsForProject: () => [],
    setOverlay,
    setTransientStatus: jest.fn(),
    snoozeSession: jest.fn(),
  };
  const menus = useSessionsScreenMenus(deps);
  sessionMenuView = menus.sessionMenuView;
  const unified = useUnifiedList({
    machines: [MAC, STUDIO],
    selectedMachine: MAC,
    inventoriesByMachineId,
    selectedWorkspaceIdByMachine: {},
    selectedSessionKey: null,
    sidebarBackground: '#121212',
    focused: true,
    setOverlay,
    attach: async () => {},
    runBulkSessionActions: async () => {},
    snoozeSession: async () => {},
    openAddProject: () => {},
    notify: () => {},
  });
  return (
    <View>
      <FlatList data={unified.items} renderItem={unified.renderItem} keyExtractor={unified.keyExtractor} />
      {overlay.kind === 'sessionMenu' ? (
        <ContextMenu
          visible
          title={overlay.ctx.item.session.displayTitle}
          {...menus.sessionMenuView(overlay.ctx, overlay.menuPath)}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}
      {overlay.kind === 'actionsMenu' ? (
        <ContextMenu
          visible
          title={overlay.ctx.header.title}
          subtitle="Quick actions"
          items={menus.actionsMenuItems(overlay.ctx)}
          onClose={() => setOverlay(NONE)}
        />
      ) : null}
    </View>
  );
}

beforeEach(() => {
  runQuickAction.mockReset();
  openedSessionMenu = null;
  sessionMenuView = null;
  measureInWindow.mockImplementation((frame: (...values: number[]) => void) => frame(0, 100, 320, 60));
  useInventoryStore.setState({
    inventoriesByMachineId: {
      m1: { ...emptyMachineInventory(), summary: MAC_SUMMARY, serverSummary: MAC_SUMMARY },
      m2: { ...emptyMachineInventory(), summary: STUDIO_SUMMARY, serverSummary: STUDIO_SUMMARY },
    },
  });
  useUnifiedListStore.setState({ hydrated: true, filter: EMPTY_UNIFIED_FILTER, toggledShelves: [], foldedGroups: [] });
});

afterEach(() => {
  measureInWindow.mockReset();
});

async function longPress(title: string): Promise<void> {
  await act(async () => {
    fireEvent(screen.getByLabelText(title), 'longPress');
  });
}

async function press(label: string): Promise<void> {
  await act(async () => {
    fireEvent.press(screen.getByText(label));
  });
}

test("a Unified row's Actions… lists its project's and computer's actions and runs one on that computer", async () => {
  await render(<UnifiedHarness />);
  await longPress('Beta');
  expect(screen.getByText('Rename')).toBeTruthy();
  await press('Actions…');

  expect(screen.getByText('Studio Project')).toBeTruthy();
  expect(screen.getByText('Project Actions')).toBeTruthy();
  expect(screen.getByText('Studio Tests')).toBeTruthy();
  expect(screen.getByText('Global Actions')).toBeTruthy();
  expect(screen.getByText('Studio Build')).toBeTruthy();
  expect(screen.queryByText('Mac Tests')).toBeNull();

  await press('Studio Build');
  expect(runQuickAction).toHaveBeenCalledTimes(1);
  const [target, projectId, projectTitle, entry] = runQuickAction.mock.calls[0];
  expect(target.id).toBe('m2');
  expect(projectId).toBe('P1');
  expect(projectTitle).toBe('Studio Project');
  expect(entry.scope).toBe('global');
  expect(entry.action.commandId).toBe('build');
  expect(screen.queryByText('Studio Tests')).toBeNull();
});

test("the same project id on the other computer lists that computer's actions only", async () => {
  await render(<UnifiedHarness />);
  await longPress('Alpha');
  await press('Actions…');

  expect(screen.getByText('Mac Tests')).toBeTruthy();
  expect(screen.queryByText('Studio Tests')).toBeNull();
  expect(screen.queryByText('Global Actions')).toBeNull();

  await press('Mac Tests');
  const [target, projectId, , entry] = runQuickAction.mock.calls[0];
  expect(target.id).toBe('m1');
  expect(projectId).toBe('P1');
  expect(entry.scope).toBe('project');
  expect(entry.action.commandId).toBe('test');
});

test('a project with no action and a computer without Global Actions: no Actions… entry', async () => {
  await render(<UnifiedHarness />);
  await longPress('Quiet');
  expect(screen.getByText('Rename')).toBeTruthy();
  expect(screen.queryByText('Actions…')).toBeNull();
});

test("a project in a saved collection still offers its Actions… on the row's computer", async () => {
  expect(MAC_SUMMARY.projectCollections.map((collection) => collection.projectIds)).toEqual([['P2']]);
  await render(<UnifiedHarness />);
  await longPress('Gamma');
  await press('Actions…');

  expect(screen.getByText('Collected Project')).toBeTruthy();
  expect(screen.getByText('Collected Lint')).toBeTruthy();
  await press('Collected Lint');
  const [target, projectId, projectTitle, entry] = runQuickAction.mock.calls[0];
  expect(target.id).toBe('m1');
  expect(projectId).toBe('P2');
  expect(projectTitle).toBe('Collected Project');
  expect(entry.scope).toBe('project');
  expect(entry.action.commandId).toBe('lint');
});

test("the Project list's session menu stays without Actions…", async () => {
  await render(<UnifiedHarness />);
  await longPress('Beta');
  const ctx = openedSessionMenu;
  if (ctx === null || sessionMenuView === null) throw new Error('no session menu opened');
  const classic = sessionMenuView({ machine: ctx.machine, item: ctx.item }, []).items;
  const labels = classic.map((item) => ('label' in item ? item.label : null));
  expect(labels).toContain('Rename');
  expect(labels).not.toContain('Actions…');
});

describe("the list's clock while an agent works", () => {
  const START = new Date('2026-11-02T10:00:00.000Z');
  let renders = 0;

  /** The Unified list of one computer whose one session has worked for a minute, as SessionsScreen draws it. */
  function ClockHarness({ focused }: { focused: boolean }) {
    renders += 1;
    const inventoriesByMachineId = useInventoryStore((state) => state.inventoriesByMachineId);
    const unified = useUnifiedList({
      machines: [MAC],
      selectedMachine: MAC,
      inventoriesByMachineId,
      selectedWorkspaceIdByMachine: {},
      selectedSessionKey: null,
      sidebarBackground: '#121212',
      focused,
      setOverlay: () => {},
      attach: async () => {},
      runBulkSessionActions: async () => {},
      snoozeSession: async () => {},
      openAddProject: () => {},
      notify: () => {},
    });
    return <FlatList data={unified.items} renderItem={unified.renderItem} keyExtractor={unified.keyExtractor} />;
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: START });
    useSettingsStore.setState({ hydrated: true, settings: { ...useSettingsStore.getState().settings, sessionsListLayout: 'unified', sessionsListWorkingSection: true, sessionsListGroupByProject: false } });
    const working = summaryOf({
      projects: [{ projectId: 'P1', name: 'Mac Project', path: '/mac/project' }],
      sessions: [
        {
          ...wireSession('w', 'P1', 'Worker'),
          activity: 'working',
          workingStartedAt: new Date(START.getTime() - 60_000).toISOString(),
        },
      ],
    });
    useInventoryStore.setState({
      inventoriesByMachineId: { m1: { ...emptyMachineInventory(), summary: working, serverSummary: working } },
    });
    // The Moving shelf open, so its card and the card's timer are drawn.
    useUnifiedListStore.setState({ hydrated: true, toggledShelves: ['working'] });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('in front it counts each second; behind another screen it does not wake; back in front it reads the time', async () => {
    const view = await render(<ClockHarness focused />);
    expect(screen.getByText('1m 0s')).toBeTruthy();
    await act(() => jest.advanceTimersByTime(1_000));
    expect(screen.getByText('1m 1s')).toBeTruthy();

    await view.rerender(<ClockHarness focused={false} />);
    const behind = renders;
    for (let second = 0; second < 10; second += 1) await act(() => jest.advanceTimersByTime(1_000));
    expect(renders).toBe(behind);

    await view.rerender(<ClockHarness focused />);
    expect(screen.getByText('1m 11s')).toBeTruthy();
  });
});
