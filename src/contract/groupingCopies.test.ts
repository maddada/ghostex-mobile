/// <reference types="node" />
/**
 * Run with `bun test src/contract/groupingCopies.test.ts`. A project cloned twice on this computer is one entry
 * whose header lists its folders for the New Coordinator form's Folder row, starting on the folder of the newest
 * session when that session is in one of them, else the entry's own (gx-core merged.rs `last_used_copy`).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { buildDrawerItems, type ProjectHeaderItem } from './grouping';
import { parseMobileSummary } from './mobileSummary';

const ORIGIN = 'git@github.com:example/repo.git';

function project(projectId: string, path: string, extra: object = {}): object {
  return {
    projectId,
    name: path.split('/').pop(),
    path,
    gitRemoteOriginUrl: ORIGIN,
    gitRepositoryRootPath: path,
    ...extra,
  };
}

function session(sessionId: string, projectId: string, path: string, createdAt: string): object {
  return {
    sessionId,
    projectId,
    projectName: path.split('/').pop(),
    projectPath: path,
    title: sessionId,
    provider: 'zmx',
    isLive: true,
    createdAt,
  };
}

function headers(projects: object[], sessions: object[], extra: object = {}): ProjectHeaderItem[] {
  const summary = parseMobileSummary(JSON.stringify({ projects, sessions, ...extra }));
  assert.ok(summary !== null);
  return buildDrawerItems({
    machineId: 'm1',
    summary,
    expandedProjectKeys: new Set(),
    expandedCollectionIds: new Set(),
    expandedGroupKeys: new Set(),
    collapsedSessionKindKeys: new Set(),
  }).filter((item): item is ProjectHeaderItem => item.type === 'PROJECT_HEADER');
}

const CLONES = [project('A', '/work/customer-a/repo'), project('B', '/work/customer-b/repo')];

describe('the New Coordinator Folder row of a project cloned twice', () => {
  test('lists both folders, told apart by the end of their paths, and starts on the newest session', () => {
    const [header, ...rest] = headers(CLONES, [
      session('s1', 'A', '/work/customer-a/repo', '2026-11-09T10:00:00Z'),
      session('s2', 'B', '/work/customer-b/repo', '2026-11-09T11:00:00Z'),
    ]);
    assert.equal(rest.length, 0);
    assert.deepEqual(
      header.copies?.map((copy) => [copy.projectId, copy.label]),
      [
        ['A', 'customer-a/repo'],
        ['B', 'customer-b/repo'],
      ],
    );
    assert.equal(header.defaultCopyProjectId, 'B');
  });

  test('starts on the entry’s own folder when the newest session is in a worktree listed with it', () => {
    const [header] = headers(
      [...CLONES, project('W', '/work/customer-b/repo-wt', { worktree: { parentProjectId: 'B', branch: 'feat' } })],
      [
        session('s1', 'A', '/work/customer-a/repo', '2026-11-09T10:00:00Z'),
        session('s2', 'B', '/work/customer-b/repo', '2026-11-09T11:00:00Z'),
        session('s3', 'W', '/work/customer-b/repo-wt', '2026-11-09T12:00:00Z'),
      ],
    );
    assert.deepEqual(
      header.copies?.map((copy) => copy.projectId),
      ['A', 'B'],
    );
    assert.equal(header.defaultCopyProjectId, 'A');
  });

  test('a project with one folder has no Folder row', () => {
    const [header] = headers([project('A', '/work/customer-a/repo')], []);
    assert.equal(header.copies, undefined);
    assert.equal(header.defaultCopyProjectId, undefined);
  });

  test('with Merge copies of the same repository off each folder is its own project, with no Folder row', () => {
    const list = headers(CLONES, [], { sidebarMergeRepositoryCopies: false });
    assert.equal(list.length, 2);
    assert.ok(list.every((header) => header.copies === undefined));
  });
});
