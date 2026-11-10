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
import {
  filterProjectChoices,
  unifiedNewSessionTarget,
  unifiedProjectChoices,
  widenFilterForNewSession,
} from './choices';
import { repoIdentity } from './repo';
import { groupUnifiedList, moveUnifiedProject } from './grouping';
import { drawnLines, rowsInTree, type UnifiedCrew } from './tree';

type Json = Record<string, any>;

const fixture = JSON.parse(readFileSync(join(__dirname, 'unifiedFixture.json'), 'utf8')) as {
  cases: Json[];
};

/**
 * A fixture session in the builder's terms. A computer's `serverId` gives each session the `globalRef` its gxserver
 * lists it under, which another computer's coordinator links it by (`coordinatorRemoteThreads`).
 */
function sessionOf(raw: Json, serverId?: string): UnifiedSessionInput {
  const ref = (projectId: string, sessionId: string, server = serverId) =>
    server === undefined ? undefined : `${server}:${projectId}:${sessionId}`;
  return {
    isCoordinator: raw.isCoordinator === true,
    threadState: raw.coordinatorThreadState ?? '',
    stuck: raw.stuck === true,
    isFocused: raw.isFocused === true,
    globalRef: ref(raw.projectId, raw.sessionId),
    remoteThreads: ((raw.coordinatorRemoteThreads ?? []) as Json[]).map((thread) => ({
      globalRef: ref(thread.projectId, thread.sessionId, thread.serverId)!,
      threadState: thread.threadState ?? '',
    })),
    sessionId: raw.sessionId,
    projectId: raw.projectId,
    title: raw.title ?? '',
    branch: raw.branch ?? '',
    activity: raw.activity ?? 'idle',
    awaitingApproval: raw.awaitingApproval === true,
    // The saved host fixture carries counted questions, not the question-card field.
    hasQuestion: (raw.pendingQuestionCount ?? 0) > 0,
    modelSelectionFailed: raw.modelSelectionFailed === true,
    programStatusFailed: raw.programStatusFailed === true,
    hasBackgroundWork: raw.hasBackgroundWork === true,
    isPinned: raw.isPinned === true,
    isParked: raw.isParked === true,
    isDraft: raw.isDraft === true,
    isBrowser: raw.isBrowser === true,
    coordinatorProjectId: raw.coordinatorProjectId ?? '',
    coordinatorSessionId: raw.coordinatorSessionId ?? '',
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
    sessions: (machine.sessions as Json[]).map((session) => sessionOf(session, machine.serverId)),
  }));
}

const ids = (rows: UnifiedRow[]) => rows.map((row) => row.id);

/** What the fixture records of a row with threads under it (fixture_tests.rs `crew_answer`). */
function crewAnswer(crew: UnifiedCrew): Json {
  const folded = crew.foldedStatus;
  return {
    key: crew.key,
    open: crew.open,
    unfolded: crew.unfolded,
    total: crew.total,
    listed: crew.listed,
    older: crew.older,
    olderShown: crew.olderShown,
    olderRow: crew.olderRow,
    badgeCount: crew.badge.count,
    badgeTone: crew.badge.tone,
    folded: (
      [
        [folded.working, 'working'],
        [folded.attention, 'attention'],
        [folded.backgroundWork, 'backgroundWork'],
        [folded.question, 'question'],
        [folded.approval, 'approval'],
      ] as const
    )
      .filter(([on]) => on)
      .map(([, name]) => name),
    containsActive: crew.containsActive,
  };
}

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
          query: fixtureCase.filter?.query ?? '',
        },
        fixtureCase.nowMs,
        {
          unfolded: fixtureCase.folds?.unfolded ?? [],
          olderShown: fixtureCase.folds?.olderShown ?? [],
          reveal: fixtureCase.folds?.reveal,
        },
      );
      const order: string[] = fixtureCase.order ?? [];
      assert.deepEqual(
        groupUnifiedList(view, order).map((group) => ({
          repoKey: group.repoKey,
          label: group.label,
          pinned: ids(group.pinned),
          active: ids(group.active),
          working: ids(group.working),
          snoozed: ids(group.snoozed),
          parked: ids(group.parked),
        })),
        expected.groups,
        'groups',
      );
      assert.deepEqual(
        ((fixtureCase.moves ?? []) as Json[]).map((step) =>
          moveUnifiedProject(order, view.options.repos, step.moved, step.target, step.after === true),
        ),
        expected.moves,
        'moves',
      );
      const allChoices = unifiedProjectChoices(
        (fixtureCase.machines as Json[]).map((machine) => ({
          machine: machine.machine,
          label: machine.label,
          connected: machine.connected !== false,
          projects: (machine.projects as Json[]).map((project) => ({
            projectId: project.projectId,
            title: project.title,
            path: project.path,
            gitRemoteOriginUrl: project.gitRemoteOriginUrl ?? null,
            worktreeParentPath: project.worktreeParentPath ?? null,
            hasSessions: (machine.sessions as Json[]).some(
              (session) => session.projectId === project.projectId && session.isBrowser !== true,
            ),
            lastActivityMs: (machine.sessions as Json[])
              .filter((session) => session.projectId === project.projectId && session.isBrowser !== true)
              .map((session) => session.lastInteractionMs)
              .filter((at): at is number => typeof at === 'number')
              .reduce<number | null>((newest, at) => (newest === null ? at : Math.max(newest, at)), null),
          })),
        })),
        fixtureCase.lastMachines ?? {},
        fixtureCase.recentRepos ?? [],
        fixtureCase.currentMachine ?? 'local',
      );
      assert.deepEqual(filterProjectChoices(allChoices, fixtureCase.choiceQuery ?? ''), expected.choices, 'choices');
      const filter = {
        repos: fixtureCase.filter?.repos ?? [],
        machines: fixtureCase.filter?.machines ?? [],
        spaces: fixtureCase.filter?.spaces ?? [],
        query: fixtureCase.filter?.query ?? '',
      };
      const activeMachine: string = fixtureCase.activeMachine ?? 'local';
      const activeProject = (fixtureCase.machines as Json[])
        .find((machine) => machine.machine === activeMachine)
        ?.projects.find((project: Json) => project.projectId === fixtureCase.activeProjectId);
      const active =
        activeProject === undefined
          ? null
          : {
              repoKey: repoIdentity(
                activeProject.gitRemoteOriginUrl ?? null,
                activeProject.path,
                activeProject.worktreeParentPath ?? null,
                activeProject.title,
              ).key,
              machineId: activeMachine,
              projectId: activeProject.projectId,
            };
      assert.deepEqual(unifiedNewSessionTarget(filter, allChoices, active), expected.newSessionTarget, 'new session target');
      const created: Json | undefined = fixtureCase.createdIn;
      const widened =
        created === undefined
          ? null
          : widenFilterForNewSession(filter, created.repoKey, created.machineId, created.spaceKey ?? null);
      assert.deepEqual(
        widened === null ? null : { repos: widened.repos, machines: widened.machines, spaces: widened.spaces },
        expected.widenedFilter,
        'widened filter',
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
      const crews: Record<string, Json> = {};
      const lines: Record<string, string[]> = {};
      for (const card of [...view.drafts, ...view.pinned, ...view.active, ...view.working, ...view.snoozed, ...view.parked]) {
        for (const row of rowsInTree(card)) if (row.crew !== null) crews[row.id] = crewAnswer(row.crew);
        const drawn = drawnLines(card).map((line) =>
          line.kind === 'thread' ? `${line.row.id}@${line.depth}` : `older:${line.coordinator.id}@${line.depth}`,
        );
        if (drawn.length > 0) lines[card.id] = drawn;
      }
      assert.deepEqual(crews, expected.crews, 'crews');
      assert.deepEqual(lines, expected.lines, 'lines');
    });
  }
});
