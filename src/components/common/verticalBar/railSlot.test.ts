/// <reference types="node" />
/**
 * Run with `bun test src/components/common/verticalBar/railSlot.test.ts`.
 *
 * No avoidable work: showing the header the side bar already holds changes nothing, so the side bar
 * does not render again. The focused screen's header buttons stand in the side bar, and a screen
 * leaving it takes only its own buttons away. No letterbox-like bars: the strip under the side bar
 * shows the focused screen's own background, so it changes with the screen (chat view and terminal
 * view differ).
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { nextRailSlot, type RailButtons, type RailEntry } from './railSlot';

const PAGE = '#0b0b0b';
const CHAT = '#0e0e0e';
const TERMINAL = '#000000';

function buttons(...keys: string[]): RailButtons {
  const entries: RailEntry[] = keys.map((key) => ({
    key,
    label: key,
    icon: () => {
      throw new Error('not drawn here');
    },
    onPress: () => undefined,
  }));
  return { entries, pinned: 0, moreMenu: 'always', reserveKeyboard: false };
}

describe('side bar slot', () => {
  test('the same header again keeps the slot as it is', () => {
    const more = buttons('more');
    const shown = nextRailSlot(null, { kind: 'show', owner: 'sessions', buttons: more, background: PAGE });
    assert.equal(nextRailSlot(shown, { kind: 'show', owner: 'sessions', buttons: more, background: PAGE }), shown);
  });

  test('a changed header replaces the buttons in one step', () => {
    const before = buttons('back', 'view', 'more');
    const after = buttons('back', 'more');
    const shown = nextRailSlot(null, { kind: 'show', owner: 'terminal', buttons: before, background: TERMINAL });
    assert.deepEqual(nextRailSlot(shown, { kind: 'show', owner: 'terminal', buttons: after, background: TERMINAL }), {
      owner: 'terminal',
      buttons: after,
      background: TERMINAL,
    });
  });

  test('switching the terminal to chat view gives the strip the chat background', () => {
    const header = buttons('back', 'more');
    const terminal = nextRailSlot(null, { kind: 'show', owner: 'terminal', buttons: header, background: TERMINAL });
    assert.deepEqual(nextRailSlot(terminal, { kind: 'show', owner: 'terminal', buttons: header, background: CHAT }), {
      owner: 'terminal',
      buttons: header,
      background: CHAT,
    });
  });

  test('the screen focused next puts its own buttons there', () => {
    const terminalButtons = buttons('back', 'more');
    const sessions = nextRailSlot(null, {
      kind: 'show',
      owner: 'sessions',
      buttons: buttons('more'),
      background: PAGE,
    });
    assert.deepEqual(
      nextRailSlot(sessions, { kind: 'show', owner: 'terminal', buttons: terminalButtons, background: TERMINAL }),
      { owner: 'terminal', buttons: terminalButtons, background: TERMINAL },
    );
  });

  test('leaving clears only the leaving screen buttons', () => {
    const terminal = nextRailSlot(null, {
      kind: 'show',
      owner: 'terminal',
      buttons: buttons('back', 'more'),
      background: TERMINAL,
    });
    assert.equal(nextRailSlot(terminal, { kind: 'leave', owner: 'terminal' }), null);
    assert.equal(nextRailSlot(terminal, { kind: 'leave', owner: 'sessions' }), terminal);
    assert.equal(nextRailSlot(null, { kind: 'leave', owner: 'sessions' }), null);
  });
});
