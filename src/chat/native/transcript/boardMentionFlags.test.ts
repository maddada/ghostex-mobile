/// <reference types="node" />
/** Run with `bun test src/chat/native/transcript/boardMentionFlags.test.ts` from apps/mobile/app. */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { ChatDocument } from '../../rust/document';
import { transcriptFlags } from './context';

describe('board mention flags', () => {
  test("a board mention reads its card's title from the board's index", () => {
    const document = {
      coordinatorBoard: { groups: [], itemTitles: { B43: 'Deploy guest page 0.1.2 to share.ghostex.dev', B7: 7 } },
    } as unknown as ChatDocument;
    const flags = transcriptFlags(document);
    assert.deepEqual(flags.boardItemTitles, { B43: 'Deploy guest page 0.1.2 to share.ghostex.dev' });
  });

  test('a chat without a board, or a gxserver without the index, dims no mention', () => {
    assert.equal(transcriptFlags({} as unknown as ChatDocument).boardItemTitles, null);
    const old = { coordinatorBoard: { groups: [] } } as unknown as ChatDocument;
    assert.equal(transcriptFlags(old).boardItemTitles, null);
  });
});
