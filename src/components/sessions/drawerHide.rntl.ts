import { buildDrawerItems } from '../../contract/grouping';
import { parseMobileSummary, type GhostexMobileSummary } from '../../contract/mobileSummary';
import {
  blocksFromItems,
  hideProjectsWithoutSessions,
  hidesProjectsWithoutSessions,
  type DrawerBlock,
} from './drawerModel';

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
  ({
    kind: 'project',
    listKey: projectId,
    machineId: 'm',
    card: card(projectId, sessionCount, isHome),
  }) as unknown as DrawerBlock;
// A folded collection (`folded`) draws no cards, but its header still knows how many members have no session.
const collection = (id: string, folded: boolean, ...members: [string, number][]): DrawerBlock =>
  ({
    kind: 'collection',
    listKey: id,
    machineId: 'm',
    header: {
      collapsed: folded,
      projectCount: members.length,
      projectsWithoutSessions: members.filter(([, count]) => count === 0).length,
    },
    projects: folded ? [] : members.map(([projectId, count]) => card(projectId, count)),
  }) as unknown as DrawerBlock;

describe('Hide projects without sessions on the phone', () => {
  const blocks = [
    project('used', 2),
    project('empty', 0),
    project('home', 0, true),
    collection('c', false, ['in-used', 1], ['in-empty', 0]),
    collection('all-empty', false, ['x', 0]),
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
  test('a folded collection holding a project with sessions stays, and counts its empty members', () => {
    const folded = [
      collection('folded', true, ['has', 1], ['none', 0]),
      collection('folded-empty', true, ['a', 0], ['b', 0]),
    ];
    const result = hideProjectsWithoutSessions(folded, true, false);
    expect(result.blocks.map((block) => block.listKey)).toEqual(['folded']);
    expect(result.emptyProjects).toBe(3);
  });
  test('a folded collection whose only project has a session stays and hides nothing', () => {
    const folded = [collection('folded', true, ['has', 1])];
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

describe('with the real list builder', () => {
  // Two projects in one saved collection: P1 has a session, P2 none.
  const summary = parseMobileSummary(
    JSON.stringify({
      ok: true,
      projects: [
        { projectId: 'P1', name: 'Used', path: '/repo/used' },
        { projectId: 'P2', name: 'Empty', path: '/repo/empty' },
      ],
      sessions: [
        {
          sessionId: 'a',
          projectId: 'P1',
          title: 'a',
          status: 'idle',
          activity: 'idle',
          isLive: true,
          provider: 'zmx',
        },
      ],
      sidebarProjectCollections: {
        collections: { c1: { collectionId: 'c1', title: 'Apps', color: '#7da4f8', projectIds: ['P1', 'P2'] } },
        order: ['c1'],
      },
    }),
  );
  const blocksWith = (expandedCollectionIds: string[]) =>
    blocksFromItems(
      'm1',
      buildDrawerItems({
        machineId: 'm1',
        summary: summary as GhostexMobileSummary,
        nowMs: Date.now(),
        expandedProjectKeys: new Set(['id:P1', 'id:P2']),
        expandedCollectionIds: new Set(expandedCollectionIds),
        expandedGroupKeys: new Set(),
        collapsedSessionKindKeys: new Set(),
      }),
    );

  test('a folded collection with a session-holding project stays, with its empty member counted', () => {
    const blocks = blocksWith([]);
    const result = hideProjectsWithoutSessions(blocks, true, false);
    expect(result.blocks.filter((block) => block.kind !== 'row').map((block) => block.kind)).toEqual(['collection']);
    expect(result.emptyProjects).toBe(1);
  });

  test('an open collection leaves out only its empty member', () => {
    const result = hideProjectsWithoutSessions(blocksWith(['c1']), true, false);
    const only = result.blocks.find((block) => block.kind === 'collection') as Extract<
      DrawerBlock,
      { kind: 'collection' }
    >;
    expect(only.projects.map((card) => card.header.projectId)).toEqual(['P1']);
    expect(result.emptyProjects).toBe(1);
  });
});
