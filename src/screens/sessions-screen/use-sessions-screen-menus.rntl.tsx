/// <reference types="jest" />
/**
 * Run with `bun run test:jest`. The project menu and its Actions… list, through the real menu hook: Global Actions
 * appear only while the computer's current summary offers them, also in a menu that is already open, and the tapped
 * entry keeps its scope.
 */

import { act, renderHook } from '@testing-library/react-native';

import { takeLaunchDraft } from '../../chat/native/sessionShell';

import { buildDrawerItems, type ProjectHeaderItem } from '../../contract/grouping';
import { parseMobileSummary, withoutGlobalQuickActions, type GhostexMobileSummary } from '../../contract/mobileSummary';
import { EMPTY_AGENT_CHOICES } from '../../components/sessions/agentChoice';
import { useLauncherStore } from '../../components/sessions/launcherStore';
import { emptyMachineInventory, useInventoryStore } from '../../inventory/store';
import type { MachineRecord } from '../../machines/store';
import { useSessionsScreenMenus, type SessionsScreenMenusDeps } from './use-sessions-screen-menus';

jest.mock('../../../modules/ghostex-native/src', () => ({ GhostexNative: { addListener: () => ({ remove() {} }) } }));
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../../updates/updateNotice', () => ({ useUpdateNotice: () => null }));
jest.mock('../../voice/VoiceButton', () => ({ voiceAgentOnFor: () => false }));
jest.mock('../../voice/conversation', () => ({ VOICE_SUPPORTED: false }));
jest.mock('../../voice/callAbout', () => ({ callVoiceAbout: jest.fn() }));
jest.mock('../../chat/rust/machine-link', () => ({ chatMachineLink: jest.fn() }));
/** Every command sent to the computer's CLI; a create answers with a session, the version check with a new computer. */
const mockRun = jest.fn(async (_machine: unknown, command: string) =>
  command.startsWith('ghostex create-agent ')
    ? { json: { session: { sessionId: 's-new' } }, stdout: '' }
    : { json: { health: { version: '99.0.0' } }, stdout: '' },
);
jest.mock('../../components/sessions/cli', () => ({
  ...jest.requireActual('../../components/sessions/cli'),
  runGhostexCli: (...args: [unknown, string]) => mockRun(...args),
}));
const mockRpc = jest.fn(async (_machine: unknown, _method: string, _params: unknown) => ({
  error: null,
  result: { content: 'Continue from the exported transcript' },
}));
jest.mock('../../chat/rust/transport', () => ({
  sessionChatRpc: (...args: [unknown, string, unknown]) => mockRpc(...args),
}));

const machine: MachineRecord = {
  id: 'm1',
  name: 'Mac',
  host: 'mac.local',
  username: 'me',
  port: 22,
  savePassword: false,
  lastConnectedAt: null,
};

const PROJECT_ACTIONS = { P1: [{ actionType: 'terminal', commandId: 'same', name: 'Project Tests' }] };
const GLOBALS = {
  globalQuickActions: [{ actionType: 'browser', commandId: 'same', name: 'Global Docs', url: 'https://example.com/' }],
  capabilities: { globalQuickActions: true },
};

function summaryOf(extra: object): GhostexMobileSummary {
  const summary = parseMobileSummary(
    JSON.stringify({ sessions: [], projects: [{ projectId: 'P1', name: 'Project', path: '/project' }], ...extra }),
  );
  if (summary === null) throw new Error('fixture does not parse');
  return summary;
}

/** The header the menu was opened from, built by the real drawer builder. */
function headerOf(summary: GhostexMobileSummary): ProjectHeaderItem {
  const header = buildDrawerItems({
    machineId: 'm1',
    summary,
    expandedProjectKeys: new Set(),
    expandedCollectionIds: new Set(),
    expandedGroupKeys: new Set(),
    collapsedSessionKindKeys: new Set(),
  }).find((item): item is ProjectHeaderItem => item.type === 'PROJECT_HEADER');
  if (header === undefined) throw new Error('no project header');
  return header;
}

function showSummary(summary: GhostexMobileSummary): void {
  useInventoryStore.setState({
    inventoriesByMachineId: { m1: { ...emptyMachineInventory(), summary, serverSummary: summary } },
  });
}

async function renderMenus() {
  const runQuickAction = jest.fn();
  const attachCreated = jest.fn(async () => undefined);
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
    attachCreated,
    runBulkSessionActions: jest.fn(),
    runCreationFlow: jest.fn(),
    runQuickAction,
    runSessionCommand: jest.fn(),
    sessionsForProject: () => [],
    setOverlay: jest.fn(),
    setTransientStatus: jest.fn(),
  };
  const view = await renderHook(() => useSessionsScreenMenus(deps));
  return { ...view, runQuickAction, attachCreated };
}

const rowKeys = (items: { key: string }[]) => items.map((item) => item.key);

test('the menu lists project and global entries and the tap keeps the global scope', async () => {
  const summary = summaryOf({ quickActionsByProject: PROJECT_ACTIONS, ...GLOBALS });
  showSummary(summary);
  const ctx = { machine, header: headerOf(summary) };
  const { result, runQuickAction } = await renderMenus();
  expect(rowKeys(result.current.projectMenuView(ctx, []).items)).toContain('quick-actions');
  const rows = result.current.actionsMenuItems(ctx);
  expect(rowKeys(rows)).toEqual([
    'project-heading',
    'project:same',
    'scope-separator',
    'global-heading',
    'global:same',
  ]);
  const globalRow = rows.find((row) => row.key === 'global:same');
  if (globalRow?.kind !== 'item') throw new Error('global row missing');
  globalRow.onPress();
  expect(runQuickAction.mock.calls[0][3].scope).toBe('global');
  expect(useLauncherStore.getState().lastActionByProject['m1:P1']).toEqual({ scope: 'global', commandId: 'same' });
});

test('an open Actions… list loses its Global Actions when the current summary loses the capability', async () => {
  const summary = summaryOf({ quickActionsByProject: PROJECT_ACTIONS, ...GLOBALS });
  showSummary(summary);
  const ctx = { machine, header: headerOf(summary) };
  const { result, rerender } = await renderMenus();
  showSummary(withoutGlobalQuickActions(summary));
  await rerender(undefined);
  expect(rowKeys(result.current.actionsMenuItems(ctx))).toEqual(['project-heading', 'project:same']);
});

test('an open project menu drops Actions… when only Global Actions led to it and they are gone', async () => {
  const summary = summaryOf(GLOBALS);
  showSummary(summary);
  const ctx = { machine, header: headerOf(summary) };
  const { result, rerender } = await renderMenus();
  expect(rowKeys(result.current.projectMenuView(ctx, []).items)).toContain('quick-actions');
  showSummary(summaryOf({}));
  await rerender(undefined);
  expect(rowKeys(result.current.projectMenuView(ctx, []).items)).not.toContain('quick-actions');
  expect(result.current.actionsMenuItems(ctx)).toEqual([]);
});

test('a project without a stable project id offers no Global Actions', async () => {
  const stable = summaryOf(GLOBALS);
  showSummary(stable);
  const stableCtx = { machine, header: headerOf(stable) };
  const { result, rerender } = await renderMenus();
  expect(rowKeys(result.current.actionsMenuItems(stableCtx))).toContain('global:same');

  const projectless = summaryOf({
    projects: [],
    sessions: [
      {
        sessionId: 's1',
        projectId: '',
        projectName: 'Project',
        projectPath: '/project',
        title: 's1',
        provider: 'zmx',
        isLive: true,
      },
    ],
    ...GLOBALS,
  });
  showSummary(projectless);
  await rerender(undefined);
  const ctx = { machine, header: headerOf(projectless) };
  expect(ctx.header.projectId).toBe('');
  expect(projectless.globalQuickActions.map((action) => action.commandId)).toEqual(['same']);
  expect(rowKeys(result.current.projectMenuView(ctx, []).items)).not.toContain('quick-actions');
  expect(result.current.actionsMenuItems(ctx)).toEqual([]);
});

test("the Sessions list's Handoff starts a chat agent as the chat's Handoff does: deferred, its staged link claimed", async () => {
  const summary = summaryOf({ agents: [{ agentId: 'claude', name: 'Claude', icon: 'claude' }] });
  showSummary(summary);
  const { result, attachCreated } = await renderMenus();
  mockRun.mockClear();
  mockRpc.mockClear();
  await act(async () => {
    result.current.startTranscriptConversation(
      {
        machine,
        projectId: 'P1',
        sessionTitle: 'Old chat',
        agentId: 'claude',
        agentLabel: 'Claude',
        path: '/tmp/t.md',
      },
      'Project',
    );
  });
  const creates = mockRun.mock.calls
    .map(([, command]) => command)
    .filter((command) => command.startsWith('ghostex create-agent '));
  expect(creates).toHaveLength(1);
  expect(creates[0]).toContain('--first-input-draft');
  expect(creates[0]).toContain('--defer-start');
  expect(mockRpc).toHaveBeenCalledWith(machine, 'claimSessionChatLaunchDraft', { projectId: 'P1', sessionId: 's-new' });
  expect(attachCreated).toHaveBeenCalledWith(machine, 's-new', { agentId: 'claude', projectId: 'P1', title: 'Claude' });
  expect(takeLaunchDraft('m1', 'P1', 's-new')).toBe('Continue from the exported transcript');
});
