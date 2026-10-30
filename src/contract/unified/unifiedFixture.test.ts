/// <reference types="node" />
/**
 * The desktop builder's answers, run through the phone's port. `unifiedFixture.json` is written
 * by packages/gx-core/src/unified_sidebar/fixture_tests.rs from the desktop's Unified sidebar
 * builder; a change there that this port does not follow fails here.
 *
 * Run with `bun test src/contract/unified/unifiedFixture.test.ts` from apps/mobile/app.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import {
  buildUnifiedList,
  type UnifiedMachineInput,
  type UnifiedRow,
  type UnifiedSessionInput,
} from './build';

type Json = Record<string, any>;

const fixture = JSON.parse(readFileSync(join(__dirname, 'unifiedFixture.json'), 'utf8')) as {
  cases: Json[];
};

function sessionOf(raw: Json): UnifiedSessionInput {
  return {
    sessionId: raw.sessionId,
    projectId: raw.projectId,
    activity: raw.activity ?? 'idle',
    awaitingApproval: raw.awaitingApproval === true,
    pendingQuestionCount: raw.pendingQuestionCount ?? 0,
    modelSelectionFailed: raw.modelSelectionFailed === true,
    programStatusFailed: raw.programStatusFailed === true,
    hasBackgroundWork: raw.hasBackgroundWork === true,
    isPinned: raw.isPinned === true,
    isParked: raw.isParked === true,
    isDraft: raw.isDraft === true,
    isBrowser: raw.isBrowser === true,
    createdMs: raw.createdMs ?? null,
    lastInteractionMs: raw.lastInteractionMs ?? null,
    workingStartedMs: raw.workingStartedMs ?? null,
    snoozedUntilMs: raw.snoozedUntilMs ?? null,
  };
}

function machinesOf(raw: Json[]): UnifiedMachineInput[] {
  return raw.map((machine) => ({
    machine: machine.machine,
    isLocal: machine.machine === 'local',
    label: machine.label,
    spaces:
      machine.spaces == null
        ? null
        : machine.spaces.map((space: Json) => ({
            spaceId: space.spaceId,
            name: space.name,
            memberProjectIds: space.memberProjectIds ?? [],
            memberCollectionIds: space.memberCollectionIds ?? [],
          })),
    projects: machine.projects.map((project: Json) => ({
      projectId: project.projectId,
      title: project.title,
      path: project.path,
      gitRemoteOriginUrl: project.gitRemoteOriginUrl ?? null,
      worktreeParentPath: project.worktreeParentPath ?? null,
      parentProjectId: project.parentProjectId ?? null,
      collectionId: project.collectionId ?? null,
    })),
    sessions: machine.sessions.map(sessionOf),
  }));
}

const ids = (rows: UnifiedRow[]) => rows.map((row) => row.id);

describe('the Unified list matches the desktop builder', () => {
  assert.ok(fixture.cases.length > 0);
  for (const fixtureCase of fixture.cases) {
    test(fixtureCase.name, () => {
      const expected = fixtureCase.expected;
      const view = buildUnifiedList(
        machinesOf(fixtureCase.machines),
        {
          workingSection: fixtureCase.settings?.workingSection !== false,
          parking: fixtureCase.settings?.parking === true,
        },
        {
          repos: fixtureCase.filter?.repos ?? [],
          machines: fixtureCase.filter?.machines ?? [],
          spaces: fixtureCase.filter?.spaces ?? [],
        },
        fixtureCase.nowMs,
      );
      for (const shelf of ['drafts', 'pinned', 'active', 'working', 'snoozed', 'parked'] as const) {
        assert.deepEqual(ids(view[shelf]), expected[shelf], shelf);
      }
      assert.equal(view.total, expected.total);
      assert.deepEqual(view.options, expected.options);
      const rows: Record<string, Json> = {};
      for (const row of [
        ...view.drafts,
        ...view.pinned,
        ...view.active,
        ...view.working,
        ...view.snoozed,
        ...view.parked,
      ]) {
        rows[row.id] = {
          status: row.status,
          repoKey: row.repo.key,
          repoLabel: row.repo.label,
          machineLabel: row.machineLabel,
          spaceKey: row.spaceKey,
          cameBackMs: row.cameBackMs,
        };
      }
      assert.deepEqual(rows, expected.rows);
    });
  }
});
