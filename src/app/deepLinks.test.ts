/// <reference types="node" />
/**
 * Run with `bun test src/app/deepLinks.test.ts`. A tapped notification opens its session, a question link its
 * Chat View, also at a cold start (the session list arrives during or after the attach): the real
 * `handleDeepLink` with a fake navigator and fake stores.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { handleDeepLink, parseSessionLink, sessionDeepLink, type DeepLinkDeps, type DeepLinkSession } from './deepLinkHandler';

function fake(session: DeepLinkSession | undefined) {
  const calls: string[] = [];
  const routes: unknown[] = [];
  const deps: DeepLinkDeps = {
    storesReady: () => true,
    machine: (id) => (id === 'm1' ? { id: 'm1', host: 'mac', username: 'u', port: 22 } : undefined),
    session: () => session,
    revealWorkspace: () => undefined,
    openChatTab: (_m, s) => {
      calls.push(`chat:${s.sessionId}`);
      return `m1:${s.sessionId}`;
    },
    showChatView: (key) => calls.push(`chatView:${key}`),
    attachSession: async (_m, s) => {
      calls.push(`attach:${s.sessionId}`);
      return `m1:${s.sessionId}`;
    },
    loadSession: async () => {
      calls.push('sessionList');
      return session;
    },
    navigate: (route) => routes.push(route),
    later: (retry) => retry(),
    markOpened: (machineId, sessionId) => calls.push(`markOpened:${machineId}:${sessionId}`),
  };
  return { deps, calls, routes };
}

/** A cold start: the computer's session list is not on the phone yet; it lists `listed` once it arrives. */
function coldStart(listed: DeepLinkSession, arrives: 'duringAttach' | 'whenAsked') {
  const f = fake(undefined);
  let current: DeepLinkSession | undefined;
  f.deps.session = () => current;
  f.deps.attachSession = async (_m, s) => {
    f.calls.push(`attach:${s.sessionId}`);
    if (arrives === 'duringAttach') current = listed;
    return `m1:${s.sessionId}`;
  };
  f.deps.loadSession = async () => {
    f.calls.push('sessionList');
    current = listed;
    return current;
  };
  return f;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a notification tap opens its session', () => {
  test('a session that opens in its terminal is attached and shown', async () => {
    const f = fake({ projectId: 'p1', title: 'fix build', hasChatView: false, opensInChatView: false });
    handleDeepLink('ghostex://session?machineId=m1&sessionId=s1', f.deps);
    await settle();
    assert.deepEqual(f.calls, ['attach:s1']);
    assert.deepEqual(f.routes, [
      { name: 'Terminal', params: { sessionKey: 'm1:s1', machineId: 'm1', title: 'fix build' } },
    ]);
  });

  test('a session that opens in its chat view shows the chat', () => {
    const f = fake({ projectId: 'p1', title: 'fix build', hasChatView: true, opensInChatView: true });
    handleDeepLink('ghostex://session?machineId=m1&sessionId=s1', f.deps);
    assert.deepEqual(f.calls, ['chat:s1']);
  });

  test('a question link opens session s1 of m1 in its chat view', () => {
    const f = fake({ projectId: 'p1', title: 'fix build', hasChatView: true, opensInChatView: false });
    const url = sessionDeepLink({ machineId: 'm1', sessionId: 's1', view: 'question' });
    handleDeepLink(url, f.deps);
    assert.deepEqual(f.calls, ['chat:s1', 'chatView:m1:s1']);
    assert.deepEqual(f.routes, [
      { name: 'Terminal', params: { sessionKey: 'm1:s1', machineId: 'm1', title: 'fix build' } },
    ]);
  });

  test('a session without a chat view opens its terminal', async () => {
    const f = fake({ projectId: 'p1', title: '', hasChatView: false, opensInChatView: false });
    handleDeepLink(sessionDeepLink({ machineId: 'm1', sessionId: 's1', view: 'question' }), f.deps);
    await settle();
    assert.deepEqual(f.calls, ['attach:s1']);
  });

  test('an unknown computer opens nothing', () => {
    const f = fake(undefined);
    handleDeepLink('ghostex://session?machineId=other&sessionId=s1', f.deps);
    assert.deepEqual(f.calls, []);
  });
});

describe('a question notification tapped at a cold start', () => {
  const withChat: DeepLinkSession = { projectId: 'p1', title: 'fix build', hasChatView: true, opensInChatView: false };
  const terminalOnly: DeepLinkSession = { projectId: 'p1', title: '', hasChatView: false, opensInChatView: false };
  const questionLink = sessionDeepLink({ machineId: 'm1', sessionId: 's1', view: 'question' });

  test('the session list arrives during the attach: the Chat View with its question card is shown', async () => {
    const f = coldStart(withChat, 'duringAttach');
    handleDeepLink(questionLink, f.deps);
    await settle();
    assert.deepEqual(f.calls, ['attach:s1', 'chatView:m1:s1']);
    assert.equal(f.routes.length, 1);
  });

  test('the session list is not there after the attach: it is read, then the Chat View is shown', async () => {
    const f = coldStart(withChat, 'whenAsked');
    handleDeepLink(questionLink, f.deps);
    await settle();
    assert.deepEqual(f.calls, ['attach:s1', 'sessionList', 'chatView:m1:s1']);
    assert.equal(f.routes.length, 1);
  });

  test('exception: a session without a Chat View stays in its terminal', async () => {
    const f = coldStart(terminalOnly, 'whenAsked');
    handleDeepLink(questionLink, f.deps);
    await settle();
    assert.deepEqual(f.calls, ['attach:s1', 'sessionList']);
  });

  test('an ordinary link forces no view: the Terminal screen picks it as a tap in the Sessions list would', async () => {
    const f = coldStart(withChat, 'duringAttach');
    handleDeepLink('ghostex://session?machineId=m1&sessionId=s1', f.deps);
    await settle();
    assert.deepEqual(f.calls, ['attach:s1']);
  });
});

/**
 * A Live Activity row opens its session through the app's existing parser (`deepLinkHandler.ts`), and a row with a
 * question opens its question card. These literal URLs match `GhostexActivityRow.deepLink` in the Swift tests:
 * ids are percent-encoded and only a question row adds `view=question`.
 */


describe('session links from Live Activity rows', () => {
  test('of two same-named sessions, each link opens its own session', () => {
    const first = parseSessionLink('ghostex://session?machineId=m1&sessionId=sess%261');
    const second = parseSessionLink('ghostex://session?machineId=m1&sessionId=sess%262');
    assert.deepEqual(first, { machineId: 'm1', sessionId: 'sess&1', title: '', view: null, source: null });
    assert.deepEqual(second, { machineId: 'm1', sessionId: 'sess&2', title: '', view: null, source: null });
  });

  test('reserved characters inside an id stay part of that id', () => {
    const link = parseSessionLink('ghostex://session?machineId=a%23b%3Dc&sessionId=x%2By%25z%3Fw%2F');
    assert.deepEqual(link, { machineId: 'a#b=c', sessionId: 'x+y%z?w/', title: '', view: null, source: null });
  });

  test('a link without both ids opens nothing', () => {
    assert.equal(parseSessionLink('ghostex://session?machineId=m1'), null);
    assert.equal(parseSessionLink('ghostex://voice'), null);
  });

  test('the existing notification link with a title still parses the same way', () => {
    assert.deepEqual(parseSessionLink('ghostex://session?machineId=m1&sessionId=s1&title=Fix%20tests'), {
      machineId: 'm1',
      sessionId: 's1',
      title: 'Fix tests',
      view: null,
      source: null,
    });
  });

  const savedInTerminal: DeepLinkSession = {
    projectId: 'p1',
    title: 'fix build',
    hasChatView: true,
    opensInChatView: false,
  };

  test('a row that has a question opens the question card, also for a session saved in its terminal view', () => {
    const f = fake(savedInTerminal);
    handleDeepLink('ghostex://session?machineId=m1&sessionId=sess%261&view=question', f.deps);
    assert.deepEqual(f.calls, ['chat:sess&1', 'chatView:m1:sess&1']);
  });

  test('a row without a question opens the session in the view a tap in the Sessions list picks', async () => {
    const f = fake(savedInTerminal);
    handleDeepLink('ghostex://session?machineId=m1&sessionId=sess%261', f.deps);
    await settle();
    assert.deepEqual(f.calls, ['attach:sess&1']);
  });
});

describe('a tapped notification whose opening stops being current (a later tap, or the person left)', () => {
  const withChat: DeepLinkSession = { projectId: 'p1', title: 'fix build', hasChatView: true, opensInChatView: true };
  const link = sessionDeepLink({ machineId: 'm1', sessionId: 's1' });
  const questionLink = sessionDeepLink({ machineId: 'm1', sessionId: 's1', view: 'question' });

  test('one that stopped being current before the stores were loaded opens nothing once they are', () => {
    const f = fake(withChat);
    let ready = false;
    const waiting: { retry?: () => void } = {};
    f.deps.storesReady = () => ready;
    f.deps.later = (retry) => {
      waiting.retry = retry;
    };
    let current = true;
    handleDeepLink(link, f.deps, () => current);
    current = false;
    ready = true;
    waiting.retry?.();
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.routes, []);
  });

  test('one that stopped being current while its terminal attached neither shows nor navigates to it', async () => {
    const f = fake(undefined);
    const attached = Promise.withResolvers<string>();
    f.deps.attachSession = (_m, s) => {
      f.calls.push(`attach:${s.sessionId}`);
      return attached.promise;
    };
    let current = true;
    handleDeepLink(questionLink, f.deps, () => current);
    current = false;
    attached.resolve('m1:s1');
    await settle();
    assert.deepEqual(f.calls, ['attach:s1']);
    assert.deepEqual(f.routes, []);
  });

  test('one that stopped being current while the session list was read after the attach shows no Chat View', async () => {
    const f = coldStart(withChat, 'whenAsked');
    let current = true;
    f.deps.loadSession = async () => {
      f.calls.push('sessionList');
      current = false;
      return withChat;
    };
    handleDeepLink(questionLink, f.deps, () => current);
    await settle();
    assert.deepEqual(f.calls, ['attach:s1', 'sessionList']);
    assert.equal(f.routes.length, 1);
  });

  test('its navigation carries the check along, for a navigation that waits until the screens are ready', () => {
    const f = fake(withChat);
    const checks: (() => boolean)[] = [];
    f.deps.navigate = (route, current) => {
      f.routes.push(route);
      if (current !== undefined) checks.push(current);
    };
    let current = true;
    handleDeepLink(link, f.deps, () => current);
    current = false;
    assert.equal(f.routes.length, 1);
    assert.deepEqual(
      checks.map((check) => check()),
      [false],
    );
  });

  test('a link opened without a check (a link from outside the app, an attention-list row) opens as before', async () => {
    const f = fake(undefined);
    handleDeepLink(link, f.deps);
    await settle();
    assert.deepEqual(f.calls, ['attach:s1']);
    assert.equal(f.routes.length, 1);
  });
});
