/// <reference types="jest" />
/**
 * Run with `bunx jest src/chat/native/composer/draftProjectChoices.rntl.ts`. The tray's project chip moves a draft to
 * another project; the move is noted as every start notes one (`noteNewSessionIn`), so a Unified filter narrowed by
 * Space widens to show the moved draft and a lone computer is remembered under the list's `local` key.
 */

import { parseMobileSummary } from '../../../contract/mobileSummary';
import { EMPTY_UNIFIED_FILTER } from '../../../contract/unified/build';
import { repoIdentity } from '../../../contract/unified/repo';
import { emptyMachineInventory, useInventoryStore } from '../../../inventory/store';
import { useMachinesStore, type MachineRecord } from '../../../machines/store';
import { useUnifiedListStore } from '../../../screens/sessions-screen/unified-list-store';
import { moveDraftToProject } from './draftProjectChoices';

jest.mock('@react-native-async-storage/async-storage', () =>
  jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
jest.mock('../../../../modules/ghostex-native/src', () => {
  // Every native call resolves to nothing; listeners can be removed.
  const call = () => Promise.resolve(undefined);
  const native = new Proxy(
    {},
    { get: (_target, key) => (key === 'addListener' ? () => ({ remove: () => undefined }) : call) },
  );
  return { GhostexNative: native, GhostexTerminalView: () => null };
});
jest.mock('../sessionShell', () => ({
  createAgentWithFirstInputDraft: jest.fn(async () => 's-moved'),
  machineAgents: () => [],
  openSessionTab: jest.fn(async () => undefined),
}));
jest.mock('../../rust/transport', () => ({ sessionChatRpc: jest.fn(async () => undefined) }));

const MACHINE: MachineRecord = {
  id: 'm1',
  name: 'Studio',
  host: 'studio.local',
  username: 'me',
  port: 22,
  savePassword: false,
  lastConnectedAt: null,
};

test('a draft moved into a project of another Space joins a Space filter, on the lone computer as local', async () => {
  const summary = parseMobileSummary(
    JSON.stringify({
      ok: true,
      projects: [
        { projectId: 'P1', name: 'website', path: '/repo/website' },
        { projectId: 'P2', name: 'inventory', path: '/repo/inventory' },
      ],
      sessions: [],
      agents: [{ agentId: 'claude', name: 'Claude', icon: 'claude' }],
      sidebarSpaces: {
        order: ['sa', 'sb'],
        spaces: { sa: { name: 'Alpha', memberProjectIds: ['P2'] }, sb: { name: 'Beta', memberProjectIds: ['P1'] } },
      },
    }),
  );
  if (summary === null) throw new Error('the summary did not parse');
  useMachinesStore.setState({ hydrated: true, machines: [MACHINE], selectedMachineId: MACHINE.id });
  useInventoryStore.setState({
    inventoriesByMachineId: {
      [MACHINE.id]: { ...emptyMachineInventory(), summary, serverSummary: summary, hasLoaded: true },
    },
  });
  useUnifiedListStore.setState({
    hydrated: true,
    filter: { ...EMPTY_UNIFIED_FILTER, spaces: ['local|sa'] },
    lastMachines: {},
    recentRepos: [],
  });

  await moveDraftToProject({
    from: MACHINE as never,
    fromProjectId: 'P2',
    fromSessionId: 's-draft',
    agentId: 'claude',
    text: 'hello',
    to: MACHINE as never,
    toProjectId: 'P1',
  });

  const { filter, lastMachines } = useUnifiedListStore.getState();
  expect(filter.spaces).toEqual(['local|sa', 'local|sb']);
  expect(lastMachines).toEqual({ [repoIdentity(null, '/repo/website', null, 'website').key]: 'local' });
});
