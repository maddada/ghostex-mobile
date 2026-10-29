/// <reference types="node" />
/** Run with `bun test src/components/sessions/agentChoice.test.ts` from apps/mobile/app. */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  agentChoiceCandidates,
  agentChoicePlace,
  EMPTY_AGENT_CHOICES,
  MAX_REMEMBERED_AGENT_CHOICES,
  parseAgentChoiceScope,
  readAgentChoiceMap,
  rememberAgentChoice,
  resolveAgentChoice,
  type AgentChoices,
  type AgentChoiceScope,
} from './agentChoice';

const agents = [{ agentId: 'claude' }, { agentId: 'codex' }];
// Sam's case: Harbor and Regula are both in the Work Space.
const harbor = agentChoicePlace('m1', 'harbor', '', 'work');
const regula = agentChoicePlace('m1', 'regula', '', 'work');
const legal = agentChoicePlace('m1', 'legal', '', 'work');
const home = agentChoicePlace('m1', 'home', '', 'personal');

function picked(): AgentChoices {
  // An existing phone's one stored pick (Claude), then Codex picked in Regula.
  return rememberAgentChoice({ ...EMPTY_AGENT_CHOICES, last: 'claude' }, 'codex', regula);
}

function started(choices: AgentChoices, scope: AgentChoiceScope, place = harbor, offered = agents): string | null {
  return resolveAgentChoice(offered, choices, scope, place)?.agentId ?? null;
}

describe('per project (the default)', () => {
  test('each project keeps its own pick', () => {
    const choices = rememberAgentChoice(picked(), 'claude', harbor);
    assert.equal(started(choices, 'project', regula), 'codex');
    assert.equal(started(choices, 'project', harbor), 'claude');
  });

  test('a project with no pick yet starts the last pick anywhere', () => {
    assert.equal(started(picked(), 'project', legal), 'codex');
  });

  test('an older computer that sends no setting means per project', () => {
    assert.equal(parseAgentChoiceScope(undefined), 'project');
    assert.equal(parseAgentChoiceScope('galaxy'), 'project');
    assert.equal(parseAgentChoiceScope('space'), 'space');
    assert.equal(parseAgentChoiceScope('everywhere'), 'everywhere');
  });
});

describe('per Space', () => {
  test('every project in a Space starts that Space’s pick', () => {
    const choices = rememberAgentChoice(picked(), 'claude', home);
    assert.equal(started(choices, 'space', harbor), 'codex');
    assert.equal(started(choices, 'space', agentChoicePlace('m1', 'notes', '', 'personal')), 'claude');
  });

  test('with Spaces off there is one Space: the last pick', () => {
    const choices = rememberAgentChoice(picked(), 'claude', home);
    assert.equal(started(choices, 'space', agentChoicePlace('m1', 'harbor', '', null)), 'claude');
  });
});

describe('everywhere', () => {
  test('one pick for every project', () => {
    const choices = rememberAgentChoice(picked(), 'claude', harbor);
    assert.equal(started(choices, 'everywhere', regula), 'claude');
  });
});

describe('fallbacks and memory', () => {
  test('the existing stored pick is the starting value in every mode', () => {
    for (const scope of ['project', 'space', 'everywhere'] as const) {
      assert.equal(started({ ...EMPTY_AGENT_CHOICES, last: 'codex' }, scope), 'codex');
    }
  });

  test('a turned-off agent falls back to the last pick, then the first agent offered', () => {
    const choices = rememberAgentChoice(picked(), 'claude', harbor);
    assert.deepEqual(agentChoiceCandidates(choices, 'project', regula), ['codex', 'claude']);
    assert.equal(started(choices, 'project', regula, [{ agentId: 'claude' }]), 'claude');
    assert.equal(started(choices, 'project', regula, [{ agentId: 'pi' }]), 'pi');
    assert.equal(started(choices, 'project', regula, []), null);
  });

  test('a worktree shares its project’s pick, and machines keep their own', () => {
    const choices = picked();
    assert.equal(started(choices, 'project', agentChoicePlace('m1', 'regula-wt', 'regula', 'work')), 'codex');
    assert.deepEqual(agentChoicePlace('m2', 'regula', '', 'work'), { project: 'm2:regula', space: 'm2:work' });
    assert.equal(picked().byProject['m2:regula'], undefined);
  });

  test('a pick is remembered for the project, the Space and as the last pick', () => {
    assert.deepEqual(picked(), {
      last: 'codex',
      byProject: { 'm1:regula': 'codex' },
      bySpace: { 'm1:work': 'codex' },
    });
    const choices = picked();
    assert.equal(rememberAgentChoice(choices, '  ', harbor), choices);
  });

  test('stored maps read leniently and stay bounded', () => {
    assert.deepEqual(readAgentChoiceMap({ 'm1:a': 'pi', 'm1:b': 7, '': 'codex' }), { 'm1:a': 'pi' });
    assert.deepEqual(readAgentChoiceMap('nope'), {});
    let choices = EMPTY_AGENT_CHOICES;
    for (let index = 0; index < MAX_REMEMBERED_AGENT_CHOICES + 20; index += 1) {
      choices = rememberAgentChoice(choices, 'codex', agentChoicePlace('m1', `p${index}`, '', null));
    }
    assert.equal(Object.keys(choices.byProject).length, MAX_REMEMBERED_AGENT_CHOICES);
  });
});
