/**
 * The agent's reply arriving: it fades in, and a long one stops the transcript at its top.
 *
 * CDXC:SessionChat 2026-11-08 DECISION:
 * User: "please when the last message from the agent in a turn is coming in animate it in with a fade and please keep me at the top of it dont scroll me to the bottom of it because i want to read from the top".
 * Desktop's `reply_arrival.rs` is the same rule. The newest row becoming an agent reply (prose with no tool calls, the streaming row or a finished turn's final message) is an arrival: the row fades in, and a reader at the bottom keeps following while it fits; once it is taller than the list it stops with its top a margin below the list's top and stays there while it grows or the turn folds, until the reader drags the list. A reader scrolled up is never moved. A reply that tool calls follow hands following back. The streaming row settling into the saved one is the same arrival (no second fade). The list is inverted, so a growing newest row pushes its own top up the screen: the hold moves the offset by however far that top moved.
 */

import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { FlatList, ViewInstance } from 'react-native';

import { transcriptItemKey, type TranscriptItem } from '../../rust/document';

/** The streaming reply's row id (gx-chat-core `STREAMING_ID`). */
const STREAMING_ID = 'streaming';
/** The reply's fade, the desktop's. */
export const REPLY_FADE_MS = 250;

/** An agent reply's id: an assistant row with prose and no tool calls of its own. */
function replyId(message: unknown): string | null {
  if (message === null || typeof message !== 'object') return null;
  const row = message as Record<string, unknown>;
  if (row.role !== 'assistant') return null;
  const tools =
    (Array.isArray(row.tools) && row.tools.length > 0) || (row.toolCard !== null && typeof row.toolCard === 'object');
  if (tools || typeof row.text !== 'string' || row.text.trim().length === 0) return null;
  return typeof row.id === 'string' ? row.id : null;
}

/** The reply the transcript ends with, if it ends with one. */
function newestReply(rows: readonly TranscriptItem[]): string | null {
  const last = rows[rows.length - 1];
  if (last === undefined) return null;
  if (last.kind === 'message') return replyId(last.message);
  if (last.kind === 'completed-work' || last.kind === 'summary') return replyId((last as { final?: unknown }).final);
  return null;
}

type Arrival = {
  seeded: boolean;
  newest: string | null;
  /** The row key that fades in when it mounts. */
  fadeKey: string | null;
};

type Hold = {
  /** The reply outgrew the list and its top is held. */
  placed: boolean;
};

export function useReplyArrival({
  rows,
  enabled,
  listRef,
  listOffset,
  rootRef,
  edge,
  margin,
  held,
}: {
  rows: readonly TranscriptItem[];
  enabled: boolean;
  listRef: RefObject<FlatList<never> | FlatList<any> | null>; // eslint-disable-line @typescript-eslint/no-explicit-any
  listOffset: RefObject<number>;
  rootRef: RefObject<ViewInstance | null>;
  /** How close to the bottom still counts as the bottom. */
  edge: number;
  /** How far below the list's top a held reply's top sits. */
  margin: number;
  /** Something else holds the list still (an answer sent from a row). */
  held: boolean;
}) {
  const arrival = useRef<Arrival>({ seeded: false, newest: null, fadeKey: null });
  const hold = useRef<Hold | null>(null);
  const newestRowRef = useRef<ViewInstance>(null);
  const id = enabled ? newestReply(rows) : null;
  const lastKey = rows.length > 0 ? transcriptItemKey(rows[rows.length - 1]!) : null;
  // Decided while rendering, so the row that arrives mounts with its fade.
  const current = arrival.current;
  let change: { placed: boolean; follow: boolean } | null = null;
  if (enabled) {
    if (!current.seeded) {
      if (rows.length > 0) {
        current.seeded = true;
        current.newest = id;
      }
    } else if (id !== current.newest) {
      const settling = current.newest === STREAMING_ID && id !== null;
      current.newest = id;
      if (!settling) {
        const placed = hold.current?.placed === true;
        current.fadeKey = id === null ? null : lastKey;
        change = { placed, follow: id !== null };
      }
    }
  }
  const pending = useRef<{ placed: boolean; follow: boolean } | null>(null);
  if (change !== null) pending.current = change;

  /** The newest row laid out: follow it while it fits, then keep its top where it stopped. */
  const onNewestLayout = useCallback(() => {
    if (hold.current === null) return;
    const root = rootRef.current;
    const row = newestRowRef.current;
    if (root === null || row === null) return;
    root.measureInWindow((_x, listTop, _width, listHeight) => {
      row.measureInWindow((_rx, rowTop, _rw, rowHeight) => {
        const active = hold.current;
        if (active === null) return;
        if (!active.placed) {
          if (rowHeight <= listHeight - margin) return;
          active.placed = true;
        }
        // Inverted: a larger offset moves the rows down the screen.
        const moved = listTop + margin - rowTop;
        if (Math.abs(moved) < 1) return;
        const offset = Math.max(0, listOffset.current + moved);
        listOffset.current = offset;
        listRef.current?.scrollToOffset({ offset, animated: false });
      });
    });
  }, [listOffset, listRef, margin, rootRef]);

  useEffect(() => {
    const next = pending.current;
    if (next === null) return;
    pending.current = null;
    hold.current = null;
    // A held reply gave way to working output or a new reply: follow, as before.
    if (next.placed) {
      listOffset.current = 0;
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
    }
    if (next.follow && !held && (next.placed || listOffset.current <= edge)) {
      hold.current = { placed: false };
      // Its first layout may have come before this; measure it now as well.
      onNewestLayout();
    }
  });


  /** The reader moved the list: the reply is theirs to scroll. */
  const releaseReplyHold = useCallback(() => {
    hold.current = null;
  }, []);

  return { fadeKey: current.fadeKey, newestKey: lastKey, newestRowRef, onNewestLayout, releaseReplyHold };
}
