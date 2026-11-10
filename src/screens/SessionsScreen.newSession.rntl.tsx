/// <reference types="jest" />
/**
 * Run with `bunx jest src/screens/SessionsScreen.newSession.rntl.tsx`. A project's "+" opens the agent picker in the
 * right project also when that project sits in a saved project collection, as on a computer whose projects are all in
 * collections ("Acme", "Internal").
 *
 * The Unified list has no project header: a project group's "+" and the filter's "+" look the project's header up from the computer's summary (`projectHeaderOf`, contract/grouping.ts). The Project list
 * draws a project in a collection only while that collection is open, and its "Select agent" takes the header it draws.
 * Both lists are tested here, with the picker's agent row tapped through to the `create-agent` command it sends.
 *
 * The header's New session (sessions-screen/new-session-button.tsx) opens every computer's projects and starts the
 * project's remembered agent there: which computer, which agent per "Remember the agent you pick" (the picked project's
 * own Space), the chat draft it opens, and what it says when it can't start, all through the same recorded command.
 *
 * The real `SessionsScreen` with its real stores and a summary parsed by the real parser; mocked are the boundaries
 * only: the native module, the computer's CLI (`runGhostexCli`, recorded), storage, haptics, navigation focus, the
 * voice button and Reanimated's swipe row.
 */

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import type { RailButtons } from '../components/common/verticalBar/VerticalBarArea';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { TestInstance } from 'test-renderer';

import { useCollapseStore } from '../components/sessions/collapseStore';
import { useLauncherStore } from '../components/sessions/launcherStore';
import { parseMobileSummary, type GhostexMobileSummary } from '../contract/mobileSummary';
import { EMPTY_UNIFIED_FILTER } from '../contract/unified/build';
import { repoIdentity } from '../contract/unified/repo';
import { emptyMachineInventory, useInventoryStore, type MachineInventory } from '../inventory/store';
import { useMachinesStore, type MachineRecord } from '../machines/store';
import { defaultSettings, useSettingsStore, type GhostexSettings } from '../settings/store';
import { useSpacesStore } from '../spaces/store';
import { useWorkspacesStore } from '../workspaces/store';
import { useTerminalStore } from '../terminal/sessions';
import { useUnifiedListStore } from './sessions-screen/unified-list-store';
import SessionsScreen from './SessionsScreen';

/** What a `create-agent` answers with (null: it never answers, like every other command). */
let mockCreateAnswer: object | null = null;
/** Every command the screen sent to a computer's CLI, as `[machineId, command]`. */
const mockRun = jest.fn((_machine: { id: string }, command: string) =>
  command.startsWith('ghostex create-agent ') && mockCreateAnswer !== null
    ? Promise.resolve(mockCreateAnswer)
    : new Promise<never>(() => undefined),
);
/** The screen's navigation, recorded. */
const mockNavigate = jest.fn();
/** The side bar's buttons the screen publishes last (the rail pose shows them). */
const mockRail: { current: RailButtons | null } = { current: null };

jest.mock('../components/sessions/cli', () => ({
  ...jest.requireActual('../components/sessions/cli'),
  runGhostexCli: (...args: [{ id: string }, string]) => mockRun(...args),
}));
jest.mock('../../modules/ghostex-native/src', () => {
  // Every native call resolves to nothing; listeners can be removed.
  const call = () => Promise.resolve(undefined);
  const native = new Proxy(
    {},
    { get: (_target, key) => (key === 'addListener' ? () => ({ remove: () => undefined }) : call) },
  );
  return { GhostexNative: native, GhostexTerminalView: () => null };
});
jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('expo-haptics', () => ({
  impactAsync: () => Promise.resolve(),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Heavy: 'heavy' },
}));
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useIsFocused: () => true,
  useFocusEffect: () => undefined,
  useNavigation: () => ({ navigate: () => undefined }),
}));
jest.mock('../voice/VoiceButton', () => ({ VoiceButton: () => null }));
jest.mock('../components/common/verticalBar/VerticalBarArea', () => ({
  ...jest.requireActual('../components/common/verticalBar/VerticalBarArea'),
  useRailButtons: (buttons: RailButtons) => {
    mockRail.current = buttons;
  },
}));
// The Unified list's swipe-to-reveal row runs on Reanimated, whose worklets runtime does not load under Jest.
jest.mock('./machines-screen/SwipeRevealRow', () => ({
  __esModule: true,
  SWIPE_REVEAL_WIDTH: 176,
  default: ({ children }: { children: unknown }) => children,
}));

/** The jest preset's `measureInWindow`, which answers nothing unless a test says what; "Select agent" measures. */
const measureInWindow = jest.requireActual<{ default: { measureInWindow: jest.Mock } }>(
  '@react-native/jest-preset/jest/MockNativeMethods',
).default.measureInWindow;

const MACHINE: MachineRecord = {
  id: 'm1',
  name: 'Studio',
  host: 'studio.local',
  username: 'me',
  port: 22,
  savePassword: false,
  lastConnectedAt: null,
};
const MINI: MachineRecord = { ...MACHINE, id: 'm2', name: 'Mac mini', host: 'mini.local' };

const minutesAgo = (minutes: number): string => new Date(Date.now() - minutes * 60_000).toISOString();

function session(sessionId: string, title: string, projectId: string, minutes: number): object {
  return {
    sessionId,
    projectId,
    title,
    status: 'idle',
    activity: 'idle',
    isLive: true,
    provider: 'zmx',
    agent: 'claude',
    lastInteractionAt: minutesAgo(minutes),
    createdAt: minutesAgo(600),
  };
}

const PROJECTS = [
  { projectId: 'P1', name: 'website', path: '/repo/website' },
  { projectId: 'P2', name: 'inventory', path: '/repo/inventory' },
  { projectId: 'P3', name: 'billing', path: '/repo/billing' },
];

/**
 * One computer: `inventory` in the collection "Internal", `billing` in "Acme", `website` in none. The most
 * recent session is in `inventory`, so it is the Unified list's top card.
 */
function summary(extra: object = {}): GhostexMobileSummary {
  const parsed = parseMobileSummary(
    JSON.stringify({
      ok: true,
      projects: PROJECTS,
      sessions: [
        session('s-inventory', 'Stock reconciliation', 'P2', 2),
        session('s-bill', 'Invoice export', 'P3', 30),
        session('s-web', 'Landing copy', 'P1', 90),
      ],
      agents: [{ agentId: 'claude', name: 'Claude', icon: 'claude' }],
      sidebarProjectCollections: {
        order: ['acme', 'internal'],
        collections: {
          acme: { title: 'Acme', color: '#3366cc', projectIds: ['P3'] },
          internal: { title: 'Internal', color: '#cc6633', projectIds: ['P2'] },
        },
      },
      ...extra,
    }),
  );
  if (parsed === null) throw new Error('the summary did not parse');
  return parsed;
}

/** The repository key the Unified filter's Projects section picks a project by. */
function repoKeyOf(projectId: string): string {
  const project = PROJECTS.find((entry) => entry.projectId === projectId)!;
  return repoIdentity(null, project.path, null, project.name).key;
}

type Setup = {
  extra?: object;
  /** A second computer, "Mac mini", with the same projects in the same collections. */
  withMini?: boolean;
  /** The open session, as its id on the machine. */
  openSessionId?: string | null;
  /** The Unified filter's one project, by project id. */
  filterProjectId?: string;
  expandedProjects?: string[];
  expandedCollections?: string[];
  /** No computer saved at all. */
  noMachines?: boolean;
  /** Each computer's inventory, over the summary read once. */
  inventory?: Partial<MachineInventory>;
  /** Studio's inventory only, over the above. */
  studioInventory?: Partial<MachineInventory>;
  settings?: Partial<GhostexSettings>;
  /** The remembered agent picks. */
  launcher?: {
    primaryAgentId?: string;
    agentByProject?: Record<string, string>;
    agentBySpace?: Record<string, string>;
  };
  /** The drawer's selected Space per computer. */
  spaceByMachine?: Record<string, string>;
  /** The shown workspace per computer. */
  workspaceByMachine?: Record<string, string>;
};

async function renderSessions({
  extra = {},
  withMini = false,
  openSessionId = null,
  filterProjectId,
  expandedProjects = [],
  expandedCollections = [],
  noMachines = false,
  inventory = {},
  studioInventory = {},
  settings = {},
  launcher = {},
  spaceByMachine = {},
  workspaceByMachine = {},
}: Setup = {}): Promise<void> {
  const parsed = summary(extra);
  const machines = noMachines ? [] : withMini ? [MACHINE, MINI] : [MACHINE];
  useSettingsStore.setState({ hydrated: true, settings: { ...defaultSettings(), ...settings } });
  useLauncherStore.setState({
    hydrated: true,
    primaryAgentId: launcher.primaryAgentId ?? '',
    agentByProject: launcher.agentByProject ?? {},
    agentBySpace: launcher.agentBySpace ?? {},
  });
  useSpacesStore.setState({ selectedSpaceIdByMachine: spaceByMachine });
  useWorkspacesStore.setState({ selectedWorkspaceIdByMachine: workspaceByMachine });
  useMachinesStore.setState({ hydrated: true, machines, selectedMachineId: noMachines ? null : MACHINE.id });
  useInventoryStore.setState({
    inventoriesByMachineId: Object.fromEntries(
      machines.map((machine) => [
        machine.id,
        {
          ...emptyMachineInventory(),
          summary: parsed,
          serverSummary: parsed,
          hasLoaded: true,
          ...inventory,
          ...(machine.id === MACHINE.id ? studioInventory : {}),
        },
      ]),
    ),
  });
  useTerminalStore.setState({ selectedSessionKey: openSessionId === null ? null : `${MACHINE.id}:${openSessionId}` });
  useCollapseStore.setState({
    hydrated: true,
    expandedProjectsByMachine: { [MACHINE.id]: expandedProjects },
    expandedCollectionsByMachine: { [MACHINE.id]: expandedCollections },
  });
  useUnifiedListStore.setState({
    hydrated: true,
    filter:
      filterProjectId === undefined
        ? EMPTY_UNIFIED_FILTER
        : { ...EMPTY_UNIFIED_FILTER, repos: [repoKeyOf(filterProjectId)] },
    toggledShelves: [],
    foldedGroups: [],
    lastMachines: {},
    recentRepos: [],
  });
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 402, height: 874 },
        insets: { top: 59, left: 0, right: 0, bottom: 34 },
      }}
    >
      <SessionsScreen
        navigation={{ navigate: mockNavigate } as never}
        route={{ key: 'sessions', name: 'Sessions' } as never}
      />
    </SafeAreaProvider>,
  );
  await act(async () => undefined);
}

async function press(label: string): Promise<void> {
  await act(async () => {
    fireEvent.press(screen.getByLabelText(label));
  });
}

/** iOS presents the next modal only after the current menu or sheet has finished dismissing. */
async function pressAndDismiss(target: TestInstance): Promise<void> {
  const modal = screen.container.queryAll(
    (entry) => entry.props.visible === true && typeof entry.props.onDismiss === 'function',
  )[0];
  if (modal === undefined) throw new Error('no visible modal to dismiss');
  const onDismiss = modal.props.onDismiss;
  await act(async () => fireEvent.press(target));
  await act(async () => onDismiss());
}

/**
 * The agent picker is open for `title`, and its agent row starts that agent in `projectId` on the computer `machineId`:
 * the `create-agent` command the tap sends names the project and goes to that computer.
 */
async function expectPickerStarting(title: string, projectId: string, machineId = MACHINE.id): Promise<void> {
  expect(screen.getByText('Start an agent session')).toBeTruthy();
  expect(screen.getAllByText(title).length).toBeGreaterThan(0);
  expect(screen.getByText('New Coordinator…')).toBeTruthy();
  mockRun.mockClear();
  await pressAndDismiss(screen.getByText('Claude'));
  const launches = mockRun.mock.calls.filter(([, command]) => command.startsWith('ghostex create-agent '));
  expect(launches).toHaveLength(1);
  const [machine, command] = launches[0];
  expect(machine.id).toBe(machineId);
  expect(command).toMatch(new RegExp(`--project-id '?${projectId}'? `));
}

beforeEach(() => {
  mockRun.mockClear();
  mockNavigate.mockClear();
  mockCreateAnswer = null;
  mockRail.current = null;
  measureInWindow.mockImplementation((frame: (...values: number[]) => void) => frame(0, 100, 320, 30));
});

afterEach(() => {
  measureInWindow.mockReset();
});

describe('the Unified list, projects in collections', () => {
  const UNIFIED = { sidebarView: 'unified' };

  test('a project group\'s "+" opens the picker in that project', async () => {
    await renderSessions({ extra: { ...UNIFIED, unifiedGroupByProject: true } });
    await press('New session in inventory');
    await expectPickerStarting('inventory', 'P2');
  });

  test('a project group\'s "+" on two computers opens the picker on the computer picked', async () => {
    await renderSessions({ extra: { ...UNIFIED, unifiedGroupByProject: true }, withMini: true });
    await press('New session in inventory');
    await pressAndDismiss(screen.getByRole('button', { name: 'Project: inventory on Studio. Tap to change' }));
    await pressAndDismiss(screen.getByRole('button', { name: 'inventory on Mac mini' }));
    await expectPickerStarting('inventory', 'P2', MINI.id);
  });

  test('the "+" on a project in the filter opens the picker in that project', async () => {
    await renderSessions({ extra: UNIFIED });
    await press(screen.getByLabelText(/^Filter sessions/).props.accessibilityLabel);
    await pressAndDismiss(screen.getByLabelText('New session in inventory'));
    await expectPickerStarting('inventory', 'P2');
  });

  test('its search row has no New session of its own', async () => {
    await renderSessions({ extra: UNIFIED });
    expect(screen.getAllByLabelText('New session')).toHaveLength(1);
  });
});

describe('the Project list, a project in a collection', () => {
  test('its open header\'s "Select agent" opens the picker in that project', async () => {
    await renderSessions({ expandedCollections: ['internal'], expandedProjects: ['id:P2'] });
    await press('Select agent');
    await expectPickerStarting('inventory', 'P2');
  });

  test('a closed collection draws no project header, so no picker can be asked for there', async () => {
    await renderSessions({ expandedProjects: ['id:P2'] });
    expect(screen.getByLabelText('Internal')).toBeTruthy();
    expect(screen.queryByLabelText('Select agent')).toBeNull();
  });
});

/** The `create-agent` commands sent so far, as `[machineId, command]`. */
function launches(): Array<[string, string]> {
  return mockRun.mock.calls
    .filter(([, command]) => command.startsWith('ghostex create-agent '))
    .map(([machine, command]): [string, string] => [machine.id, command]);
}

/** The command New session sends: the agent in the project, a chat draft (`--defer-start`) for a chat-capable agent. */
function createCommand(agentId: string, projectId: string, deferStart = true): RegExp {
  return new RegExp(
    `^ghostex create-agent '?${agentId}'? --project-id '?${projectId}'?${deferStart ? ' --defer-start' : ''} --replace-empty-sessions --json$`,
  );
}

/** The header's New session, with its project sheet open. */
async function openNewSession(): Promise<void> {
  await press('New session');
  expect(screen.getByText('New session')).toBeTruthy();
}

/** A row or a chip of the open sheet (the sheet is drawn last), run once the sheet has gone. */
async function pick(name: string): Promise<void> {
  const rows = screen.getAllByRole('button', { name });
  await pressAndDismiss(rows[rows.length - 1]!);
}

const TWO_AGENTS = [
  { agentId: 'claude', name: 'Claude', icon: 'claude' },
  { agentId: 'codex', name: 'Codex', icon: 'codex' },
];

/** Two Spaces: Alpha shows the collection "Internal" (inventory), Beta shows website. */
const SPACES = {
  sidebarSpaces: {
    order: ['sa', 'sb'],
    spaces: {
      sa: { name: 'Alpha', memberCollectionIds: ['internal'] },
      sb: { name: 'Beta', memberProjectIds: ['P1'] },
    },
  },
};

describe("the header's New session", () => {
  const UNIFIED = { sidebarView: 'unified' };

  test('in the Project list it opens every project and starts the agent in the one picked, in its chat draft', async () => {
    await renderSessions();
    await openNewSession();
    await pick('inventory');
    expect(launches()).toHaveLength(1);
    expect(launches()[0]![0]).toBe(MACHINE.id);
    expect(launches()[0]![1]).toMatch(createCommand('claude', 'P2'));
  });

  test('in the Unified list it does the same', async () => {
    await renderSessions({ extra: UNIFIED, openSessionId: 's-bill' });
    await openNewSession();
    await pick('website');
    expect(launches()).toEqual([[MACHINE.id, expect.stringMatching(createCommand('claude', 'P1'))]]);
  });

  test('in the Unified list a chip starts on that computer too', async () => {
    await renderSessions({ extra: UNIFIED, withMini: true });
    await openNewSession();
    await pick('inventory on Mac mini');
    expect(launches()).toEqual([[MINI.id, expect.stringMatching(createCommand('claude', 'P2'))]]);
  });

  test('in the side bar it is one of the rail buttons', async () => {
    await renderSessions();
    const entry = mockRail.current?.entries.find((candidate) => candidate.key === 'newSession');
    expect(entry?.label).toBe('New session');
    await act(async () => entry!.onPress({ x: 0, y: 0, width: 40, height: 40 } as never));
    expect(screen.getByText('New session')).toBeTruthy();
  });

  test('a row starts on the computer you are on, and a chip on that computer', async () => {
    await renderSessions({ withMini: true });
    await openNewSession();
    await pick('inventory');
    await openNewSession();
    await pick('inventory on Mac mini');
    expect(launches().map(([machineId]) => machineId)).toEqual([MACHINE.id, MINI.id]);
  });

  test('a row starts on the computer used last for that project', async () => {
    await renderSessions({ withMini: true });
    useUnifiedListStore.setState({ lastMachines: { [repoKeyOf('P2')]: MINI.id } });
    await openNewSession();
    await pick('inventory');
    expect(launches()).toEqual([[MINI.id, expect.stringMatching(createCommand('claude', 'P2'))]]);
  });

  test("a computer's name in the search picks that computer", async () => {
    await renderSessions({ withMini: true });
    await openNewSession();
    await act(async () => fireEvent.changeText(screen.getByLabelText('Search projects'), 'inventory mini'));
    await pick('inventory');
    expect(launches()).toEqual([[MINI.id, expect.stringMatching(createCommand('claude', 'P2'))]]);
  });

  test("a computer that isn't connected can't be picked, and its projects start on the other one", async () => {
    await renderSessions({ withMini: true, studioInventory: { lastError: 'Connection refused' } });
    await openNewSession();
    const away = screen.getAllByRole('button', { name: 'Studio, not connected' });
    expect(away).toHaveLength(PROJECTS.length);
    for (const chip of away) expect(chip).toBeDisabled();
    await pick('inventory');
    expect(launches()).toEqual([[MINI.id, expect.stringMatching(createCommand('claude', 'P2'))]]);
  });

  test("a project whose computer isn't connected says so and starts nothing", async () => {
    await renderSessions({ inventory: { lastError: 'Connection refused' } });
    await openNewSession();
    await pick('inventory');
    expect(launches()).toEqual([]);
    expect(screen.getByText('Computer not connected')).toBeTruthy();
    expect(screen.getByText("Studio isn't connected. Reconnect it, then try again.")).toBeTruthy();
  });

  test('a project with no agent turned on says so and starts nothing', async () => {
    await renderSessions({ extra: { agents: [] } });
    await openNewSession();
    await pick('inventory');
    expect(launches()).toEqual([]);
    expect(screen.getByText('No agents turned on')).toBeTruthy();
    expect(screen.getByText('Turn on an agent in Settings > Agents on Studio, then try again.')).toBeTruthy();
  });

  test('with the phone preferring the terminal, a chat-capable agent still opens its chat draft', async () => {
    mockCreateAnswer = { json: { session: { sessionId: 's-new' } }, stdout: '' };
    await renderSessions({ settings: { preferredAgentInterface: 'terminal' } });
    await openNewSession();
    await pick('inventory');
    expect(launches()[0]![1]).toMatch(createCommand('claude', 'P2'));
    await act(async () => undefined);
    expect(mockNavigate).toHaveBeenCalledWith(
      'Terminal',
      expect.objectContaining({ sessionKey: `${MACHINE.id}:s-new` }),
    );
    expect(useTerminalStore.getState().sessionViewModeBySessionKey[`${MACHINE.id}:s-new`]).toBe('chat');
  });

  test('an agent without chat starts in its terminal (no draft)', async () => {
    await renderSessions({ extra: { agents: [{ agentId: 'aider', name: 'Aider', icon: 'terminal' }] } });
    await openNewSession();
    await pick('inventory');
    expect(launches()[0]![1]).toMatch(createCommand('aider', 'P2', false));
  });

  test('Per project: the agent picked last in that project', async () => {
    await renderSessions({
      extra: { agents: TWO_AGENTS, newSessionAgentScope: 'project' },
      launcher: { primaryAgentId: 'claude', agentByProject: { [`${MACHINE.id}:P1`]: 'codex' } },
    });
    await openNewSession();
    await pick('website');
    expect(launches()[0]![1]).toMatch(createCommand('codex', 'P1'));
  });

  test('Everywhere: the agent picked last anywhere', async () => {
    await renderSessions({
      extra: { agents: TWO_AGENTS, newSessionAgentScope: 'everywhere' },
      launcher: { primaryAgentId: 'claude', agentByProject: { [`${MACHINE.id}:P1`]: 'codex' } },
    });
    await openNewSession();
    await pick('website');
    expect(launches()[0]![1]).toMatch(createCommand('claude', 'P1'));
  });

  test("Per Space: the picked project's own Space, not the one the list shows, and the pick is kept there", async () => {
    await renderSessions({
      extra: { agents: TWO_AGENTS, newSessionAgentScope: 'space', ...SPACES },
      launcher: {
        primaryAgentId: 'claude',
        agentBySpace: { [`${MACHINE.id}:sa`]: 'claude', [`${MACHINE.id}:sb`]: 'codex' },
      },
      spaceByMachine: { [MACHINE.id]: 'sa' },
    });
    await openNewSession();
    await pick('website');
    expect(launches()[0]![1]).toMatch(createCommand('codex', 'P1'));
    expect(useLauncherStore.getState().agentBySpace).toEqual({
      [`${MACHINE.id}:sa`]: 'claude',
      [`${MACHINE.id}:sb`]: 'codex',
    });
    expect(useLauncherStore.getState().agentByProject[`${MACHINE.id}:P1`]).toBe('codex');
  });

  test("Per Space: a project in another workspace's Space, while the shown workspace has none", async () => {
    await renderSessions({
      extra: {
        agents: TWO_AGENTS,
        newSessionAgentScope: 'space',
        sidebarWorkspaces: {
          defaultWorkspaceId: 'wa',
          order: ['wa', 'wb'],
          workspaces: { wa: { name: 'Alpha' }, wb: { name: 'Beta' } },
        },
        projects: PROJECTS.map((project) => (project.projectId === 'P1' ? { ...project, workspaceId: 'wb' } : project)),
        sidebarSpaces: {
          order: ['sb'],
          spaces: { sb: { name: 'Beta work', memberProjectIds: ['P1'], workspaceId: 'wb' } },
        },
      },
      launcher: { primaryAgentId: 'claude', agentBySpace: { [`${MACHINE.id}:sb`]: 'codex' } },
    });
    await openNewSession();
    await pick('website');
    expect(launches()[0]![1]).toMatch(createCommand('codex', 'P1'));
    expect(useLauncherStore.getState().agentBySpace[`${MACHINE.id}:sb`]).toBe('codex');
  });

  test("Per Space: a project shown in every workspace keeps the shown workspace's Space", async () => {
    await renderSessions({
      extra: {
        agents: TWO_AGENTS,
        newSessionAgentScope: 'space',
        sidebarWorkspaces: {
          defaultWorkspaceId: 'wa',
          order: ['wa', 'wb'],
          workspaces: { wa: { name: 'Alpha' }, wb: { name: 'Beta' } },
        },
        projects: PROJECTS.map((project) =>
          project.projectId === 'P1'
            ? { ...project, everyWorkspace: true }
            : project.projectId === 'P2'
              ? { ...project, workspaceId: 'wb' }
              : project,
        ),
        sidebarSpaces: {
          order: ['sa', 'sb'],
          spaces: {
            sa: { name: 'Alpha work', memberProjectIds: ['P1'], workspaceId: 'wa' },
            sb: { name: 'Beta work', memberCollectionIds: ['internal'], workspaceId: 'wb' },
          },
        },
      },
      launcher: {
        primaryAgentId: 'claude',
        agentBySpace: { [`${MACHINE.id}:sa`]: 'claude', [`${MACHINE.id}:other`]: 'codex' },
      },
      workspaceByMachine: { [MACHINE.id]: 'wb' },
      spaceByMachine: { [MACHINE.id]: 'other' },
    });
    await openNewSession();
    await pick('website');
    expect(launches()[0]![1]).toMatch(createCommand('codex', 'P1'));
    expect(useLauncherStore.getState().agentBySpace).toEqual({
      [`${MACHINE.id}:sa`]: 'claude',
      [`${MACHINE.id}:other`]: 'codex',
    });
  });

  test('a copy of a repository the Project list folds into another entry still starts', async () => {
    const copy = { gitRemoteOriginUrl: 'git@github.com:acme/web.git' };
    await renderSessions({
      extra: {
        projects: [
          { projectId: 'P1', name: 'web', path: '/one/web', gitRepositoryRootPath: '/one/web', ...copy },
          { projectId: 'P2', name: 'web', path: '/two/web', gitRepositoryRootPath: '/two/web', ...copy },
        ],
        sessions: [session('s-web', 'Landing copy', 'P1', 5)],
        workspaceGroups: { projectOrder: ['P2', 'P1'] },
      },
    });
    await openNewSession();
    await pick('web');
    expect(screen.queryByText('Project not found')).toBeNull();
    expect(launches()).toEqual([[MACHINE.id, expect.stringMatching(createCommand('claude', 'P1'))]]);
  });

  test('with no computer it opens Add computer', async () => {
    await renderSessions({ noMachines: true });
    await press('New session');
    expect(mockNavigate).toHaveBeenCalledWith('ConnectChoose');
  });

  test('with a computer that has no projects it opens Add project', async () => {
    await renderSessions({ extra: { projects: [], sessions: [] } });
    await press('New session');
    expect(mockNavigate).toHaveBeenCalledWith('AddProjectSource', { machineId: MACHINE.id });
  });

  test('while the computer is still loading it says so instead of offering Add project', async () => {
    await renderSessions({ inventory: { summary: null, serverSummary: null, hasLoaded: false } });
    await press('New session');
    expect(mockNavigate).not.toHaveBeenCalledWith('AddProjectSource', expect.anything());
    expect(screen.getByText('Your computers are still loading. Try again in a moment.')).toBeTruthy();
  });

  test("when the computer couldn't be read it says so instead of offering Add project", async () => {
    await renderSessions({
      inventory: { summary: null, serverSummary: null, hasLoaded: true, lastError: 'Connection refused' },
    });
    await press('New session');
    expect(mockNavigate).not.toHaveBeenCalledWith('AddProjectSource', expect.anything());
    expect(screen.getByText("Can't reach Studio. Reconnect it, then try again.")).toBeTruthy();
  });
});
