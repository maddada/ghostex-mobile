/**
 * The Live Activity's rows, counts and "+N more", finished rows, the condition on current computers, the row link
 * (content side) and "has a question": the real `buildContentState` and `computersNeedingUpdate` on summary fixtures
 * in the CLI's wire form, read by the real summary parser, with an injected clock.
 *
 * The fixtures come from a computer that sends start times (`workingStartedAt` while working, and
 * `attention.workingStartedAt` for a finished agent) and the attention kind (`attention.kind`), except
 * `summary-older-host.json`, which has neither.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseMobileSummary, type GhostexMobileSummary } from '../contract/mobileSummary';
import { parseSessionLink } from '../app/deepLinkHandler';
import {
  buildContentState,
  computersNeedingUpdate,
  workingStints,
  type ActivitySource,
  type FinishedMemory,
} from './contentState';
import oneFinished from './fixtures/summary-1fin.json';
import oneWaiting from './fixtures/summary-1wait.json';
import oneWaitingQuestion from './fixtures/summary-1wait-question.json';
import twoWorkingOneWaiting from './fixtures/summary-2w-1wait.json';
import twoWaitingOneWorkingTwoFinished from './fixtures/summary-2wait-1w-2fin.json';
import fourWorkingOneFinished from './fixtures/summary-4w-1fin.json';
import fourWorkingTwoWaiting from './fixtures/summary-4w-2wait.json';
import longNames from './fixtures/summary-long-names.json';
import olderHost from './fixtures/summary-older-host.json';
import sameAgentProject from './fixtures/summary-same-agent-project.json';

const MACHINE = 'f3b2c1d0-1111-4222-8333-944445555666';
const NOW = Date.parse('2026-10-24T10:42:00Z');

function summary(fixture: unknown): GhostexMobileSummary {
  const parsed = parseMobileSummary(JSON.stringify(fixture));
  assert.ok(parsed !== null, 'the fixture parses as a mobile summary');
  return parsed;
}

function sources(fixture: unknown, loadedAt = NOW): ActivitySource[] {
  return [{ machineId: MACHINE, summary: summary(fixture), loadedAt }];
}

const sessionIds = (fixture: unknown, now = NOW) =>
  buildContentState(sources(fixture), now).agents.map((row) => row.target.sessionId);

describe('rows, order and counts', () => {
  test('two working and one waiting: the waiting agent first, then the working ones', () => {
    assert.deepEqual(sessionIds(twoWorkingOneWaiting), ['s-omp', 's-claude', 's-codex']);
    const states = buildContentState(sources(twoWorkingOneWaiting), NOW).agents.map((row) => row.state);
    assert.deepEqual(states, ['waiting', 'working', 'working']);
  });

  test('counts are working 2 and waiting 1, moreCount 0', () => {
    const state = buildContentState(sources(twoWorkingOneWaiting), NOW);
    assert.deepEqual(state.counts, { working: 2, waiting: 1 });
    assert.equal(state.moreCount, 0);
  });

  test('four working and two waiting: four rows, the two waiting first (oldest first)', () => {
    assert.deepEqual(sessionIds(fourWorkingTwoWaiting), ['q2', 'q1', 'w1', 'w2']);
  });

  test('moreCount 2, counts working 4 and waiting 2', () => {
    const state = buildContentState(sources(fourWorkingTwoWaiting), NOW);
    assert.equal(state.moreCount, 2);
    assert.deepEqual(state.counts, { working: 4, waiting: 2 });
  });

  test('two waiting, one working, two finished: the newest finished takes the free row', () => {
    assert.deepEqual(sessionIds(twoWaitingOneWorkingTwoFinished), ['a-wait', 'b-wait', 'c-work', 'd-fin30']);
  });

  test('moreCount 1, counts exclude the finished agents', () => {
    const state = buildContentState(sources(twoWaitingOneWorkingTwoFinished), NOW);
    assert.equal(state.moreCount, 1);
    assert.deepEqual(state.counts, { working: 1, waiting: 2 });
  });

  test('four working and one finished 30 s ago: four working rows, moreCount 1', () => {
    const state = buildContentState(sources(fourWorkingOneFinished), NOW);
    assert.deepEqual(
      state.agents.map((row) => [row.target.sessionId, row.state]),
      [
        ['w1', 'working'],
        ['w2', 'working'],
        ['w3', 'working'],
        ['w4', 'working'],
      ],
    );
    assert.equal(state.moreCount, 1);
  });

  test('names over 64 characters are cut to 64 characters, four-byte characters whole', () => {
    const [row] = buildContentState(sources(longNames), NOW).agents;
    assert.ok(row !== undefined);
    assert.equal(Array.from(row.agentName).length, 64);
    assert.equal(row.agentName, 'x'.repeat(64));
    assert.equal(Array.from(row.project).length, 64);
    assert.equal(row.project, '\u{1F916}'.repeat(64));
  });
});

describe('row content', () => {
  test('a row carries name, resolved mark, project, state, start and target, and no title or message text', () => {
    const [row] = buildContentState(sources(twoWorkingOneWaiting), NOW).agents;
    assert.deepEqual(row, {
      target: { machineId: MACHINE, sessionId: 's-omp' },
      agentName: 'omp',
      agentIcon: 'omp',
      agentTint: 0xC8FF62,
      project: 'Ghostex',
      state: 'waiting',
      startedAt: '2026-10-24T10:40:00.000Z',
    });
    const text = JSON.stringify(buildContentState(sources(twoWorkingOneWaiting), NOW));
    assert.ok(!text.includes('must not leak'), 'the session titles of the fixture never reach the state');
  });

  test('an explicit Codex icon on My helper carries the Codex mark, not the name fallback', () => {
    const [row] = buildContentState(
      sources({
        sessions: [
          {
            sessionId: 'helper',
            provider: 'zmx',
            agent: 'claude',
            agentName: 'My helper',
            agentIcon: 'codex',
            projectName: 'p',
            activity: 'working',
            workingStartedAt: '2026-10-24T10:30:00Z',
          },
        ],
      }),
      NOW,
    ).agents;
    assert.equal(row?.agentName, 'My helper');
    assert.equal(row?.agentIcon, 'codex');
    assert.equal(row?.agentTint, 0xFFFFFF);
  });

  test('two sessions of the same agent and project keep their own session ids', () => {
    const rows = buildContentState(sources(sameAgentProject), NOW).agents;
    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.agentName, rows[1]?.agentName);
    assert.equal(rows[0]?.project, rows[1]?.project);
    assert.deepEqual(
      rows.map((row) => row.target.sessionId),
      ['sess&1', 'sess&2'],
    );
  });

  test('the deep link of one same-named row opens exactly that session', () => {
    const rows = buildContentState(sources(sameAgentProject), NOW).agents;
    const second = rows[1];
    assert.ok(second !== undefined);
    // The link the extension builds (`GhostexActivityTarget.deepLink`, checked against the same literal by
    // the Swift test): ids percent-encoded, so `&` inside an id cannot cut the query.
    const url = 'ghostex://session?machineId=f3b2c1d0-1111-4222-8333-944445555666&sessionId=sess%262';
    assert.deepEqual(parseSessionLink(url), {
      machineId: second.target.machineId,
      sessionId: second.target.sessionId,
      title: '',
      view: null,
      source: null,
    });
    assert.notEqual(parseSessionLink(url)?.sessionId, rows[0]?.target.sessionId);
  });

  test('the data time is the oldest read of the summaries used', () => {
    const fresh = sources(twoWorkingOneWaiting, NOW - 5_000);
    const older = [{ machineId: 'second-machine', summary: summary(oneWaiting), loadedAt: NOW - 90_000 }];
    const state = buildContentState([...fresh, ...older], NOW);
    assert.equal(state.updatedAt, new Date(NOW - 90_000).toISOString());
    assert.deepEqual(state.counts, { working: 2, waiting: 2 });
  });
});

describe('finished agents', () => {
  const t0 = Date.parse('2026-10-24T10:40:00Z');

  test('119 s after finishing it is a finished row that expires at t0 + 120 s', () => {
    const state = buildContentState(sources(oneFinished), t0 + 119_000);
    assert.equal(state.agents.length, 1);
    assert.equal(state.agents[0]?.state, 'finished');
    assert.equal(state.agents[0]?.finishedAt, new Date(t0).toISOString());
    assert.equal(state.agents[0]?.expiresAt, new Date(t0 + 120_000).toISOString());
  });

  test('121 s after finishing it is neither a row nor counted in moreCount', () => {
    const state = buildContentState(sources(oneFinished), t0 + 121_000);
    assert.deepEqual(state.agents, []);
    assert.equal(state.moreCount, 0);
    assert.deepEqual(state.counts, { working: 0, waiting: 0 });
  });

  test('with four working agents the agent finished 30 s ago gets no row, moreCount counts it', () => {
    const state = buildContentState(sources(fourWorkingOneFinished), NOW);
    assert.ok(state.agents.every((row) => row.target.sessionId !== 'f1'));
    assert.equal(state.moreCount, 1);
  });

  test('a finished row runs from attention.workingStartedAt to attention.enteredAt, also on a cold start', () => {
    const [row] = buildContentState(sources(oneFinished), t0 + 30_000).agents;
    assert.equal(row?.startedAt, '2026-10-24T10:22:00.000Z');
    assert.equal(row?.finishedAt, '2026-10-24T10:40:00.000Z');
  });

  test('a finished row takes its start from attention.workingStartedAt, not from a top-level workingStartedAt', () => {
    const [row] = buildContentState(
      sources({
        sessions: [
          {
            sessionId: 'f',
            provider: 'zmx',
            agent: 'claude',
            projectName: 'p',
            activity: 'attention',
            attention: {
              enteredAt: '2026-10-24T10:40:00Z',
              kind: 'finished',
              workingStartedAt: '2026-10-24T10:22:00Z',
            },
            workingStartedAt: '2026-10-24T10:35:00Z',
          },
        ],
      }),
      t0 + 30_000,
    ).agents;
    assert.equal(row?.state, 'finished');
    assert.equal(row?.startedAt, '2026-10-24T10:22:00.000Z');
  });
});

describe('finished events the app has seen', () => {
  const t0 = Date.parse('2026-10-24T10:40:00Z');
  const agent = { sessionId: 'f', provider: 'zmx', agent: 'claude', projectName: 'p' };
  const finished = {
    ...agent,
    activity: 'attention',
    attention: { enteredAt: '2026-10-24T10:40:00Z', kind: 'finished', workingStartedAt: '2026-10-24T10:22:00Z' },
  };
  /** The same session once its finish was acknowledged on some device: the computer no longer sends `attention`. */
  const acknowledged = { ...agent, activity: 'idle' };
  const rowsAt = (memory: FinishedMemory, session: object, at: number) =>
    buildContentState(sources({ sessions: [session] }), at, memory);

  test('a finished row stays when its attention disappears, until 2 minutes after the finish', () => {
    const memory: FinishedMemory = new Map();
    rowsAt(memory, finished, t0 + 5_000);
    const at30 = rowsAt(memory, acknowledged, t0 + 30_000);
    assert.deepEqual(
      at30.agents.map((row) => [row.target.sessionId, row.state, row.startedAt, row.expiresAt]),
      [['f', 'finished', '2026-10-24T10:22:00.000Z', '2026-10-24T10:42:00.000Z']],
    );
    assert.deepEqual(at30.counts, { working: 0, waiting: 0 });
    const at120 = rowsAt(memory, acknowledged, t0 + 120_000);
    assert.deepEqual(at120.agents, []);
    assert.equal(at120.moreCount, 0);
  });

  test('a remembered finish is dropped at once when the session starts working', () => {
    const memory: FinishedMemory = new Map();
    rowsAt(memory, finished, t0 + 5_000);
    const working = { ...agent, activity: 'working', workingStartedAt: '2026-10-24T10:40:20Z' };
    assert.deepEqual(
      rowsAt(memory, working, t0 + 25_000).agents.map((row) => row.state),
      ['working'],
    );
    assert.deepEqual(rowsAt(memory, acknowledged, t0 + 30_000).agents, []);
  });

  test('a remembered finish is dropped at once when the session enters a new attention', () => {
    const memory: FinishedMemory = new Map();
    rowsAt(memory, finished, t0 + 5_000);
    const waits = {
      ...agent,
      activity: 'attention',
      attention: { enteredAt: '2026-10-24T10:40:20Z', kind: 'needsInput' },
    };
    assert.deepEqual(
      rowsAt(memory, waits, t0 + 25_000).agents.map((row) => row.state),
      ['waiting'],
    );
    assert.deepEqual(rowsAt(memory, acknowledged, t0 + 30_000).agents, []);
  });

  test('a remembered finish is offered only while its computer is among the summaries read', () => {
    const memory: FinishedMemory = new Map();
    rowsAt(memory, finished, t0 + 5_000);
    const other = [{ machineId: 'other-mac', summary: summary({ sessions: [acknowledged] }), loadedAt: t0 + 30_000 }];
    assert.deepEqual(buildContentState(other, t0 + 30_000, memory).agents, []);
  });
});

describe('pending question', () => {
  test('a waiting agent with a pending question has hasQuestion, state waiting, counted as waiting', () => {
    const state = buildContentState(sources(oneWaitingQuestion), NOW);
    assert.equal(state.agents[0]?.hasQuestion, true);
    assert.equal(state.agents[0]?.state, 'waiting');
    assert.equal(state.counts.waiting, 1);
  });

  test('without a pending question the row has no hasQuestion', () => {
    const [row] = buildContentState(sources(oneWaiting), NOW).agents;
    assert.ok(row !== undefined);
    assert.equal('hasQuestion' in row, false);
  });

  const waitingWith = (fields: object, capabilities?: object) => ({
    ...(capabilities === undefined ? {} : { capabilities }),
    sessions: [
      {
        sessionId: 'q',
        provider: 'zmx',
        agent: 'claude',
        projectName: 'p',
        activity: 'attention',
        attention: { enteredAt: '2026-10-24T10:40:00Z', kind: 'needsInput' },
        ...fields,
      },
    ],
  });
  const questionFlag = (fixture: unknown) => buildContentState(sources(fixture), NOW).agents[0]?.hasQuestion;

  test('an open question card counts only from a computer that announces awaitingAnswer', () => {
    assert.equal(questionFlag(waitingWith({ awaitingAnswer: true }, { awaitingAnswer: true })), true);
    assert.equal(questionFlag(waitingWith({ awaitingAnswer: true })), undefined);
    assert.equal(questionFlag(waitingWith({ awaitingAnswer: true }, { awaitingAnswer: false })), undefined);
  });

  test('a counted pending question alone gives hasQuestion, with or without the capability', () => {
    assert.equal(questionFlag(waitingWith({ pendingQuestionCount: 2 })), true);
    assert.equal(questionFlag(waitingWith({ pendingQuestionCount: 1 }, { awaitingAnswer: true })), true);
  });

  test('with neither source the waiting row has no hasQuestion', () => {
    assert.equal(
      questionFlag(waitingWith({ awaitingAnswer: false, pendingQuestionCount: 0 }, { awaitingAnswer: true })),
      undefined,
    );
  });

  test('a finished session with an open question card waits on the user: a waiting row with hasQuestion', () => {
    const finishedWithCard = waitingWith(
      {
        attention: { enteredAt: '2026-10-24T10:40:00Z', kind: 'finished', workingStartedAt: '2026-10-24T10:22:00Z' },
        awaitingAnswer: true,
      },
      { awaitingAnswer: true },
    );
    const state = buildContentState(sources(finishedWithCard), NOW);
    assert.deepEqual(
      state.agents.map((row) => [row.state, row.hasQuestion]),
      [['waiting', true]],
    );
    assert.deepEqual(state.counts, { working: 0, waiting: 1 });
  });
});

describe('every row has its time (startedAt)', () => {
  test('working rows start at workingStartedAt, waiting rows at attention.enteredAt', () => {
    const state = buildContentState(sources(twoWorkingOneWaiting), NOW);
    assert.deepEqual(
      state.agents.map((row) => [row.target.sessionId, row.state, row.startedAt]),
      [
        ['s-omp', 'waiting', '2026-10-24T10:40:00.000Z'],
        ['s-claude', 'working', '2026-10-24T10:30:00.000Z'],
        ['s-codex', 'working', '2026-10-24T10:35:00.000Z'],
      ],
    );
  });

  test('a wait without attention.enteredAt is counted, in moreCount, without a row', () => {
    const state = buildContentState(
      sources({
        sessions: [
          {
            sessionId: 'appr',
            provider: 'zmx',
            agent: 'codex',
            projectName: 'p',
            activity: 'working',
            awaitingApproval: true,
            workingStartedAt: '2026-10-24T10:30:00Z',
          },
        ],
      }),
      NOW,
    );
    assert.deepEqual(state.agents, []);
    assert.deepEqual(state.counts, { working: 0, waiting: 1 });
    assert.equal(state.moreCount, 1);
  });
});

describe('computers that send no start times or attention kind', () => {
  test('a summary with a working agent without workingStartedAt and an agent in attention without kind needs an update', () => {
    assert.deepEqual(computersNeedingUpdate(sources(olderHost)), [MACHINE]);
  });

  test('a working agent without workingStartedAt alone is enough', () => {
    const workingOnly = {
      sessions: [{ sessionId: 'w', provider: 'zmx', agent: 'claude', projectName: 'p', activity: 'working' }],
    };
    assert.deepEqual(computersNeedingUpdate(sources(workingOnly)), [MACHINE]);
  });

  test('an agent in attention without attention.kind alone is enough', () => {
    const attentionOnly = {
      sessions: [
        {
          sessionId: 'a',
          provider: 'zmx',
          agent: 'claude',
          projectName: 'p',
          activity: 'attention',
          attention: { enteredAt: '2026-10-24T10:41:00Z' },
        },
      ],
    };
    assert.deepEqual(computersNeedingUpdate(sources(attentionOnly)), [MACHINE]);
  });

  // A current computer leaves `attention.workingStartedAt` out when the attention came from idle, also after an
  // acknowledgement: the row has no duration, so it gets no row, but its computer is current.
  test('a finished agent without attention.workingStartedAt (from idle on a current Mac) needs no update and gets no row', () => {
    const finishedFromIdle = {
      sessionId: 'f',
      provider: 'zmx',
      agent: 'claude',
      projectName: 'p',
      activity: 'attention',
      attention: { enteredAt: '2026-10-24T10:41:00Z', kind: 'finished' },
      workingStartedAt: '2026-10-24T10:22:00Z',
    };
    const withWorking = { sessions: [finishedFromIdle, ...twoWorkingOneWaiting.sessions] };
    assert.deepEqual(computersNeedingUpdate(sources({ sessions: [finishedFromIdle] })), []);
    assert.deepEqual(computersNeedingUpdate(sources(withWorking)), []);
    const state = buildContentState(sources(withWorking), NOW);
    assert.ok(
      state.agents.every((row) => row.target.sessionId !== 'f'),
      'no row without its duration',
    );
    assert.deepEqual(state.counts, { working: 2, waiting: 1 });
    assert.equal(state.moreCount, 1);
    // The same row without `attention.kind` comes from a computer without the host changes: still listed.
    const olderRow = { ...finishedFromIdle, attention: { enteredAt: '2026-10-24T10:41:00Z' } };
    assert.deepEqual(computersNeedingUpdate(sources({ sessions: [olderRow] })), [MACHINE]);
  });

  test('attention.kind is finished or needsInput only: another value, such as bell, counts as no kind', () => {
    const otherKind = {
      sessions: [
        {
          sessionId: 'b',
          provider: 'zmx',
          agent: 'claude',
          projectName: 'p',
          activity: 'attention',
          attention: { enteredAt: '2026-10-24T10:41:00Z', kind: 'bell' },
        },
      ],
    };
    assert.deepEqual(computersNeedingUpdate(sources(otherKind)), [MACHINE]);
  });

  test('the fixtures of a current host need no update', () => {
    const fixtures = [
      oneFinished,
      oneWaiting,
      oneWaitingQuestion,
      twoWorkingOneWaiting,
      twoWaitingOneWorkingTwoFinished,
      fourWorkingOneFinished,
      fourWorkingTwoWaiting,
      longNames,
      sameAgentProject,
    ];
    for (const fixture of fixtures) assert.deepEqual(computersNeedingUpdate(sources(fixture)), []);
  });

  test('a summary without working or attention agents proves nothing and is not listed', () => {
    const idleOnly = {
      sessions: [{ sessionId: 'i', provider: 'zmx', agent: 'claude', projectName: 'p', activity: 'idle' }],
    };
    assert.deepEqual(computersNeedingUpdate(sources(idleOnly)), []);
  });

  test('with several computers only the one without the fields is listed', () => {
    const current = sources(twoWorkingOneWaiting);
    const older: ActivitySource[] = [{ machineId: 'older-mac', summary: summary(olderHost), loadedAt: NOW }];
    assert.deepEqual(computersNeedingUpdate([...current, ...older]), ['older-mac']);
  });
});

describe('working stints, which start the activity again', () => {
  test('every working agent with its session and stint start, also those without a row', () => {
    const state = buildContentState(sources(fourWorkingTwoWaiting), NOW);
    assert.deepEqual(
      state.agents.filter((row) => row.state === 'working').map((row) => row.target.sessionId),
      ['w1', 'w2'],
      'w3 and w4 have no row',
    );
    assert.deepEqual(workingStints(sources(fourWorkingTwoWaiting), NOW), [
      `${MACHINE}\nw1\n2026-10-24T10:20:00Z`,
      `${MACHINE}\nw2\n2026-10-24T10:25:00Z`,
      `${MACHINE}\nw3\n2026-10-24T10:30:00Z`,
      `${MACHINE}\nw4\n2026-10-24T10:35:00Z`,
    ]);
  });

  test('waiting and finished agents have no working stint', () => {
    assert.deepEqual(workingStints(sources(oneWaiting), NOW), []);
    assert.deepEqual(workingStints(sources(oneFinished), NOW), []);
  });
});
