/// <reference types="node" />
/**
 * The Unified list from the phone's own summaries: what the computers send, parsed as the phone
 * parses it, grouped and ordered as the desktop's Unified sidebar does.
 *
 * Run with `bun test src/contract/unified/fromSummary.test.ts` from apps/mobile/app.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseMobileSummary, type GhostexMobileSummary } from '../mobileSummary';
import { EMPTY_UNIFIED_FILTER, type UnifiedRow } from './build';
import { unifiedListOf, unifiedSettingsOf, wantsUnifiedSidebar, type UnifiedComputer } from './fromSummary';

const NOW = Date.parse('2026-10-30T12:00:00.000Z');

function summary(projects: object[], sessions: object[], extra: object = {}): GhostexMobileSummary {
  const parsed = parseMobileSummary(JSON.stringify({ ok: true, projects, sessions, ...extra }));
  assert.ok(parsed !== null);
  return parsed;
}

function session(sessionId: string, projectId: string, overrides: object = {}) {
  return {
    sessionId,
    projectId,
    title: sessionId,
    status: 'idle',
    activity: 'idle',
    isLive: true,
    provider: 'zmx',
    createdAt: '2026-10-20T10:00:00.000Z',
    lastInteractionAt: '2026-10-29T10:00:00.000Z',
    ...overrides,
  };
}

function computer(machineId: string, label: string, parsed: GhostexMobileSummary): UnifiedComputer {
  return { machineId, label, summary: parsed, workspaceId: null };
}

const ids = (rows: UnifiedRow[]) => rows.map((row) => row.session.sessionId);

const mac = summary(
  [
    { projectId: 'P1', name: 'Ghostex', path: '/Users/me/dev/Ghostex', gitRemoteOriginUrl: 'git@github.com:o/Ghostex.git' },
    { projectId: 'P2', name: 'notes', path: '/Users/me/notes' },
  ],
  [
    session('m-old', 'P1', { lastInteractionAt: '2026-10-28T10:00:00.000Z' }),
    session('m-new', 'P1', { lastInteractionAt: '2026-10-30T09:00:00.000Z' }),
    session('m-draft', 'P2', { isDraft: true, createdAt: '2026-10-30T08:00:00.000Z' }),
    session('m-work', 'P2', {
      activity: 'working',
      workingStartedAt: '2026-10-30T11:00:00.000Z',
      lastInteractionAt: '2026-10-30T11:59:00.000Z',
    }),
    session('m-tab', 'P1', { kind: 'browser' }),
  ],
  { sidebarView: 'unified' },
);

const windows = summary(
  [{ projectId: 'W1', name: 'gx', path: 'C:\\code\\gx', gitRemoteOriginUrl: 'https://github.com/o/ghostex' }],
  [
    session('w-question', 'W1', { pendingQuestionCount: 1, lastInteractionAt: '2026-10-30T10:00:00.000Z' }),
    session('w-snoozed', 'W1', { snoozedUntil: '2026-10-30T15:00:00.000Z' }),
    session('w-parked', 'W1', { isParked: true }),
  ],
);

describe('the computer picks the layout', () => {
  test('Unified only when the computer sends it, with its switches on unless sent off', () => {
    assert.equal(wantsUnifiedSidebar(mac), true);
    assert.equal(wantsUnifiedSidebar(windows), false);
    assert.deepEqual(unifiedSettingsOf(mac), { workingSection: true, parking: true });
    const off = summary([], [], { sidebarView: 'unified', unifiedWorkingSection: false, enableSessionParking: false });
    assert.deepEqual(unifiedSettingsOf(off), { workingSection: false, parking: false });
  });
});

describe('one list across computers (gx-core unified_sidebar/build.rs)', () => {
  const list = unifiedListOf(
    [computer('mac', 'MacBook', mac), computer('win', 'Windows', windows)],
    unifiedSettingsOf(mac),
    EMPTY_UNIFIED_FILTER,
    NOW,
  );

  test('the same repository on two computers is one project, named as its origin spells it', () => {
    assert.deepEqual(
      list.options.repos.map((option) => [option.label, option.detail]),
      [
        ['Ghostex', 'MacBook, Windows'],
        ['notes', null],
      ],
    );
    const question = list.active.find((row) => row.session.sessionId === 'w-question');
    assert.equal(question?.repo.label, 'Ghostex');
    assert.equal(question?.machineLabel, 'Windows');
  });

  test('sessions read by when they came back to you; browser tabs stay out', () => {
    assert.deepEqual(ids(list.active), ['w-question', 'm-new', 'm-old']);
    assert.equal(list.total, 7);
  });

  test('drafts on top, working, snoozed and parked on their shelves', () => {
    assert.deepEqual(ids(list.drafts), ['m-draft']);
    assert.deepEqual(ids(list.working), ['m-work']);
    assert.deepEqual(ids(list.snoozed), ['w-snoozed']);
    assert.deepEqual(ids(list.parked), ['w-parked']);
    assert.equal(list.working[0].status, 'Working');
    assert.equal(list.active[0].status, 'Question');
  });

  test('a filter by repository keeps both computers, and a pick the options dropped is let go', () => {
    const repo = list.options.repos[0].key;
    const narrowed = unifiedListOf(
      [computer('mac', 'MacBook', mac), computer('win', 'Windows', windows)],
      unifiedSettingsOf(mac),
      { repos: [repo, 'github.com/gone/away'], machines: [], spaces: [] },
      NOW,
    );
    assert.deepEqual(narrowed.filter.repos, [repo]);
    assert.deepEqual(ids(narrowed.active), ['w-question', 'm-new', 'm-old']);
    assert.deepEqual(ids(narrowed.drafts), []);
  });
});

describe('a phone with one computer', () => {
  test('its cards carry no computer name, as the desktop computer\'s own do', () => {
    const list = unifiedListOf([computer('mac', 'MacBook', mac)], unifiedSettingsOf(mac), EMPTY_UNIFIED_FILTER, NOW);
    assert.ok(list.active.every((row) => row.machineLabel === null));
  });

  test('the Working section off and parking off leave those sessions in the list', () => {
    const list = unifiedListOf(
      [computer('win', 'Windows', windows), computer('mac', 'MacBook', mac)],
      { workingSection: false, parking: false },
      EMPTY_UNIFIED_FILTER,
      NOW,
    );
    assert.deepEqual(list.working, []);
    assert.deepEqual(list.parked, []);
    assert.ok(ids(list.active).includes('m-work'));
    assert.ok(ids(list.active).includes('w-parked'));
  });
});
