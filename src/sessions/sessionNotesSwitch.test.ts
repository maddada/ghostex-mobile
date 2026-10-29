/// <reference types="node" />
/** Run with `bun test src/sessions/sessionNotesSwitch.test.ts` from apps/mobile/app. */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { parseMobileSummary } from '../contract/mobileSummary';
import { sessionNotesOnIn } from './sessionNotesSwitch';

function noteOfRow(builtInFeaturesOff?: string[]): string | undefined {
  return parseMobileSummary(
    JSON.stringify({
      sessions: [
        {
          sessionId: 'S1',
          projectId: 'P1',
          provider: 'zmx',
          agentSessionId: 'conversation-1',
          sessionNote: 'Check the migration next',
        },
      ],
      ...(builtInFeaturesOff === undefined ? {} : { builtInFeaturesOff }),
    }),
  )?.sessions[0]?.sessionNote;
}

describe('the Session notes switch', () => {
  test('a computer that has not answered yet, or is too old to know the switch, has it on', () => {
    assert.equal(sessionNotesOnIn(undefined), true);
    assert.equal(sessionNotesOnIn(null), true);
    assert.equal(sessionNotesOnIn({}), true);
    assert.equal(sessionNotesOnIn({ builtInFeaturesOff: ['readAloud'] }), true);
  });

  test('a computer that lists it as off has it off', () => {
    assert.equal(sessionNotesOnIn({ builtInFeaturesOff: ['readAloud', 'sessionNotes'] }), false);
  });

  test('a row draws no note dot while the computer lists it as off, and the kept note comes back with it', () => {
    assert.equal(noteOfRow(['sessionNotes']), '');
    assert.equal(noteOfRow(['readAloud']), 'Check the migration next');
    assert.equal(noteOfRow(), 'Check the migration next');
  });
});
