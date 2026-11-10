/// <reference types="node" />
/**
 * Run with `bun test src/notifications/pushToken.test.ts`. The real registration of the phone's Expo push
 * token with its computers (`PushTokenRegistration`); faked are the boundaries only: iOS's permission and token,
 * the build's push project, the switches as Settings stores them, and the warm link to each computer (a fake
 * transport that records every request it carries).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { PermissionState } from './firstAsk';
import { PushTokenRegistration, REMOVAL_WAIT_MS, type PushTokenParams, type PushTokenSendOutcome } from './pushToken';
import type { NotificationSettings } from './settings';

const TOKEN = 'ExponentPushToken[abcdefgh12345678]';
const NEW_TOKEN = 'ExponentPushToken[zyxwvuts87654321]';

const ON: NotificationSettings = {
  enabled: true,
  finished: true,
  waiting: true,
  error: true,
  askedAt: '2031-05-04T10:00:00.000Z',
};

const KINDS_ON = { finished: true, waiting: true, error: true };

/** A registration as the route takes it: the token, the phone's own id for the computer and its three switches. */
const register = (machineId: string, token = TOKEN, kinds = KINDS_ON): PushTokenParams => ({
  action: 'register',
  token,
  machineId,
  kinds,
});
/** A removal as the route takes it: it names the computer by the phone's own id for it. */
const unregister = (machineId: string): PushTokenParams => ({ action: 'unregister', machineId });

/**
 * A registration as the route's request schema takes it (`registerPushToken`, `params`): the named fields only,
 * each in its pattern, and a `deviceId`, when there is one, of 1 to 128 visible ASCII characters.
 */
function assertRouteTakes(params: PushTokenParams): void {
  if (params.action !== 'register') assert.fail(`not a registration: ${params.action}`);
  const { action, token, machineId, kinds, deviceId, ...extra } = params;
  assert.equal(action, 'register');
  assert.deepEqual(extra, {});
  assert.match(token, /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,64}\]$/u);
  assert.match(machineId, /^[\x21-\x7e]{1,64}$/u);
  assert.deepEqual(Object.keys(kinds).sort(), ['error', 'finished', 'waiting']);
  if (deviceId !== undefined) assert.match(deviceId, /^[\x21-\x7e]{1,128}$/u);
}

type Sent = { machineId: string; params: PushTokenParams };

type HarnessOptions = {
  permission?: PermissionState;
  settings?: NotificationSettings;
  projectId?: string | null;
  machines?: string[];
  /** The pairing device id of a computer paired by QR code; none for the others (added by SSH). */
  deviceIds?: Record<string, string>;
  /** How each computer answers; 'done' when not named. */
  answers?: Record<string, PushTokenSendOutcome | Error>;
  token?: () => Promise<string>;
};

function harness(options: HarnessOptions = {}) {
  const state = {
    permission: options.permission ?? ('granted' as PermissionState),
    settings: options.settings ?? ON,
    projectId: options.projectId === undefined ? 'project-1' : options.projectId,
    machines: options.machines ?? ['m1', 'm2'],
    deviceIds: options.deviceIds ?? ({} as Record<string, string>),
    answers: options.answers ?? {},
    token: options.token ?? (async () => TOKEN),
    /** What a computer waits for after it got a request and before it answers. */
    answering: (_machineId: string): Promise<void> => Promise.resolve(),
    /** What the link waits for before a request to that computer goes out (its route looked up). */
    preparing: (_machineId: string): Promise<void> => Promise.resolve(),
    /** What each computer's link knows it offers (`pushNotifications`); unknown when not named. */
    offersPush: {} as Record<string, boolean>,
  };
  /** Each confirmation a computer gave, as `computer:holds` (true: it took the token; false: it holds none). */
  const accepted: string[] = [];
  const sent: Sent[] = [];
  const logs: string[] = [];
  const tokenRequests: string[] = [];
  /** Each timer the registration started, by its length; it expires only when the test lets it. */
  const timers: { ms: number; expire(): void; cancelled: boolean }[] = [];
  const registration = new PushTokenRegistration({
    permission: async () => state.permission,
    settings: () => state.settings,
    projectId: () => state.projectId,
    obtainToken: async (projectId) => {
      tokenRequests.push(projectId);
      return state.token();
    },
    machines: () =>
      state.machines.map((id) => {
        const deviceId = state.deviceIds[id];
        return { id, label: `Mac ${id}`, ...(deviceId === undefined ? {} : { deviceId }) };
      }),
    offersPush: (machineId) => state.offersPush[machineId] ?? null,
    send: async (machineId, params, current) => {
      await state.preparing(machineId);
      // As `sendPushToken` does once the route is known: nothing goes out when the pass no longer wants it.
      if (!current()) return 'superseded';
      sent.push({ machineId, params: { ...params } });
      await state.answering(machineId);
      const answer = state.answers[machineId] ?? 'done';
      if (answer instanceof Error) throw answer;
      return answer;
    },
    accepted: (machineId, holds) => void accepted.push(`${machineId}:${holds}`),
    log: (line) => void logs.push(line),
    startTimer: (ms) => {
      const expired = Promise.withResolvers<void>();
      const timer = { ms, expire: () => expired.resolve(), cancelled: false };
      timers.push(timer);
      return {
        expired: expired.promise,
        cancel: () => {
          timer.cancelled = true;
        },
      };
    },
  });
  return { registration, state, sent, logs, tokenRequests, accepted, timers };
}

describe('the push token goes to the computers over the warm link', () => {
  test('with permission, the master switch on and a push project, each enabled computer gets the token', async () => {
    const app = harness();
    await app.registration.sync();
    assert.deepEqual(app.tokenRequests, ['project-1']);
    assert.deepEqual(app.sent, [
      { machineId: 'm1', params: register('m1') },
      { machineId: 'm2', params: register('m2') },
    ]);
  });

  test("each registration carries the phone's own id for that computer, also after a new token", async () => {
    let token = TOKEN;
    const app = harness({ machines: ['m1', 'm2'], token: async () => token });
    await app.registration.sync();
    token = NEW_TOKEN;
    await app.registration.tokenChanged();
    // The token stays out of this comparison, so a failure prints none.
    assert.deepEqual(
      app.sent.map((entry) => [
        entry.machineId,
        entry.params.action,
        'machineId' in entry.params ? entry.params.machineId : null,
      ]),
      [
        ['m1', 'register', 'm1'],
        ['m2', 'register', 'm2'],
        ['m1', 'register', 'm1'],
        ['m2', 'register', 'm2'],
      ],
    );
  });

  test('a computer that already has the token is not asked again', async () => {
    const app = harness();
    await app.registration.sync();
    await app.registration.sync();
    assert.equal(app.sent.length, 2);
  });

  test('a computer that becomes enabled gets the token', async () => {
    const app = harness({ machines: ['m1'] });
    await app.registration.sync();
    app.state.machines = ['m1', 'm2'];
    await app.registration.sync();
    assert.deepEqual(
      app.sent.map((entry) => entry.machineId),
      ['m1', 'm2'],
    );
  });

  test('a computer hidden and shown again gets the token again', async () => {
    const app = harness({ machines: ['m1'] });
    await app.registration.sync();
    app.state.machines = [];
    await app.registration.sync();
    app.state.machines = ['m1'];
    await app.registration.sync();
    assert.deepEqual(app.sent, [
      { machineId: 'm1', params: register('m1') },
      { machineId: 'm1', params: register('m1') },
    ]);
  });

  test('a new token from iOS replaces the old one on every computer', async () => {
    let token = TOKEN;
    const app = harness({ token: async () => token });
    await app.registration.sync();
    token = NEW_TOKEN;
    await app.registration.tokenChanged();
    assert.deepEqual(
      app.sent.slice(2).map((entry) => entry.params),
      [register('m1', NEW_TOKEN), register('m2', NEW_TOKEN)],
    );
  });

  test('a computer that could not be reached is asked again at the next occasion', async () => {
    const app = harness({ answers: { m2: 'unreachable' } });
    await app.registration.sync();
    app.state.answers = {};
    await app.registration.sync();
    assert.deepEqual(
      app.sent.map((entry) => entry.machineId),
      ['m1', 'm2', 'm2'],
    );
  });

  test('the token is fetched once per launch, not at every occasion', async () => {
    const app = harness();
    await app.registration.sync();
    await app.registration.sync();
    assert.equal(app.tokenRequests.length, 1);
  });

  test('occasions that come while a pass runs are served by one more pass, in order', async () => {
    const app = harness({ machines: ['m1'] });
    const first = app.registration.sync();
    app.state.machines = ['m1', 'm2'];
    const second = app.registration.sync();
    const third = app.registration.sync();
    await Promise.all([first, second, third]);
    assert.deepEqual(
      app.sent.map((entry) => entry.machineId),
      ['m1', 'm2'],
    );
  });
});

describe('no token without permission, master switch and push project', () => {
  test('without iOS permission no token is fetched and nothing is sent', async () => {
    for (const permission of ['denied', 'undetermined'] as const) {
      const app = harness({ permission });
      await app.registration.sync();
      assert.deepEqual(app.tokenRequests, [], permission);
      assert.deepEqual(app.sent, [], permission);
    }
  });

  test('with the master switch off no token is fetched', async () => {
    const app = harness({ settings: { ...ON, enabled: false } });
    await app.registration.sync();
    assert.deepEqual(app.tokenRequests, []);
    assert.ok(app.sent.every((entry) => entry.params.action === 'unregister'));
  });

  test('before the first ask was answered no token is fetched and nothing is sent', async () => {
    const app = harness({ settings: { enabled: false, finished: false, waiting: false, error: false } });
    await app.registration.sync();
    assert.deepEqual(app.tokenRequests, []);
    assert.deepEqual(app.sent, []);
  });

  test('a build without a push project fetches no token, sends nothing and says so once', async () => {
    const app = harness({ projectId: null });
    await app.registration.sync();
    await app.registration.sync();
    assert.deepEqual(app.tokenRequests, []);
    assert.deepEqual(app.sent, []);
    assert.deepEqual(app.logs, ['Push: this build has no push project; push notifications stay off']);
  });

  test('a failed token request sends nothing, does not throw and logs a fixed line', async () => {
    const app = harness({ token: async () => Promise.reject(new Error(`network down for ${TOKEN}`)) });
    await app.registration.sync();
    assert.deepEqual(app.sent, []);
    assert.deepEqual(app.logs, ['Push: no push token this time (Error); asked again at the next occasion']);
  });

  test('a token that is not an Expo push token is not sent', async () => {
    const app = harness({ token: async () => 'not-a-token' });
    await app.registration.sync();
    assert.deepEqual(app.sent, []);
    assert.deepEqual(app.logs, [
      'Push: no push token this time (notAnExpoPushToken); asked again at the next occasion',
    ]);
  });
});

describe('the master switch', () => {
  test('turned off, each enabled computer is asked to remove the token; turned on, it gets it again', async () => {
    const app = harness();
    await app.registration.sync();
    app.state.settings = { ...ON, enabled: false };
    await app.registration.sync();
    assert.deepEqual(app.sent.slice(2), [
      { machineId: 'm1', params: unregister('m1') },
      { machineId: 'm2', params: unregister('m2') },
    ]);
    app.state.settings = ON;
    await app.registration.sync();
    assert.deepEqual(app.sent.slice(4), [
      { machineId: 'm1', params: register('m1') },
      { machineId: 'm2', params: register('m2') },
    ]);
  });

  test('off at launch, each enabled computer is asked once to remove what an earlier launch registered', async () => {
    const app = harness({ settings: { ...ON, enabled: false } });
    await app.registration.sync();
    await app.registration.sync();
    assert.deepEqual(app.sent, [
      { machineId: 'm1', params: unregister('m1') },
      { machineId: 'm2', params: unregister('m2') },
    ]);
  });

  test('a removal that did not reach a computer is sent again at the next occasion', async () => {
    const app = harness();
    await app.registration.sync();
    app.state.settings = { ...ON, enabled: false };
    app.state.answers = { m1: 'unreachable' };
    await app.registration.sync();
    app.state.answers = {};
    await app.registration.sync();
    assert.deepEqual(
      app.sent.slice(2).map((entry) => `${entry.machineId}:${entry.params.action}`),
      ['m1:unregister', 'm2:unregister', 'm1:unregister'],
    );
  });
});

describe('what a registration carries', () => {
  test('the three switches, and the pairing device id only for a computer paired by QR code', async () => {
    const app = harness({ settings: { ...ON, waiting: false }, deviceIds: { m1: 'device-7' } });
    await app.registration.sync();
    const kinds = { finished: true, waiting: false, error: true };
    assert.deepEqual(app.sent, [
      { machineId: 'm1', params: { ...register('m1', TOKEN, kinds), deviceId: 'device-7' } },
      { machineId: 'm2', params: register('m2', TOKEN, kinds) },
    ]);
  });

  test('an empty pairing device id counts as none', async () => {
    const app = harness({ machines: ['m1'], deviceIds: { m1: '' } });
    await app.registration.sync();
    assert.deepEqual(app.sent, [{ machineId: 'm1', params: register('m1') }]);
  });

  test('a pairing device id the route does not take is left out of the registration, logged without the id', async () => {
    const spaces = 'pairing id with spaces';
    const tooLong = 'd'.repeat(129);
    const app = harness({ machines: ['m1', 'm2', 'm3'], deviceIds: { m1: spaces, m2: tooLong, m3: '' } });
    await app.registration.sync();
    await app.registration.sync();
    // The computer still takes the token and the switches: the registration goes once, only without the id.
    assert.deepEqual(app.sent, [
      { machineId: 'm1', params: register('m1') },
      { machineId: 'm2', params: register('m2') },
      { machineId: 'm3', params: register('m3') },
    ]);
    for (const { params } of app.sent) assertRouteTakes(params);
    const leftOut = app.logs.filter((line) => line.includes('pairing id'));
    assert.deepEqual(leftOut, [
      'Mac m1: pairing id left out of the push token registration (not one the computer takes)',
      'Mac m2: pairing id left out of the push token registration (not one the computer takes)',
    ]);
    for (const line of app.logs) assert.ok(!line.includes(spaces) && !line.includes(tooLong), line);
  });

  test('a pairing device id the route takes goes unchanged, also at its longest and with any visible character', async () => {
    const longest = 'd'.repeat(128);
    const visible = '!device~7';
    const app = harness({ deviceIds: { m1: longest, m2: visible } });
    await app.registration.sync();
    assert.deepEqual(app.sent, [
      { machineId: 'm1', params: { ...register('m1'), deviceId: longest } },
      { machineId: 'm2', params: { ...register('m2'), deviceId: visible } },
    ]);
    for (const { params } of app.sent) assertRouteTakes(params);
    assert.ok(!app.logs.some((line) => line.includes('pairing id')));
  });

  test('a new pairing device id of an enabled computer goes to it once, with a new registration', async () => {
    const app = harness({ machines: ['m1'], deviceIds: { m1: 'device-1' } });
    await app.registration.sync();
    app.state.deviceIds = { m1: 'device-2' };
    await app.registration.sync();
    await app.registration.sync();
    assert.deepEqual(app.sent.slice(1), [{ machineId: 'm1', params: { ...register('m1'), deviceId: 'device-2' } }]);
  });
});

describe('the finished, waiting and error switches reach the computers', () => {
  test('a change goes to each enabled computer once, as a new registration with the switches as they are now', async () => {
    const app = harness({ deviceIds: { m2: 'device-9' } });
    await app.registration.sync();
    app.state.settings = { ...ON, error: false };
    await app.registration.sync();
    await app.registration.sync();
    const kinds = { finished: true, waiting: true, error: false };
    assert.deepEqual(app.sent.slice(2), [
      { machineId: 'm1', params: register('m1', TOKEN, kinds) },
      { machineId: 'm2', params: { ...register('m2', TOKEN, kinds), deviceId: 'device-9' } },
    ]);
    assert.deepEqual(app.accepted, ['m1:true', 'm2:true', 'm1:true', 'm2:true']);
    for (const line of app.logs) assert.ok(!line.includes('abcdefgh12345678'), line);
  });

  test('a change sends nothing while no computer should hold the token', async () => {
    const cases: [string, HarnessOptions][] = [
      ['master switch off', { settings: { ...ON, enabled: false } }],
      ['no iOS permission', { permission: 'denied' }],
      ['no push project', { projectId: null }],
      ['first ask not answered', { settings: { enabled: false, finished: false, waiting: false, error: false } }],
    ];
    for (const [name, options] of cases) {
      const app = harness(options);
      await app.registration.sync();
      const before = app.sent.length;
      app.state.settings = { ...app.state.settings, finished: !app.state.settings.finished };
      await app.registration.sync();
      assert.deepEqual(app.sent.slice(before), [], name);
    }
  });

  test('a computer without the push route and one being removed are not asked on a change', async () => {
    const app = harness({ machines: ['m1', 'm2', 'm3'], answers: { m2: 'unsupported' } });
    await app.registration.sync();
    await app.registration.removing({ id: 'm3', label: 'Mac m3' });
    const before = app.sent.length;
    app.state.settings = { ...ON, finished: false };
    await app.registration.sync();
    assert.deepEqual(app.sent.slice(before), [
      { machineId: 'm1', params: register('m1', TOKEN, { finished: false, waiting: true, error: true }) },
    ]);
  });

  test('a change that does not reach a computer is not sent again on its own; its next registration carries it', async () => {
    const app = harness();
    await app.registration.sync();
    app.state.answers = { m2: 'unreachable' };
    app.state.settings = { ...ON, error: false };
    await app.registration.sync();
    const errorSwitch = () =>
      app.sent.slice(2).map((entry) => {
        const { params } = entry;
        return `${entry.machineId}:${params.action === 'register' ? params.kinds.error : '-'}`;
      });
    assert.deepEqual(errorSwitch(), ['m1:false', 'm2:false']);
    // The next occasion (the app comes back to the front, say) reaches it.
    app.state.answers = {};
    await app.registration.sync();
    await app.registration.sync();
    assert.deepEqual(errorSwitch(), ['m1:false', 'm2:false', 'm2:false']);
    assert.ok(
      app.logs.includes('Mac m2: push token registration not taken (unreachable); asked again at the next occasion'),
    );
  });

  test('a change while a registration is on its way: each computer ends with the switches as they are now', async () => {
    const requested = Promise.withResolvers<void>();
    const answer = Promise.withResolvers<void>();
    const app = harness();
    app.state.answering = (machineId) => {
      if (machineId !== 'm1') return Promise.resolve();
      requested.resolve();
      return answer.promise;
    };
    const started = app.registration.sync();
    await requested.promise;
    app.state.answering = () => Promise.resolve();
    app.state.settings = { ...ON, waiting: false };
    const changed = app.registration.sync();
    answer.resolve();
    await Promise.all([started, changed]);
    const kinds = { finished: true, waiting: false, error: true };
    assert.deepEqual(app.sent, [
      { machineId: 'm1', params: register('m1') },
      { machineId: 'm2', params: register('m2', TOKEN, kinds) },
      { machineId: 'm1', params: register('m1', TOKEN, kinds) },
    ]);
  });
});

describe('a computer whose Ghostex does not know the route', () => {
  test('counts as without push: not asked again at later occasions, also not by the master switch', async () => {
    const app = harness({ answers: { m2: 'unsupported' } });
    await app.registration.sync();
    await app.registration.sync();
    app.state.settings = { ...ON, enabled: false };
    await app.registration.sync();
    app.state.settings = ON;
    await app.registration.sync();
    assert.deepEqual(
      app.sent.filter((entry) => entry.machineId === 'm2'),
      [{ machineId: 'm2', params: register('m2') }],
    );
    assert.ok(app.logs.includes('Mac m2: this computer has no push yet; not asked again until the app starts again'));
  });

  test('is asked again when the token changes', async () => {
    let token = TOKEN;
    const app = harness({ answers: { m2: 'unsupported' }, token: async () => token });
    await app.registration.sync();
    token = NEW_TOKEN;
    app.state.answers = {};
    await app.registration.tokenChanged();
    assert.deepEqual(
      app.sent.filter((entry) => entry.machineId === 'm2').map((entry) => entry.params),
      [register('m2'), register('m2', NEW_TOKEN)],
    );
  });

  test('one the phone reaches only on the exec route is not asked again either, until the token changes', async () => {
    let token = TOKEN;
    const app = harness({ answers: { m2: 'legacy' }, token: async () => token });
    await app.registration.sync();
    await app.registration.sync();
    token = NEW_TOKEN;
    app.state.answers = {};
    await app.registration.tokenChanged();
    assert.deepEqual(
      app.sent.filter((entry) => entry.machineId === 'm2').map((entry) => entry.params),
      [register('m2'), register('m2', NEW_TOKEN)],
    );
  });
});

// `sendPushToken` answers `noPush` for a registration to a computer whose `ghostex server endpoint` does not list
// `pushNotifications`, without sending it; the fake link here stands for that answer. `offersPush` is what a
// computer's link already knows before any request (a computer that took the token is not sent it again).
describe('a computer that does not offer push', () => {
  test('holds none and is looked at again at each occasion; the master switch off still asks it to remove the token', async () => {
    const app = harness({ answers: { m2: 'noPush' } });
    await app.registration.sync();
    await app.registration.sync();
    assert.deepEqual(app.accepted, ['m1:true', 'm2:false', 'm2:false']);
    assert.ok(app.logs.includes('Mac m2: this computer does not offer push; no push token registered'));
    // An earlier registration may still be there.
    app.state.answers = {};
    app.state.settings = { ...ON, enabled: false };
    await app.registration.sync();
    assert.deepEqual(
      app.sent.filter((entry) => entry.machineId === 'm2').map((entry) => entry.params),
      [register('m2'), register('m2'), unregister('m2')],
    );
  });

  test('is registered at the next occasion once it offers push', async () => {
    const app = harness({ answers: { m2: 'noPush' } });
    await app.registration.sync();
    app.state.answers = {};
    await app.registration.sync();
    assert.deepEqual(
      app.accepted.filter((entry) => entry.startsWith('m2:')),
      ['m2:false', 'm2:true'],
    );
  });

  test('one that took the token and is then known not to offer push holds none at the next occasion, asked nothing', async () => {
    const app = harness();
    await app.registration.sync();
    app.state.offersPush = { m2: false };
    await app.registration.sync();
    assert.deepEqual(app.accepted, ['m1:true', 'm2:true', 'm2:false']);
    // Offering push again, it is registered anew and confirms it.
    app.state.offersPush = { m2: true };
    await app.registration.sync();
    assert.deepEqual(app.accepted, ['m1:true', 'm2:true', 'm2:false', 'm2:true']);
    assert.deepEqual(
      app.sent.filter((entry) => entry.machineId === 'm2').map((entry) => entry.params),
      [register('m2'), register('m2')],
    );
  });

  test('what its link does not know yet is no absence: a computer that took the token keeps it as it was', async () => {
    const app = harness();
    await app.registration.sync();
    await app.registration.sync();
    assert.deepEqual(app.accepted, ['m1:true', 'm2:true']);
    assert.equal(app.sent.length, 2);
  });

  // A computer the phone reached only on the exec route is not asked again until the app starts again or the token
  // changes; what its link learns later without a request still counts.
  test('one that took the token, then was reached only on the exec route, holds none once its link knows no push', async () => {
    let token = TOKEN;
    const app = harness({ token: async () => token });
    await app.registration.sync();
    token = NEW_TOKEN;
    app.state.answers = { m2: 'legacy' };
    await app.registration.tokenChanged();
    assert.deepEqual(app.accepted, ['m1:true', 'm2:true', 'm1:true']);
    // Unknown on the exec route: nothing changes, and the exec route is not asked again.
    await app.registration.sync();
    assert.deepEqual(app.accepted, ['m1:true', 'm2:true', 'm1:true']);
    app.state.offersPush = { m2: false };
    await app.registration.sync();
    assert.deepEqual(app.accepted, ['m1:true', 'm2:true', 'm1:true', 'm2:false']);
    assert.deepEqual(
      app.sent.filter((entry) => entry.machineId === 'm2').map((entry) => entry.params),
      [register('m2'), register('m2', NEW_TOKEN)],
    );
  });
});

describe('the token stays out of the logs', () => {
  test('no log line carries the token, whatever the computers answer or throw', async () => {
    const app = harness({
      machines: ['m1', 'm2', 'm3', 'm4', 'm5'],
      answers: {
        m1: 'done',
        m2: 'unsupported',
        m3: 'unreachable',
        m4: 'refused',
        m5: new Error(`refused ${TOKEN}`),
      },
    });
    await app.registration.sync();
    app.state.settings = { ...ON, enabled: false };
    await app.registration.sync();
    assert.ok(app.logs.length > 0);
    for (const line of app.logs) {
      assert.ok(!line.includes(TOKEN), line);
      assert.ok(!line.includes('abcdefgh12345678'), line);
    }
  });
});

describe('a fetch or a registration that the person or iOS overtook', () => {
  test('a new token while the old one is still being fetched: the old one is never sent, the new one is', async () => {
    const first = Promise.withResolvers<string>();
    const fetching = Promise.withResolvers<void>();
    let fetches = 0;
    const app = harness({
      machines: ['m1'],
      token: () => {
        fetches += 1;
        if (fetches > 1) return Promise.resolve(NEW_TOKEN);
        fetching.resolve();
        return first.promise;
      },
    });
    const old = app.registration.sync();
    await fetching.promise;
    const changed = app.registration.tokenChanged();
    first.resolve(TOKEN);
    await Promise.all([old, changed]);
    assert.deepEqual(app.sent, [{ machineId: 'm1', params: register('m1', NEW_TOKEN) }]);
    assert.equal(fetches, 2);
  });

  test('the master switch turned off while the token is fetched: only the removal goes out', async () => {
    const token = Promise.withResolvers<string>();
    const fetching = Promise.withResolvers<void>();
    const app = harness({
      machines: ['m1'],
      token: () => {
        fetching.resolve();
        return token.promise;
      },
    });
    const started = app.registration.sync();
    await fetching.promise;
    // Settings changed: the app asks for a pass, as its subscription to the switches does.
    app.state.settings = { ...ON, enabled: false };
    const off = app.registration.sync();
    token.resolve(TOKEN);
    await Promise.all([started, off]);
    assert.deepEqual(app.sent, [{ machineId: 'm1', params: unregister('m1') }]);
  });

  test('the master switch turned off while a registration is on its way: no later computer gets one, each the removal', async () => {
    const requested = Promise.withResolvers<void>();
    const answer = Promise.withResolvers<void>();
    const app = harness();
    app.state.answering = (machineId) => {
      if (machineId !== 'm1') return Promise.resolve();
      requested.resolve();
      return answer.promise;
    };
    const started = app.registration.sync();
    await requested.promise;
    app.state.settings = { ...ON, enabled: false };
    const off = app.registration.sync();
    answer.resolve();
    await Promise.all([started, off]);
    assert.deepEqual(
      app.sent.map((entry) => `${entry.machineId}:${entry.params.action}`),
      ['m1:register', 'm1:unregister', 'm2:unregister'],
    );
  });

  test('a new token while a registration is on its way: the computers after it get only the new one', async () => {
    let token = TOKEN;
    const requested = Promise.withResolvers<void>();
    const answer = Promise.withResolvers<void>();
    const app = harness({ token: async () => token });
    app.state.answering = (machineId) => {
      if (machineId !== 'm1') return Promise.resolve();
      requested.resolve();
      return answer.promise;
    };
    const started = app.registration.sync();
    await requested.promise;
    token = NEW_TOKEN;
    const changed = app.registration.tokenChanged();
    answer.resolve();
    await Promise.all([started, changed]);
    assert.deepEqual(
      app.sent.map((entry) => [entry.machineId, entry.params.action === 'register' ? entry.params.token : '']),
      [
        ['m1', TOKEN],
        ['m1', NEW_TOKEN],
        ['m2', NEW_TOKEN],
      ],
    );
  });

  for (const change of ['the master switch is turned off', 'iOS issues a new token'] as const) {
    test(`when ${change} while a registration is prepared, it is not sent; only what is wanted now goes out`, async () => {
      let token = TOKEN;
      const preparing = Promise.withResolvers<void>();
      const prepared = Promise.withResolvers<void>();
      const app = harness({ machines: ['m1'], token: async () => token });
      app.state.preparing = () => {
        preparing.resolve();
        return prepared.promise;
      };
      const started = app.registration.sync();
      await preparing.promise;
      app.state.preparing = () => Promise.resolve();
      const off = change === 'the master switch is turned off';
      let next: Promise<void>;
      if (off) {
        app.state.settings = { ...ON, enabled: false };
        next = app.registration.sync();
      } else {
        token = NEW_TOKEN;
        next = app.registration.tokenChanged();
      }
      prepared.resolve();
      await Promise.all([started, next]);
      assert.deepEqual(app.sent, [
        off ? { machineId: 'm1', params: unregister('m1') } : { machineId: 'm1', params: register('m1', NEW_TOKEN) },
      ]);
      assert.deepEqual(app.accepted, [off ? 'm1:false' : 'm1:true']);
    });
  }
});

describe('which computers hold the token', () => {
  test('one that took it holds it; one that removed it or has no route for it holds none', async () => {
    const app = harness({ machines: ['m1', 'm2', 'm3'], answers: { m2: 'refused', m3: 'unsupported' } });
    await app.registration.sync();
    assert.deepEqual(app.accepted, ['m1:true', 'm3:false']);
    app.state.settings = { ...ON, enabled: false };
    app.state.answers = {};
    await app.registration.sync();
    assert.deepEqual(app.accepted.slice(2), ['m1:false', 'm2:false']);
  });

  test('a registration it refused, or whose answer could not be read, leaves what it held before as it was', async () => {
    let token = TOKEN;
    const app = harness({ machines: ['m1'], token: async () => token });
    await app.registration.sync();
    token = NEW_TOKEN;
    app.state.answers = { m1: 'refused' };
    await app.registration.tokenChanged();
    app.state.answers = { m1: new Error('unreadable') };
    await app.registration.sync();
    assert.equal(app.sent.length, 3);
    assert.deepEqual(app.accepted, ['m1:true']);
  });

  test('one out of reach or on the exec route is not judged: what it took before stays as it was', async () => {
    const app = harness({ machines: ['m1', 'm2'], answers: { m1: 'unreachable', m2: 'legacy' } });
    await app.registration.sync();
    app.state.settings = { ...ON, enabled: false };
    await app.registration.sync();
    assert.deepEqual(app.accepted, []);
  });

  test('a removal it refused leaves it holding the token', async () => {
    const app = harness({ machines: ['m1'] });
    await app.registration.sync();
    app.state.settings = { ...ON, enabled: false };
    app.state.answers = { m1: 'refused' };
    await app.registration.sync();
    assert.deepEqual(app.accepted, ['m1:true']);
  });

  test('a computer that is hidden or removed is not reported as holding none', async () => {
    const app = harness();
    await app.registration.sync();
    app.state.machines = ['m1'];
    await app.registration.sync();
    assert.deepEqual(app.accepted, ['m1:true', 'm2:true']);
  });
});

describe('removing a computer', () => {
  /** The person removes computer `id`; its saved record is still there while the removal is asked. */
  const removing = (registration: PushTokenRegistration, id: string) =>
    registration.removing({ id, label: `Mac ${id}` });
  const unregistersTo = (sent: readonly Sent[], id: string) =>
    sent.filter((entry) => entry.machineId === id && entry.params.action === 'unregister').length;
  /** Lets what the last step started run on. */
  const tick = () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    setImmediate(resolve);
    return promise;
  };

  test('a computer that can be reached is asked once to remove the token, and confirms it holds none', async () => {
    const app = harness();
    await app.registration.sync();
    await removing(app.registration, 'm1');
    assert.deepEqual(app.sent.slice(2), [{ machineId: 'm1', params: unregister('m1') }]);
    assert.deepEqual(app.accepted.slice(2), ['m1:false']);
    assert.equal(app.timers[0]?.ms, REMOVAL_WAIT_MS);
    assert.equal(app.timers[0]?.cancelled, true);
    // Gone from the phone: later occasions send it nothing more.
    app.state.machines = ['m2'];
    await app.registration.sync();
    await app.registration.tokenChanged();
    assert.equal(unregistersTo(app.sent, 'm1'), 1);
    assert.equal(app.sent.filter((entry) => entry.machineId === 'm1').length, 2);
  });

  test('it is asked also with the master switch off, without iOS permission, without push project or token', async () => {
    const cases: HarnessOptions[] = [
      { settings: { ...ON, enabled: false } },
      { permission: 'denied' },
      { projectId: null },
      { token: async () => Promise.reject(new Error('no token')) },
    ];
    for (const options of cases) {
      const app = harness(options);
      await app.registration.sync();
      const before = app.sent.length;
      await removing(app.registration, 'm1');
      assert.deepEqual(
        app.sent.slice(before),
        [{ machineId: 'm1', params: unregister('m1') }],
        JSON.stringify(options),
      );
    }
  });

  test('before the first ask was answered nothing is sent and nothing waits', async () => {
    const app = harness({ settings: { enabled: false, finished: false, waiting: false, error: false } });
    await app.registration.sync();
    await removing(app.registration, 'm1');
    assert.deepEqual(app.sent, []);
    assert.deepEqual(app.timers, []);
  });

  test('a hidden computer is asked as well', async () => {
    const app = harness({ machines: ['m2'] });
    await removing(app.registration, 'm1');
    assert.deepEqual(
      app.sent.filter((entry) => entry.machineId === 'm1'),
      [{ machineId: 'm1', params: unregister('m1') }],
    );
  });

  test('a computer whose Ghostex has no push route confirms it holds none', async () => {
    const app = harness({ machines: ['m1'] });
    await app.registration.sync();
    app.state.answers = { m1: 'unsupported' };
    await removing(app.registration, 'm1');
    assert.deepEqual(app.accepted, ['m1:true', 'm1:false']);
    assert.ok(app.logs.includes('Mac m1: push token removal not needed (no push)'));
  });

  test('a computer that cannot be reached is removed anyway, asked once, never again', async () => {
    for (const outcome of ['unreachable', 'refused', 'legacy'] as const) {
      const app = harness({ answers: { m1: outcome } });
      await app.registration.sync();
      await removing(app.registration, 'm1');
      app.state.machines = ['m2'];
      await app.registration.sync();
      app.state.settings = { ...ON, enabled: false };
      await app.registration.sync();
      assert.equal(unregistersTo(app.sent, 'm1'), 1, outcome);
      assert.ok(
        app.logs.includes(`Mac m1: push token removal not taken (${outcome}); the computer may keep it`),
        outcome,
      );
    }
  });

  test('a computer that does not answer holds the removal at most for the wait, and nothing goes out after it', async () => {
    const app = harness();
    await app.registration.sync();
    const prepared = Promise.withResolvers<void>();
    app.state.preparing = (machineId) => (machineId === 'm1' ? prepared.promise : Promise.resolve());
    let done = false;
    const removal = removing(app.registration, 'm1').then(() => {
      done = true;
    });
    await tick();
    assert.equal(done, false);
    assert.equal(app.timers[0]?.ms, REMOVAL_WAIT_MS);
    app.timers[0]?.expire();
    await removal;
    assert.ok(
      app.logs.includes(
        `Mac m1: no answer to the push token removal within ${REMOVAL_WAIT_MS / 1000} s; the computer may keep it`,
      ),
    );
    // The route lookup answers after the wait: the removal is no longer sent, and no later occasion sends it.
    prepared.resolve();
    await tick();
    app.state.machines = ['m2'];
    await app.registration.sync();
    assert.equal(unregistersTo(app.sent, 'm1'), 0);
  });

  test('a registration prepared for the computer when its removal starts is not sent, and no later pass registers it', async () => {
    const preparing = Promise.withResolvers<void>();
    const prepared = Promise.withResolvers<void>();
    const app = harness();
    app.state.preparing = (machineId) => {
      if (machineId !== 'm1') return Promise.resolve();
      app.state.preparing = () => Promise.resolve();
      preparing.resolve();
      return prepared.promise;
    };
    const pass = app.registration.sync();
    await preparing.promise;
    const removal = removing(app.registration, 'm1');
    await removal;
    prepared.resolve();
    await pass;
    await app.registration.sync();
    assert.deepEqual(
      app.sent.map((entry) => `${entry.machineId}:${entry.params.action}`),
      ['m1:unregister', 'm2:register'],
    );
    assert.deepEqual(app.accepted, ['m1:false', 'm2:true']);
  });

  test('no log line of a removal carries the token', async () => {
    const app = harness({
      machines: ['m1', 'm2', 'm3'],
      answers: { m2: 'unreachable', m3: new Error(`refused ${TOKEN}`) },
    });
    await app.registration.sync();
    for (const id of ['m1', 'm2', 'm3']) await removing(app.registration, id);
    assert.ok(app.logs.length > 0);
    for (const line of app.logs) {
      assert.ok(!line.includes(TOKEN), line);
      assert.ok(!line.includes('abcdefgh12345678'), line);
    }
  });
});
