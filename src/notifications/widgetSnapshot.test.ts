/// <reference types="node" />
/**
 * Run with `bun test src/notifications/widgetSnapshot.test.ts`. The Home Screen widgets' data: the real
 * `buildSnapshot` on summary fixtures in the CLI's wire form (read by the real summary parser), the real
 * `buildUsageBars` on a computer's `agentAccounts` answer, and the real writer with a fake App Group file writer and
 * a fake `WidgetCenter`, with an injected clock. Expected values come from the widget snapshot contract
 * (format version 2) and the widget design: counts of working and waiting agents,
 * the attention marker while one waits, the agents waiting first (oldest first inside a state), at most eight,
 * the data time, usage bars only where usage exists, and no prompt, reply or title text.
 *
 * With `WIDGET_SNAPSHOT_OUT=<dir>` every file the fake App Group writer receives is also saved there, so the same
 * run's output can be inspected or checked outside the test.
 */

import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { parseMobileSummary, type GhostexMobileSummary } from '../contract/mobileSummary';
import { buildUsageBars, type UsageBar } from '../usage/usageMeters';
import type { ActivitySource } from './contentState';
import oneWaiting from './fixtures/summary-1wait.json';
import twoWorkingOneWaiting from './fixtures/summary-2w-1wait.json';
import twoWaitingOneWorkingTwoFinished from './fixtures/summary-2wait-1w-2fin.json';
import fourWorkingTwoWaiting from './fixtures/summary-4w-2wait.json';
import olderHost from './fixtures/summary-older-host.json';
import { buildSnapshot, MAX_WIDGET_AGENTS, type WidgetSnapshot } from './widgetSnapshot';
import {
  createWidgetWriter,
  USAGE_MAX_AGE_MS,
  USAGE_READ_EVERY_MS,
  type WidgetHost,
  type WidgetInputs,
} from './widgetWriter';

const MACHINE = 'f3b2c1d0-1111-4222-8333-944445555666';
const OTHER_MACHINE = 'a0a0a0a0-2222-4333-8444-955556666777';
/** The refresh at 10:42 of the widget criteria. */
const NOW = Date.parse('2026-10-24T10:42:00Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function summary(fixture: unknown): GhostexMobileSummary {
  const parsed = parseMobileSummary(JSON.stringify(fixture));
  assert.ok(parsed !== null, 'the fixture parses as a mobile summary');
  return parsed;
}

function sources(fixture: unknown, loadedAt = NOW, machineId = MACHINE): ActivitySource[] {
  return [{ machineId, summary: summary(fixture), loadedAt }];
}

/** Ten agents: six working (oldest 10:00) and four waiting (oldest 10:30), interleaved in the wire order. */
const tenAgents = {
  sessions: Array.from({ length: 10 }, (_, index) => {
    const waits = index % 5 === 1 || index % 5 === 3;
    const base = { sessionId: `s${index}`, agent: 'claude', projectName: `p${index}`, provider: 'zmx' };
    const at = new Date(Date.parse('2026-10-24T10:00:00Z') + index * MINUTE).toISOString();
    return waits
      ? { ...base, activity: 'attention', attention: { enteredAt: at, kind: 'needsInput' } }
      : { ...base, activity: 'working', workingStartedAt: at };
  }),
};

function usageWindow(id: string, seconds: number, percent: unknown, resetMs: number | null) {
  return {
    id,
    label: id,
    usedPercent: percent,
    limitWindowSeconds: seconds,
    ...(resetMs === null ? {} : { resetsAt: new Date(resetMs).toISOString() }),
  };
}

function account(id: string, provider: string, name: string, usage: unknown[]) {
  return { id, provider, name, email: `${id}@example.com`, registered: true, userDisabled: false, usage };
}

/** The usage fixture: a Claude account at 40 % and a Codex account at 70 % (5-hour windows), with their weeks. */
const accountsAnswer = {
  accounts: [
    account('work', 'claude', 'claude work', [
      usageWindow('fiveHour', 18_000, 40, NOW + 2 * HOUR + 14 * MINUTE),
      usageWindow('sevenDay', 604_800, 23, NOW + 78 * HOUR),
    ]),
    account('team', 'codex', 'codex team', [
      usageWindow('fiveHour', 18_000, 70, NOW + HOUR + 5 * MINUTE),
      usageWindow('sevenDay', 604_800, 35, NOW + 98 * HOUR),
    ]),
  ],
};

/** The existing core bridge's projected window names for this wire fixture, in account/window order. */
const accountColumns = [
  { usage: [{ name: '5h' }, { name: '7d' }] },
  { usage: [{ name: '5h' }, { name: '7d' }] },
];

describe('the snapshot', () => {
  test('two working and one waiting agent: the counts are working 2 and waiting 1', () => {
    assert.deepEqual(buildSnapshot(sources(twoWorkingOneWaiting), NOW).counts, { working: 2, waiting: 1 });
  });

  test('a waiting agent sets the attention marker; with nobody waiting it is off', () => {
    assert.equal(buildSnapshot(sources(twoWorkingOneWaiting), NOW).attention, true);
    const noneWaiting = {
      sessions: twoWorkingOneWaiting.sessions.filter((session) => session.activity === 'working'),
    };
    assert.equal(buildSnapshot(sources(noneWaiting), NOW).attention, false);
  });

  test('six agents are listed waiting first, the longest wait and the longest work first inside each state', () => {
    const snapshot = buildSnapshot(sources(fourWorkingTwoWaiting), NOW);
    assert.deepEqual(
      snapshot.agents.map((agent) => [agent.state, agent.sinceAt]),
      [
        ['waiting', '2026-10-24T10:39:00.000Z'],
        ['waiting', '2026-10-24T10:41:00.000Z'],
        ['working', '2026-10-24T10:20:00.000Z'],
        ['working', '2026-10-24T10:25:00.000Z'],
        ['working', '2026-10-24T10:30:00.000Z'],
        ['working', '2026-10-24T10:35:00.000Z'],
      ],
    );
  });

  test('ten agents with usage data: at most eight agents, the eight first in order, and the usage bars', () => {
    const snapshot = buildSnapshot(sources(tenAgents), NOW, buildUsageBars(accountsAnswer, accountColumns));
    assert.equal(MAX_WIDGET_AGENTS, 8);
    assert.equal(snapshot.agents.length, 8);
    assert.deepEqual(snapshot.counts, { working: 6, waiting: 4 });
    assert.deepEqual(
      snapshot.agents.map((agent) => agent.project),
      ['p1', 'p3', 'p6', 'p8', 'p0', 'p2', 'p4', 'p5'],
    );
    assert.ok(snapshot.usage !== undefined && snapshot.usage.bars.length > 0);
  });

  test('a refresh at 10:42: the data time is 10:42', () => {
    assert.equal(buildSnapshot(sources(twoWorkingOneWaiting, NOW), NOW).writtenAt, '2026-10-24T10:42:00.000Z');
  });

  test('two computers, one last read at 10:30: the data time is the older read, as the Live Activity shows it', () => {
    const both = [
      ...sources(twoWorkingOneWaiting, NOW),
      ...sources(oneWaiting, Date.parse('2026-10-24T10:30:00Z'), OTHER_MACHINE),
    ];
    const snapshot = buildSnapshot(both, NOW);
    assert.equal(snapshot.writtenAt, '2026-10-24T10:30:00.000Z');
    // Every computer's agents count.
    assert.deepEqual(snapshot.counts, { working: 2, waiting: 2 });
  });

  test('finished agents are neither counted nor listed', () => {
    const snapshot = buildSnapshot(sources(twoWaitingOneWorkingTwoFinished), NOW);
    assert.deepEqual(snapshot.counts, { working: 1, waiting: 2 });
    assert.deepEqual(
      snapshot.agents.map((agent) => agent.state),
      ['waiting', 'waiting', 'working'],
    );
  });

  test('an agent whose computer sends no start time is counted but gets no row (no row without its time)', () => {
    const snapshot = buildSnapshot(sources(olderHost), NOW);
    assert.equal(snapshot.counts.working, 1);
    assert.ok(snapshot.agents.every((agent) => agent.sinceAt.length > 0));
    assert.ok(!snapshot.agents.some((agent) => agent.state === 'working'));
  });

  test('only the contract fields: no title, prompt or reply text, and no usage without usage data', () => {
    const snapshot = buildSnapshot(sources(twoWorkingOneWaiting), NOW);
    assert.deepEqual(Object.keys(snapshot).sort(), ['agents', 'attention', 'counts', 'schemaVersion', 'writtenAt']);
    assert.equal(snapshot.schemaVersion, 2);
    for (const agent of snapshot.agents) {
      assert.deepEqual(Object.keys(agent).sort(), ['agentIcon', 'agentName', 'agentTint', 'project', 'sinceAt', 'state']);
    }
    assert.ok(!JSON.stringify(snapshot).includes('must not leak'));
    assert.deepEqual(snapshot.agents[0], {
      agentName: 'omp',
      agentIcon: 'omp',
      agentTint: 0xC8FF62,
      project: 'Ghostex',
      state: 'waiting',
      sinceAt: '2026-10-24T10:40:00.000Z',
    });
  });
});

describe('the usage bars', () => {
  test('the fixture (Claude 40 %, Codex 70 %): every bar has the fixture’s label and percent, as the pane names them', () => {
    const bars = buildUsageBars(accountsAnswer, accountColumns);
    assert.deepEqual(
      bars.map((bar) => [bar.label, bar.usedPercent]),
      [
        ['Claude 5h', 40],
        ['Claude 7d', 23],
        ['Codex 5h', 70],
        ['Codex 7d', 35],
      ],
    );
    assert.equal(bars[0]?.resetsAt, new Date(NOW + 2 * HOUR + 14 * MINUTE).toISOString());
  });

  test('a provider with two accounts: each bar names its account', () => {
    const bars = buildUsageBars({
      accounts: [
        account('a', 'claude', 'Work', [usageWindow('fiveHour', 18_000, 10, null)]),
        account('b', 'claude', 'Home', [usageWindow('fiveHour', 18_000, 20, null)]),
        account('c', 'codex', 'codex c', [usageWindow('fiveHour', 18_000, 30, null)]),
      ],
    }, [{ usage: [{ name: '5h' }] }, { usage: [{ name: '5h' }] }, { usage: [{ name: '5h' }] }]);
    assert.deepEqual(
      bars.map((bar) => [bar.label, bar.usedPercent]),
      [
        ['Work 5h', 10],
        ['Home 5h', 20],
        ['Codex 5h', 30],
      ],
    );
    assert.equal(bars[0]?.resetsAt, undefined);
  });

  test('at most six bars, in the pane’s order; a window without a readable percent gets no bar; the bar stays within 0 to 100', () => {
    const windows = ['a', 'b', 'c', 'd'].map((id) => usageWindow(id, 18_000, 5, null));
    const bars = buildUsageBars({
      accounts: [
        account('x', 'claude', 'x', [usageWindow('broken', 18_000, 'n/a', null), ...windows]),
        account('y', 'codex', 'y', [usageWindow('over', 3_600, 112.5, null), ...windows]),
      ],
    }, [
      { usage: [{ name: '5h' }, { name: '5h' }, { name: '5h' }, { name: '5h' }, { name: '5h' }] },
      { usage: [{ name: '1h' }, { name: '5h' }, { name: '5h' }, { name: '5h' }, { name: '5h' }] },
    ]);
    assert.equal(bars.length, 6);
    assert.deepEqual(
      bars.map((bar) => [bar.label, bar.usedPercent]),
      [
        ['Claude 5h', 5],
        ['Claude 5h', 5],
        ['Claude 5h', 5],
        ['Claude 5h', 5],
        ['Codex 1h', 100],
        ['Codex 5h', 5],
      ],
    );
  });

  test('no saved account or no usage window: no bars, so the snapshot carries no usage', () => {
    assert.deepEqual(buildUsageBars({ accounts: [account('s', 'codex', 's', [])] }, []), []);
    assert.deepEqual(buildUsageBars(null, []), []);
    assert.equal(buildSnapshot(sources(oneWaiting), NOW, []).usage, undefined);
  });
});

/** A fake App Group file and `WidgetCenter`: what was written, removed and reloaded, in order. */
function fakeHost(failWrites = 0) {
  const calls: string[] = [];
  const written: WidgetSnapshot[] = [];
  let failures = failWrites;
  const out = process.env.WIDGET_SNAPSHOT_OUT;
  const host: WidgetHost = {
    write: (json) => {
      if (failures > 0) {
        failures -= 1;
        return Promise.reject(new Error('disk full'));
      }
      calls.push('write');
      written.push(JSON.parse(json) as WidgetSnapshot);
      if (out !== undefined && out.length > 0) {
        mkdirSync(out, { recursive: true });
        writeFileSync(join(out, `snapshot-${String(written.length)}-${String(Date.now())}.json`), json);
      }
      return Promise.resolve();
    },
    remove: () => {
      calls.push('remove');
      return Promise.resolve();
    },
    reloadTimelines: () => {
      calls.push('reload');
    },
  };
  return { host, calls, written };
}

function inputs(overrides: Partial<WidgetInputs> = {}): WidgetInputs {
  return {
    computersSaved: true,
    sources: sources(twoWorkingOneWaiting),
    selectedMachineId: MACHINE,
    polling: true,
    showSessionNames: false,
    ...overrides,
  };
}

describe('writing the snapshot after a refresh', () => {
  function setup(options: { failWrites?: number; usage?: () => Promise<readonly UsageBar[]> } = {}) {
    const fake = fakeHost(options.failWrites);
    let now = NOW;
    const usageReads: string[] = [];
    const errors: string[] = [];
    const writer = createWidgetWriter({
      host: fake.host,
      now: () => now,
      readUsageBars: (machineId) => {
        usageReads.push(machineId);
        return options.usage === undefined ? Promise.resolve([]) : options.usage();
      },
      onError: (message) => errors.push(message),
    });
    return { ...fake, writer, usageReads, errors, setNow: (time: number) => (now = time) };
  }

  test('a refresh writes the snapshot to the App Group and requests exactly one timeline reload', async () => {
    const run = setup();
    await run.writer.sync(inputs());
    assert.deepEqual(run.calls, ['write', 'reload']);
    assert.deepEqual(run.written[0]?.counts, { working: 2, waiting: 1 });
    assert.equal(run.written[0]?.writtenAt, '2026-10-24T10:42:00.000Z');
  });

  test('the next refresh in the same minute with nothing changed writes nothing; a change or a new minute does', async () => {
    const run = setup();
    await run.writer.sync(inputs());
    run.setNow(NOW + 5_000);
    await run.writer.sync(inputs({ sources: sources(twoWorkingOneWaiting, NOW + 5_000) }));
    assert.deepEqual(run.calls, ['write', 'reload']);

    run.setNow(NOW + 10_000);
    await run.writer.sync(inputs({ sources: sources(fourWorkingTwoWaiting, NOW + 10_000) }));
    assert.deepEqual(run.calls, ['write', 'reload', 'write', 'reload']);

    run.setNow(NOW + MINUTE);
    await run.writer.sync(inputs({ sources: sources(fourWorkingTwoWaiting, NOW + MINUTE) }));
    assert.equal(run.written.length, 3);
    assert.equal(run.written[2]?.writtenAt, '2026-10-24T10:43:00.000Z');
  });

  test('before any summary was read nothing is written; with the last computer removed the snapshot is deleted once', async () => {
    const run = setup();
    await run.writer.sync(inputs({ sources: [] }));
    assert.deepEqual(run.calls, []);
    await run.writer.sync(inputs());
    await run.writer.sync(inputs({ computersSaved: false, sources: [], selectedMachineId: null }));
    await run.writer.sync(inputs({ computersSaved: false, sources: [], selectedMachineId: null }));
    assert.deepEqual(run.calls, ['write', 'reload', 'remove', 'reload']);
  });

  test('a failed write is logged and the next refresh writes again', async () => {
    const run = setup({ failWrites: 1 });
    // Without the poll, so no usage read adds a write of its own.
    await run.writer.sync(inputs({ polling: false }));
    assert.deepEqual(run.calls, []);
    assert.equal(run.errors.length, 1);
    await run.writer.sync(inputs({ polling: false }));
    assert.deepEqual(run.calls, ['write', 'reload']);
  });
});

describe('reading the usage for the widget', () => {
  test('the selected computer’s usage is read at once, then at most every 2 minutes while the poll runs', async () => {
    const run = (() => {
      const fake = fakeHost();
      let now = NOW;
      const reads: string[] = [];
      const writer = createWidgetWriter({
        host: fake.host,
        now: () => now,
        readUsageBars: (machineId) => {
          reads.push(machineId);
          return Promise.resolve(buildUsageBars(accountsAnswer, accountColumns));
        },
        onError: () => undefined,
      });
      return { ...fake, writer, reads, setNow: (time: number) => (now = time) };
    })();
    assert.equal(USAGE_READ_EVERY_MS, 2 * MINUTE);

    await run.writer.sync(inputs());
    assert.deepEqual(run.reads, [MACHINE]);
    // The answer is written with the next write, here at once after it came.
    assert.deepEqual(
      run.written.at(-1)?.usage?.bars.map((bar) => [bar.label, bar.usedPercent]),
      [
        ['Claude 5h', 40],
        ['Claude 7d', 23],
        ['Codex 5h', 70],
        ['Codex 7d', 35],
      ],
    );

    for (const offset of [5_000, 60_000, 115_000]) {
      run.setNow(NOW + offset);
      await run.writer.sync(inputs({ sources: sources(twoWorkingOneWaiting, NOW + offset) }));
    }
    assert.equal(run.reads.length, 1);

    run.setNow(NOW + 2 * MINUTE);
    await run.writer.sync(inputs({ sources: sources(twoWorkingOneWaiting, NOW + 2 * MINUTE) }));
    assert.equal(run.reads.length, 2);

    // Without the poll (the app in the background) nothing is read.
    run.setNow(NOW + 10 * MINUTE);
    await run.writer.sync(inputs({ polling: false }));
    assert.equal(run.reads.length, 2);

    // Another computer selected: its usage is read at once.
    run.setNow(NOW + 10 * MINUTE + 5_000);
    await run.writer.sync(inputs({ selectedMachineId: OTHER_MACHINE }));
    assert.deepEqual(run.reads.slice(2), [OTHER_MACHINE]);
  });

  test('switching A, B and back to A within 2 minutes reads A once; A’s own bars come back with it', async () => {
    const fake = fakeHost();
    let now = NOW;
    const reads: string[] = [];
    const otherBars = buildUsageBars({ accounts: [accountsAnswer.accounts[1]] }, [accountColumns[1]]);
    let answerA: Promise<readonly UsageBar[]> = Promise.resolve(buildUsageBars(accountsAnswer, accountColumns));
    const writer = createWidgetWriter({
      host: fake.host,
      now: () => now,
      readUsageBars: (machineId) => {
        reads.push(machineId);
        return machineId === MACHINE ? answerA : Promise.resolve(otherBars);
      },
      onError: () => undefined,
    });
    const labels = () => fake.written.at(-1)?.usage?.bars.map((bar) => bar.label);

    // A sequence: A at 0 s, B at 5 s, A again at 10 s, while the poll runs.
    await writer.sync(inputs());
    now = NOW + 5_000;
    await writer.sync(inputs({ selectedMachineId: OTHER_MACHINE }));
    assert.deepEqual(labels(), ['Codex 5h', 'Codex 7d']);
    now = NOW + 10_000;
    await writer.sync(inputs({ sources: sources(fourWorkingTwoWaiting, now) }));
    assert.deepEqual(reads, [MACHINE, OTHER_MACHINE]);
    assert.deepEqual(labels(), ['Claude 5h', 'Claude 7d', 'Codex 5h', 'Codex 7d']);

    // 2 minutes after A's read, A is read again.
    now = NOW + 2 * MINUTE;
    await writer.sync(inputs());
    assert.deepEqual(reads, [MACHINE, OTHER_MACHINE, MACHINE]);

    // A read of A still running when B is selected and A again: A is not read a second time.
    const slowA = Promise.withResolvers<readonly UsageBar[]>();
    answerA = slowA.promise;
    now = NOW + 5 * MINUTE;
    const pending = writer.sync(inputs());
    now = NOW + 5 * MINUTE + 5_000;
    await writer.sync(inputs({ selectedMachineId: OTHER_MACHINE }));
    now = NOW + 5 * MINUTE + 10_000;
    const back = writer.sync(inputs());
    assert.deepEqual(reads.slice(3), [MACHINE, OTHER_MACHINE]);
    slowA.resolve(buildUsageBars(accountsAnswer, accountColumns));
    await Promise.all([pending, back]);
    assert.deepEqual(labels(), ['Claude 5h', 'Claude 7d', 'Codex 5h', 'Codex 7d']);
  });

  test('bars older than 5 minutes or of another computer are not written', async () => {
    const fake = fakeHost();
    let now = NOW;
    let answer: Promise<readonly UsageBar[]> = Promise.resolve(buildUsageBars(accountsAnswer, accountColumns));
    const writer = createWidgetWriter({
      host: fake.host,
      now: () => now,
      readUsageBars: () => answer,
      onError: () => undefined,
    });
    await writer.sync(inputs());
    assert.ok(fake.written.at(-1)?.usage !== undefined);

    // Later reads fail (the computer does not answer): the last bars stay until they are 5 minutes old.
    answer = Promise.reject(new Error('unreachable'));
    now = NOW + USAGE_MAX_AGE_MS;
    await writer.sync(inputs({ sources: sources(twoWorkingOneWaiting, now) }));
    assert.ok(fake.written.at(-1)?.usage !== undefined);
    now = NOW + USAGE_MAX_AGE_MS + MINUTE;
    await writer.sync(inputs({ sources: sources(twoWorkingOneWaiting, now) }));
    assert.equal(fake.written.at(-1)?.usage, undefined);

    // A reading of another computer is not shown for the selected one.
    now = NOW;
    const other = createWidgetWriter({
      host: fake.host,
      now: () => now,
      readUsageBars: () => Promise.resolve(buildUsageBars(accountsAnswer, accountColumns)),
      onError: () => undefined,
    });
    await other.sync(inputs({ selectedMachineId: OTHER_MACHINE }));
    now = NOW + 5_000;
    await other.sync(inputs({ selectedMachineId: MACHINE, polling: false, sources: sources(fourWorkingTwoWaiting) }));
    assert.equal(fake.written.at(-1)?.usage, undefined);
  });
});
