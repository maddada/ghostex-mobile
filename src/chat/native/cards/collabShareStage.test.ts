/// <reference types="node" />
/** Run with `bun test src/chat/native/cards/collabShareStage.test.ts` from apps/mobile/app. */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { LIFETIMES, endsIn, liveSubtitle, names, stageOf, type Share_, type View_ } from './collabShareStage';

const none = { confirmStop: false, justStopped: false, waiting: null } as const;

const share = (patch: Partial<Share_> = {}): Share_ => ({
  shareId: 's1',
  projectId: 'p',
  sessionId: 'c',
  mode: 'approve',
  expiresAtMs: null,
  viewers: [],
  ...patch,
});

const running = (shares: Share_[] = []): View_ => ({
  installed: true,
  running: true,
  config: { mode: 'approve', expiry: 'hour' },
  relayConnected: true,
  shares,
});

describe('the Share sheet', () => {
  test('before Collab is installed it offers Install, its approval, then the download', () => {
    assert.deepEqual(stageOf({ installed: false, component: {} }, 'p', 'c', none), {
      kind: 'notInstalled',
      canInstall: true,
    });
    assert.deepEqual(stageOf({ installed: false, component: { canInstall: false } }, 'p', 'c', none), {
      kind: 'notInstalled',
      canInstall: false,
    });
    assert.equal(stageOf({ installed: false }, 'p', 'c', { ...none, waiting: 'install' }).kind, 'installWaiting');
    assert.deepEqual(
      stageOf({ installed: false, component: { phase: 'downloading', doneBytes: 21, totalBytes: 50 } }, 'p', 'c', none),
      { kind: 'installing', fraction: 0.42 },
    );
    assert.deepEqual(stageOf({ installed: false, component: { phase: 'installing' } }, 'p', 'c', none), {
      kind: 'installing',
      fraction: null,
    });
  });

  test('installed but not running says it is starting', () => {
    assert.deepEqual(
      stageOf({ installed: true, running: false, component: { statusError: 'crashed' } }, 'p', 'c', none),
      { kind: 'notRunning', reason: 'crashed' },
    );
  });

  test('only this chat’s share makes it live, and Stop asks first', () => {
    assert.equal(stageOf(running([share({ sessionId: 'other' })]), 'p', 'c', none).kind, 'ready');
    assert.equal(stageOf(running(), 'p', 'c', { ...none, waiting: 'create' }).kind, 'creating');
    assert.equal(stageOf(running(), 'p', 'c', { ...none, justStopped: true }).kind, 'ended');
    assert.equal(stageOf(running([share()]), 'p', 'c', none).kind, 'live');
    assert.equal(stageOf(running([share()]), 'p', 'c', { ...none, confirmStop: true }).kind, 'confirmStop');
  });

  test('a link with no end says it stays live until you stop it', () => {
    const viewers = [{ id: 'a', name: 'Alper' }];
    assert.equal(liveSubtitle(share({ viewers }), true), '1 watching · stays live until you stop it');
    assert.equal(endsIn(null), 'Live until you stop it');
    assert.equal(endsIn(10 * 60_000 + 30_000, 0), 'Ends in 10 min');
    assert.ok(LIFETIMES.some((entry) => entry.value === 'untilStopped' && entry.label === 'Until I stop it'));
  });

  test('a waiting message and a lost relay come before who is watching', () => {
    assert.equal(liveSubtitle(share({ held: 2 }), true), '2 messages wait for you');
    assert.equal(liveSubtitle(share(), false), 'Connecting to the share relay…');
    assert.equal(liveSubtitle(share(), true), 'Nobody is watching yet · stays live until you stop it');
  });

  test('Stop sharing names who gets disconnected', () => {
    const viewer = (name: string) => ({ id: name, name });
    assert.equal(names([]), null);
    assert.equal(names([viewer('Alper')]), 'Alper');
    assert.equal(names([viewer('Alper'), viewer('Sam')]), 'Alper and Sam');
    assert.equal(names(['Alper', 'Sam', 'Lee'].map(viewer)), 'Alper, Sam and 1 other');
    assert.equal(names(['Alper', 'Sam', 'Lee', 'Kim'].map(viewer)), 'Alper, Sam and 2 others');
  });
});
