/**
 * Reply drafts: what was typed in a work item's Reply sheet and not sent, by chat and row, so it is
 * there again when the sheet opens after a tap away, a closed row, or a restart of the app. The
 * phone's half of the desktop's `KEPT_REPLIES` (apps/desktop/src/app/native_chat/reply_popover.rs).
 *
 * CDXC:Coordinators 2026-11-11 DECISION:
 * User, of the desktop's Reply boxes: "PLEASE keep in memory what i wrote there so we restore it when
 * i click away by mistake", then "not good enough fam. pls fix." (gxserver keeps them); and of the
 * phone: "make sure we make the work items work the same way as it does on desktop so answering
 * questions the ability to reply. saving draft for a reply. etc." Each draft is kept twice: on the
 * phone (AsyncStorage, so a restart or a computer that is offline or older loses nothing) and on the
 * session's gxserver (`/api/sessionReplyDrafts`, server/src/session_reply_drafts.rs, the desktop's
 * store), so a draft started on one device opens on the other. The phone's own words win over the
 * computer's when both have one. A draft goes when it is sent, or when its row was seen on the dock
 * or the Work panel and is on neither now (answered, dismissed or withdrawn), as on the desktop.
 *
 * A computer from before 11.4.0 answers the call with an error, which is ignored: the phone's copy
 * still works.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import type { MachineConnectionTarget } from '../../../machines/credentials';
import { isCloudBoxMachineId } from '../../../cloudBoxes/types';
import { chatMachineLink } from '../../rust/machine-link';
import { sessionChatRpc } from '../../rust/transport';

/** The chat a draft belongs to. */
export type ReplyDraftScope = { machine: MachineConnectionTarget; projectId: string; sessionId: string };

const STORAGE_KEY = 'ghostex.workReplyDrafts.v1';
/** One save per pause in typing, not per keystroke (desktop `SAVE_AFTER`). */
const SAVE_AFTER_MS = 400;
const CALL_TIMEOUT_MS = 8_000;
/** The server's own limits (session_reply_drafts.rs): its longest text, and a stale draft's age. */
const MAX_TEXT_CHARS = 20_000;
const STALE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_DRAFTS = 400;

type Kept = { text: string; at: number };

const useDrafts = create<{ drafts: Record<string, Kept> }>(() => ({ drafts: {} }));

/** `<machine>/<project>/<session>\n<row>`, the desktop's `kept_reply_key`. */
function scopePrefix(scope: ReplyDraftScope): string {
  return `${scope.machine.id}/${scope.projectId}/${scope.sessionId}\n`;
}

function draftKey(scope: ReplyDraftScope, row: string): string {
  return `${scopePrefix(scope)}${row}`;
}

/**
 * The row a Reply belongs to, from its `reply` object (`{item, key, tag}` or `{form, tag}`): a
 * work item ask's `work-ask:W7:Q12`, an item's own `work-item:W7`, else its key or the question's
 * form and tag. The same names as the desktop's `kept_reply_row`, so both find the same draft on
 * gxserver.
 */
export function replyDraftRow(reply: {
  item?: string;
  key?: string;
  tag?: string;
  form?: string | null;
}): string | null {
  const tag = reply.tag ?? '';
  const item = reply.item ?? '';
  if (item.length > 0) return tag.length > 0 ? `work-ask:${item}:${tag}` : `work-item:${item}`;
  const key = reply.key ?? '';
  if (key.length > 0) return key;
  return tag.length > 0 ? `question:${reply.form ?? ''}:${tag}` : null;
}

// ---- the phone's copy ----------------------------------------------------------------------------

let restored: Promise<void> | null = null;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

/** Reads the phone's copy once per run of the app. */
function restore(): Promise<void> {
  restored ??= AsyncStorage.getItem(STORAGE_KEY)
    .then((saved) => {
      if (saved === null) return;
      const parsed = JSON.parse(saved) as unknown;
      if (typeof parsed !== 'object' || parsed === null) return;
      const cutoff = Date.now() - STALE_MS;
      const loaded: Record<string, Kept> = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        const kept = value as Partial<Kept> | null;
        if (typeof kept?.text === 'string' && typeof kept.at === 'number' && kept.at > cutoff)
          loaded[key] = kept as Kept;
      }
      // Anything typed before the read finished stays.
      useDrafts.setState((state) => ({ drafts: { ...loaded, ...state.drafts } }));
    })
    .catch(() => undefined);
  return restored;
}

function persistSoon(): void {
  if (persistTimer !== null) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    const entries = Object.entries(useDrafts.getState().drafts)
      .sort((left, right) => right[1].at - left[1].at)
      .slice(0, MAX_DRAFTS);
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries))).catch(() => undefined);
  }, SAVE_AFTER_MS);
}

// ---- the computer's copy -------------------------------------------------------------------------

/** Chats whose drafts were asked of gxserver this run. */
const listed = new Set<string>();
/** Calls waiting per chat, sent one at a time so a late save cannot bring back a sent draft. */
const queues = new Map<string, { calls: Record<string, unknown>[]; sending: boolean }>();
/** Rows edited since their last save, per chat. */
const unsaved = new Map<string, Set<string>>();
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();

async function call(scope: ReplyDraftScope, params: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const sent = { ...params, projectId: scope.projectId, sessionId: scope.sessionId };
  try {
    const answer = isCloudBoxMachineId(scope.machine.id)
      ? await sessionChatRpc(scope.machine, 'sessionReplyDrafts', sent, CALL_TIMEOUT_MS)
      : await chatMachineLink(scope.machine).rpc('sessionReplyDrafts', sent, CALL_TIMEOUT_MS);
    if (answer.error !== null) return null;
    return typeof answer.result === 'object' && answer.result !== null
      ? (answer.result as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function enqueue(scope: ReplyDraftScope, params: Record<string, unknown>): void {
  const prefix = scopePrefix(scope);
  const queue = queues.get(prefix) ?? { calls: [], sending: false };
  queues.set(prefix, queue);
  queue.calls.push(params);
  const pump = (): void => {
    if (queue.sending) return;
    const next = queue.calls.shift();
    if (next === undefined) return;
    queue.sending = true;
    void call(scope, next).finally(() => {
      queue.sending = false;
      pump();
    });
  };
  pump();
}

/**
 * Reads the chat's drafts (the phone's copy, then the computer's) once per run; a draft the phone
 * does not hold joins from the computer.
 */
export function loadReplyDrafts(scope: ReplyDraftScope): void {
  if (scope.projectId.length === 0 || scope.sessionId.length === 0) return;
  const prefix = scopePrefix(scope);
  void restore().then(async () => {
    if (listed.has(prefix)) return;
    listed.add(prefix);
    const answer = await call(scope, { op: 'list' });
    const remote = answer?.drafts;
    if (typeof remote !== 'object' || remote === null) return;
    const now = Date.now();
    useDrafts.setState((state) => {
      const drafts = { ...state.drafts };
      let changed = false;
      for (const [row, text] of Object.entries(remote as Record<string, unknown>)) {
        if (typeof text !== 'string' || text.trim().length === 0 || drafts[`${prefix}${row}`] !== undefined) continue;
        drafts[`${prefix}${row}`] = { text, at: now };
        changed = true;
      }
      return changed ? { drafts } : state;
    });
    persistSoon();
  });
}

/** The draft kept for `row`, or '' (a hook: a row's Reply shows "Draft" while it holds one). */
export function useReplyDraft(scope: ReplyDraftScope | null, row: string | null): string {
  return useDrafts((state) => (scope === null || row === null ? '' : (state.drafts[draftKey(scope, row)]?.text ?? '')));
}

export function replyDraft(scope: ReplyDraftScope | null, row: string | null): string {
  if (scope === null || row === null) return '';
  return useDrafts.getState().drafts[draftKey(scope, row)]?.text ?? '';
}

/** The Reply sheet's words changed: kept now, saved on the computer after a pause. */
export function keepReplyDraft(scope: ReplyDraftScope, row: string, text: string): void {
  const key = draftKey(scope, row);
  const words = text.slice(0, MAX_TEXT_CHARS);
  useDrafts.setState((state) => {
    const drafts = { ...state.drafts };
    if (words.trim().length === 0) delete drafts[key];
    else drafts[key] = { text: words, at: Date.now() };
    return { drafts };
  });
  persistSoon();
  const prefix = scopePrefix(scope);
  const rows = unsaved.get(prefix) ?? new Set<string>();
  unsaved.set(prefix, rows);
  rows.add(row);
  const timer = saveTimers.get(prefix);
  if (timer !== undefined) clearTimeout(timer);
  saveTimers.set(
    prefix,
    setTimeout(() => {
      saveTimers.delete(prefix);
      for (const edited of rows) enqueue(scope, { op: 'set', row: edited, text: replyDraft(scope, edited) });
      rows.clear();
    }, SAVE_AFTER_MS),
  );
}

/** Drops these rows' drafts, here and on the computer: sent, or their question is gone. */
export function dropReplyDrafts(scope: ReplyDraftScope, rows: readonly string[]): void {
  if (rows.length === 0) return;
  useDrafts.setState((state) => {
    const drafts = { ...state.drafts };
    for (const row of rows) delete drafts[draftKey(scope, row)];
    return { drafts };
  });
  persistSoon();
  for (const row of rows) unsaved.get(scopePrefix(scope))?.delete(row);
  enqueue(scope, { op: 'drop', rows: [...rows] });
}

/** Every `reply` object anywhere in `value` (the dock's rows, the Work panel's `actions`). */
function collectReplyRows(value: unknown, rows: Set<string>, depth = 0): void {
  if (depth > 12 || typeof value !== 'object' || value === null) return;
  if (Array.isArray(value)) {
    for (const child of value) collectReplyRows(child, rows, depth + 1);
    return;
  }
  for (const [field, child] of Object.entries(value as Record<string, unknown>)) {
    if (field === 'reply' && typeof child === 'object' && child !== null && !Array.isArray(child)) {
      const row = replyDraftRow(child as Parameters<typeof replyDraftRow>[0]);
      if (row !== null) rows.add(row);
    } else {
      collectReplyRows(child, rows, depth + 1);
    }
  }
}

/** Drafts whose row has been on the dock or the Work panel this run (desktop `KeptReply::seen`). */
const seen = new Set<string>();

/**
 * A new dock and Work panel: a work item draft whose row was seen there and is on neither now goes
 * (answered, dismissed or withdrawn), as on the desktop (`prune_kept_replies`). A snoozed ask stays
 * in the Work panel's Later group, so snoozing keeps its draft.
 */
export function pruneReplyDrafts(scope: ReplyDraftScope, dock: unknown, board: unknown): void {
  const prefix = scopePrefix(scope);
  const keys = Object.keys(useDrafts.getState().drafts).filter((key) => key.startsWith(prefix));
  if (keys.length === 0) return;
  const open = new Set<string>();
  collectReplyRows(dock, open);
  collectReplyRows(board, open);
  const gone: string[] = [];
  for (const key of keys) {
    const row = key.slice(prefix.length);
    if (open.has(row)) seen.add(key);
    else if (seen.has(key) && row.startsWith('work-')) {
      seen.delete(key);
      gone.push(row);
    }
  }
  dropReplyDrafts(scope, gone);
}

// ---- which chat a Reply sheet belongs to ---------------------------------------------------------

/**
 * Each chat's scope by its `dispatch` (stable per chat): the dock registers it, and the Work panel's
 * sheet, drawn from the same chat, reads it to open a Reply that keeps its draft.
 */
const scopes = new WeakMap<object, ReplyDraftScope>();

export function registerReplyDraftScope(dispatch: object, scope: ReplyDraftScope): void {
  scopes.set(dispatch, scope);
}

export function replyDraftScopeOf(dispatch: object): ReplyDraftScope | null {
  return scopes.get(dispatch) ?? null;
}
