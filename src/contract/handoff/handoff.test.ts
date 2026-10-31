/// <reference types="node" />
/**
 * The Rust functions' answers, run through the phone's port. `handoffFixture.json` is written by
 * packages/gx-core/src/handoff_fixture_tests.rs; a change there that this port does not follow
 * fails here. Run with `bun test src/contract/handoff/handoff.test.ts` from apps/mobile/app.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import {
  branchDifferenceLine,
  computerStagesLineBreaks,
  handoffBranchNoticeApplies,
  handoffComputer,
  handoffComputers,
  handoffDestinationLabel,
  handoffDestinationSummary,
  handoffDraft,
  handoffIsElsewhere,
  handoffLeadIn,
  handoffPrefsJson,
  handoffProject,
  handoffProjectLabel,
  openingHandoffDestination,
  parseHandoffPrefs,
  rankHandoffComputer,
  rememberedHandoffDestination,
  repositoryDisplayName,
  repositoryKey,
  singleLineHandoffDraft,
  type HandoffMachineInput,
} from './handoff';

type Case = Record<string, any>;

const fixture = JSON.parse(readFileSync(join(__dirname, 'handoffFixture.json'), 'utf8')) as { cases: Case[] };

function answer(item: Case): unknown {
  switch (item.kind) {
    case 'draft':
      return {
        leadIn: handoffLeadIn(item.sessionTitle, item.projectTitle),
        draft: handoffDraft(item.path, item.sessionTitle, item.projectTitle),
      };
    case 'repository':
      return { key: repositoryKey(item.url), name: repositoryDisplayName(item.url) };
    case 'computer': {
      const ranked = rankHandoffComputer(item.originUrl, item.sourcePath, item.candidates, item.ownProject);
      return {
        choices: ranked.choices.map((choice) => ({
          projectId: choice.projectId,
          sameRepo: choice.sameRepo,
          isOwn: choice.isOwn,
          label: handoffProjectLabel(choice.title, choice.isOwn, choice.sameRepo, choice.path),
        })),
        preferredProjectId: ranked.preferredProjectId,
        missingRepository: ranked.missingRepository,
      };
    }
    case 'branch':
      return { line: branchDifferenceLine(item.source, item.target, item.label) };
    case 'button':
      return { label: handoffDestinationLabel(item.projectTitle, item.computerLabel, item.isSource) };
    case 'prefs':
      return handoffPrefsJson(parseHandoffPrefs(item.saved));
    case 'destination': {
      const offered = item.offered as { machineId: string; projectId: string }[];
      return {
        destination: rememberedHandoffDestination(item.remembered, item.own, (destination) =>
          offered.some(
            (entry) => entry.machineId === destination.machineId && entry.projectId === destination.projectId,
          ),
        ),
      };
    }
    default:
      throw new Error(`unknown case kind ${item.kind}`);
  }
}

describe('the phone port gives the Rust answers', () => {
  for (const item of fixture.cases) {
    test(item.name, () => {
      assert.deepEqual(answer(item), item.expected);
    });
  }
});

describe('the handoff draft', () => {
  test('holds the lead-in, a blank line, the link, and leaves the caret two lines below', () => {
    const draft = handoffDraft('/tmp/a.md', 'Landing page ideas', 'Scratch');
    assert.equal(
      draft,
      'You are continuing from "Landing page ideas" in Scratch.\n\n[Landing page ideas Handoff](/tmp/a.md)\n\n',
    );
    // The composer puts the caret at the end of the text (`composer.ts` `replace`).
    assert.equal(draft.slice(draft.lastIndexOf(')') + 1), '\n\n');
  });

  test('has no line break for a computer that would type it raw', () => {
    assert.equal(
      singleLineHandoffDraft(handoffDraft('/tmp/a.md', 'T', 'P')),
      'You are continuing from "T" in P. [T Handoff](/tmp/a.md) ',
    );
  });

  test('keeps its line breaks only from a version with the staged paste', () => {
    for (const version of ['10.41.1', '10.42.0', '11.0.0', 'v10.41.2']) assert.equal(computerStagesLineBreaks(version), true);
    for (const version of ['10.41.0', '10.40.9', '9.99.0', '', 'unknown', null]) assert.equal(computerStagesLineBreaks(version), false);
  });
});

describe('the project choices', () => {
  const origin = 'git@github.com:o/ghostex.git';
  const candidate = (projectId: string, path: string | null, originUrl: string | null = null) => ({
    projectId,
    title: projectId,
    path,
    originUrl,
    isWorktree: false,
  });
  const machines: HandoffMachineInput[] = [
    { machineId: 'studio', label: 'Studio', connected: true, projects: [candidate('notes', '~/notes'), candidate('main', '~/Ghostex', origin)] },
    { machineId: 'gone', label: 'Gone', connected: false, projects: [candidate('old', '~/old')] },
    { machineId: 'mac', label: 'Macbook', connected: true, projects: [candidate('own', '/dev/ghostex', origin), candidate('acme', '/dev/acme'), candidate('nopath', null)] },
  ];
  const computers = handoffComputers(machines, { machineId: 'mac', projectId: 'own' });

  test("the session's own computer comes first, a disconnected one not at all", () => {
    assert.deepEqual(computers.map((computer) => [computer.machineId, computer.isSource]), [['mac', true], ['studio', false]]);
  });

  test('it starts on this project, and a project with no folder is no choice', () => {
    assert.deepEqual(computers[0]!.choices.map((choice) => choice.projectId), ['own', 'acme']);
    assert.equal(computers[0]!.choices[0]!.isOwn, true);
    assert.equal(computers[0]!.preferredProjectId, 'own');
    assert.equal(computers[0]!.missingRepository, null);
  });

  test('another computer picks the same repository', () => {
    const studio = handoffComputer(computers, 'studio')!;
    assert.equal(handoffProject(studio, null)?.projectId, 'main');
    assert.equal(handoffProject(studio, 'notes')?.projectId, 'notes');
    assert.equal(handoffProject(studio, 'missing')?.projectId, 'main');
  });

  test('a computer that left the list falls back to the first', () => {
    assert.equal(handoffComputer(computers, 'gone')?.machineId, 'mac');
  });

  test('the destination row always says where it goes', () => {
    const own = computers[0]!;
    const studio = computers[1]!;
    assert.equal(handoffDestinationSummary(false, own, own.choices[1]!), 'This project, same computer');
    assert.equal(handoffDestinationSummary(true, own, own.choices[0]!), 'This project, same computer');
    assert.equal(handoffDestinationSummary(true, own, own.choices[1]!), 'acme, same computer');
    assert.equal(handoffDestinationSummary(true, studio, studio.choices[0]!), 'main on Studio');
    assert.equal(handoffDestinationSummary(true, studio, null), 'Pick a project');
    assert.equal(handoffIsElsewhere(own, own.choices[0]!), false);
    assert.equal(handoffIsElsewhere(own, own.choices[1]!), true);
    assert.equal(handoffIsElsewhere(studio, studio.choices[0]!), true);
  });

  test('a remembered destination opens only while it still applies', () => {
    const open = (machineId: string, projectId: string) =>
      openingHandoffDestination({ machineId, projectId }, computers);
    assert.deepEqual(open('mac', 'acme'), { machineId: 'mac', projectId: 'acme' });
    assert.deepEqual(open('studio', 'notes'), { machineId: 'studio', projectId: 'notes' });
    assert.equal(open('mac', 'own'), null);
    assert.equal(open('mac', 'gone'), null);
    assert.equal(open('gone', 'old'), null);
    assert.equal(openingHandoffDestination(null, computers), null);
  });

  test('the branch notice skips another repository on the own computer only', () => {
    const own = computers[0]!;
    const studio = computers[1]!;
    assert.equal(handoffBranchNoticeApplies(own, own.choices[1]!), false);
    assert.equal(handoffBranchNoticeApplies(own, { ...own.choices[1]!, sameRepo: true }), true);
    assert.equal(handoffBranchNoticeApplies(studio, studio.choices[1]!), true);
  });
});

describe('what the sheet remembers', () => {
  test('nothing saved is the agent card, with Include closed and off', () => {
    const prefs = parseHandoffPrefs(null);
    assert.equal(prefs.card, 'agent');
    assert.equal(prefs.includeOpen, false);
    assert.deepEqual(prefs.include, { commands: false, patches: false, reasoning: false });
  });

  test("the phone's old saved mode keeps its card", () => {
    assert.equal(parseHandoffPrefs({ mode: 'export' }).card, 'markdown');
    assert.equal(parseHandoffPrefs({ mode: 'handoff' }).card, 'agent');
  });

  test('what the user changes comes back', () => {
    const prefs = {
      card: 'markdown' as const,
      include: { commands: true, patches: false, reasoning: true },
      includeOpen: true,
      agentId: 'codex',
      destination: { machineId: 'studio', projectId: 'acme' },
      destinationOpen: true,
    };
    assert.deepEqual(parseHandoffPrefs(handoffPrefsJson(prefs)), prefs);
  });
});
