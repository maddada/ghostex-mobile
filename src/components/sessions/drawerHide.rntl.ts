import type { GhostexMobileSummary } from '../../contract/mobileSummary';
import { hideProjectsWithoutSessions, hidesProjectsWithoutSessions, type DrawerBlock } from './drawerModel';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined) },
}));

// `sessionCount` is what the card draws: its own sessions plus its worktrees' and merged copies'.
const card = (projectId: string, sessionCount: number, isHome = false) => ({
  header: { projectId, sessionCount, isHome },
  children: [],
});
const project = (projectId: string, sessionCount: number, isHome = false): DrawerBlock =>
  ({ kind: 'project', listKey: projectId, machineId: 'm', card: card(projectId, sessionCount, isHome) }) as unknown as DrawerBlock;
const collection = (id: string, ...members: [string, number][]): DrawerBlock =>
  ({
    kind: 'collection',
    listKey: id,
    machineId: 'm',
    header: {},
    projects: members.map(([projectId, count]) => card(projectId, count)),
  }) as unknown as DrawerBlock;

describe('Hide projects without sessions on the phone', () => {
  const blocks = [
    project('used', 2),
    project('empty', 0),
    project('home', 0, true),
    collection('c', ['in-used', 1], ['in-empty', 0]),
    collection('all-empty', ['x', 0]),
  ];
  test('off leaves the list alone', () => {
    expect(hideProjectsWithoutSessions(blocks, false, false)).toEqual({ blocks, emptyProjects: 0 });
  });
  test('on leaves out empty projects and empty collections and counts them; Main Hub stays', () => {
    const { blocks: kept, emptyProjects } = hideProjectsWithoutSessions(blocks, true, false);
    expect(emptyProjects).toBe(3);
    expect(kept.map((block) => block.listKey)).toEqual(['used', 'home', 'c']);
    expect((kept[2] as { projects: unknown[] }).projects).toHaveLength(1);
  });
  test('a card that draws sessions from its worktrees or a merged copy stays, whatever its own projectId holds', () => {
    // The summary has no session with this card's projectId: they all belong to a worktree's project.
    const folded = [project('parent-of-worktree', 3)];
    expect(hideProjectsWithoutSessions(folded, true, false)).toEqual({ blocks: folded, emptyProjects: 0 });
  });
  test('Show all brings them back in place and the row stays', () => {
    const shown = hideProjectsWithoutSessions(blocks, true, true);
    expect(shown.blocks).toBe(blocks);
    expect(shown.emptyProjects).toBe(3);
  });
});

describe('which value decides: the phone`s own or the computer`s', () => {
  const summary = (on: boolean) => ({ sidebarHideProjectsWithoutSessions: on }) as unknown as GhostexMobileSummary;
  test('follows the computer until changed on the phone', () => {
    expect(hidesProjectsWithoutSessions(null, summary(true))).toBe(true);
    expect(hidesProjectsWithoutSessions(null, summary(false))).toBe(false);
    expect(hidesProjectsWithoutSessions(null, null)).toBe(false);
  });
  test('keeps its own once set, whatever the computer has', () => {
    expect(hidesProjectsWithoutSessions(false, summary(true))).toBe(false);
    expect(hidesProjectsWithoutSessions(true, summary(false))).toBe(true);
  });
});
