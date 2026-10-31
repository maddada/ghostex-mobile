import type { GhostexMobileSummary } from '../../contract/mobileSummary';
import { hideProjectsWithoutSessions, type DrawerBlock } from './drawerModel';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) },
}));

const project = (projectId: string): DrawerBlock =>
  ({ kind: 'project', listKey: projectId, machineId: 'm', card: { header: { projectId }, children: [] } }) as unknown as DrawerBlock;
const collection = (id: string, ...projectIds: string[]): DrawerBlock =>
  ({
    kind: 'collection',
    listKey: id,
    machineId: 'm',
    header: {},
    projects: projectIds.map((projectId) => ({ header: { projectId }, children: [] })),
  }) as unknown as DrawerBlock;
const summary = (hide: boolean, ...withSessions: string[]) =>
  ({
    sidebarHideProjectsWithoutSessions: hide,
    sessions: withSessions.map((projectId) => ({ projectId })),
  }) as unknown as GhostexMobileSummary;

describe('Hide projects without sessions on the phone', () => {
  const blocks = [project('used'), project('empty'), collection('c', 'in-used', 'in-empty'), collection('all-empty', 'x')];
  test('off leaves the list alone', () => {
    expect(hideProjectsWithoutSessions(blocks, summary(false, 'used'), false)).toEqual({ blocks, emptyProjects: 0 });
  });
  test('on leaves out empty projects and empty collections and counts them', () => {
    const { blocks: kept, emptyProjects } = hideProjectsWithoutSessions(blocks, summary(true, 'used', 'in-used'), false);
    expect(emptyProjects).toBe(3);
    expect(kept.map((block) => block.listKey)).toEqual(['used', 'c']);
  });
  test('Show all brings them back in place and the row stays', () => {
    const shown = hideProjectsWithoutSessions(blocks, summary(true, 'used'), true);
    expect(shown.blocks).toBe(blocks);
    expect(shown.emptyProjects).toBe(4);
  });
});
