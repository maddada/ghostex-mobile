/**
 * The stored records the Rust core leaves to the host, and the three draft operations it names as
 * stores: the phone port of `apps/desktop/src/app/gx_chat/draft_ops.rs`, `host_records.rs` and
 * `outbox.rs`.
 *
 * - `draftSubmitted`, `draftPark`, `draftReceive` arrive as `writeStorage` effects whose value is
 *   `{text, version}`. They are operations, not rows: the stored draft is cleared or parked only
 *   when it still holds the claimed revision, and a send joins the sent history.
 * - `composerHistory` arrives as a `readStorage` and is answered with a SCAN of the sent history:
 *   the last 50 prompts across every session, oldest first.
 * - The draft save outbox holds every `setSessionChatDraft` until gxserver acknowledges it.
 *
 * CDXC:Mobile 2026-09-24 WHY:
 * The desktop host also writes draft recovery checkpoints (`ghostex.sessionChat.recovery.`) and
 * folds their dismissals. The phone has no surface that reads them, and the outbox below already
 * keeps an unsent revision until the daemon has it, so the phone host does not write them.
 */

import type { ChatStorageKey } from './events';
import { readRecord, scanRecords, writeRecord } from './storage';

/** `ghostex.sessionChat.sent.` keeps the last 50 sent prompts across every session. */
export const MAX_SENT_MESSAGES = 50;

export type DraftVersion = { draftId: string; revision: number };

/** One stored composer draft, `StoredDraftRecord` in `packages/gx-chat-core/src/composer/storage.rs`. */
export type StoredDraft = {
  text: string;
  updatedAt?: number;
  version?: DraftVersion;
  submitted: boolean;
  parked: boolean;
};

/** One pending draft save, `PendingDraft` in `host_records.rs`. */
export type PendingDraft = {
  clientId?: string;
  sessionKey: string;
  content: string;
  version: DraftVersion;
  updatedAt: number;
};

/** What `composer('park')` hands back: the handoff identity the terminal acknowledges by. */
export type ParkResult = { handoffId: string; content: string; draftVersion: DraftVersion | null };

/** A v4 UUID. `crypto.randomUUID` when the runtime has it; identity only, never a secret. */
export function randomUuid(): string {
  const native = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto?.randomUUID;
  if (typeof native === 'function') return native.call((globalThis as { crypto?: unknown }).crypto);
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16));
  hex[12] = '4';
  hex[16] = ((Number.parseInt(hex[16] ?? '0', 16) & 0x3) | 0x8).toString(16);
  const text = hex.join('');
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}

/** `nextSessionChatDraftVersion()`: a fresh identity at revision 1. */
export function nextDraftVersion(): DraftVersion {
  return { draftId: randomUuid(), revision: 1 };
}

/** `new Date(ms).toISOString()`; the sent history sorts on this string. */
function isoFromMillis(ms: number): string {
  return new Date(ms).toISOString();
}

function key(store: string, suffix = ''): ChatStorageKey {
  return { store, suffix };
}

function versionOf(value: unknown): DraftVersion | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as { draftId?: unknown; revision?: unknown };
  if (typeof record.draftId !== 'string' || typeof record.revision !== 'number') return null;
  if (!Number.isSafeInteger(record.revision) || record.revision <= 0) return null;
  return { draftId: record.draftId, revision: record.revision };
}

/** `decodeStoredDraft`: JSON with a string `text` and numeric `updatedAt`, else legacy raw text. */
export function decodeStoredDraft(raw: string): StoredDraft {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (typeof parsed === 'object' && parsed !== null && typeof parsed.text === 'string' && typeof parsed.updatedAt === 'number') {
      const version = versionOf(parsed.version);
      return {
        text: parsed.text,
        updatedAt: parsed.updatedAt,
        ...(version !== null ? { version } : {}),
        submitted: parsed.submitted === true,
        parked: parsed.parked === true,
      };
    }
  } catch {
    // Legacy drafts are the raw composer text.
  }
  return { text: raw, submitted: false, parked: false };
}

async function storedDraft(sessionKey: string, nowMs: number): Promise<StoredDraft | null> {
  const raw = await readRecord(key('drafts', sessionKey), nowMs);
  return raw === null || raw.length === 0 ? null : decodeStoredDraft(raw);
}

function writeDraft(sessionKey: string, draft: StoredDraft, nowMs: number): Promise<void> {
  return writeRecord(key('drafts', sessionKey), JSON.stringify(draft), nowMs);
}

function matches(draft: StoredDraft, version: DraftVersion | null): boolean {
  if (draft.version === undefined || version === null) return draft.version === undefined && version === null;
  return draft.version.draftId === version.draftId && draft.version.revision === version.revision;
}

type OperationPayload = { text: string; version: DraftVersion | null };

function payload(value: string | null): OperationPayload {
  try {
    const parsed = JSON.parse(value ?? 'null') as { text?: unknown; version?: unknown } | null;
    return { text: typeof parsed?.text === 'string' ? parsed.text : '', version: versionOf(parsed?.version) };
  } catch {
    return { text: '', version: null };
  }
}

/**
 * `composer('submitted', {text, version})`: retire the outbox rows of that revision, clear the
 * stored draft if it still holds exactly the submitted revision, and record the send in history.
 * A failed history write is swallowed: the prompt was already delivered and must not come back.
 */
export async function draftSubmitted(sessionKey: string, value: string | null, nowMs: number): Promise<void> {
  const { text, version } = payload(value);
  if (version !== null) await acknowledgeDraftSaves(sessionKey, version, nowMs);
  const current = await storedDraft(sessionKey, nowMs);
  if (current !== null && current.text === text && matches(current, version)) {
    await writeDraft(
      sessionKey,
      { text: '', updatedAt: nowMs, ...(current.version ? { version: current.version } : {}), submitted: true, parked: false },
      nowMs
    );
  }
  await recordSentPrompt(text, sessionKey, null, isoFromMillis(nowMs), nowMs).catch(() => false);
}

/**
 * `composer('park', {text, version})`: the draft was handed to the terminal. Refuses with the
 * TypeScript's own sentence when the stored draft moved, because the terminal would receive text
 * this composer is not clearing.
 */
export async function draftPark(sessionKey: string, value: string | null, nowMs: number): Promise<ParkResult> {
  const { text, version } = payload(value);
  const current = await storedDraft(sessionKey, nowMs);
  if (current === null || current.text !== text || !matches(current, version)) {
    throw new Error('The draft changed during transfer. It has been kept in Chat.');
  }
  await writeDraft(
    sessionKey,
    {
      text: current.text,
      updatedAt: current.updatedAt ?? nowMs,
      ...(current.version ? { version: current.version } : {}),
      submitted: false,
      parked: true,
    },
    nowMs
  );
  return { handoffId: randomUuid(), content: current.text, draftVersion: current.version ?? null };
}

/**
 * `composer('receive', ...)`: a draft arrived from another client. The disposition and its stored
 * write are the core's; on desktop the host adds only a recovery checkpoint, which the phone does
 * not keep (see the file comment), so this answers success.
 */
export async function draftReceive(): Promise<void> {
  return Promise.resolve();
}

// ---------------------------------------------------------------------------------------------
// Sent history and delivery receipts
// ---------------------------------------------------------------------------------------------

type SentRow = { createdAt: string; promptId: string; suffix: string; content: string };

async function sortedSentPrompts(nowMs: number): Promise<SentRow[]> {
  const rows = await scanRecords('sentHistory', '', nowMs).catch(() => [] as [string, string][]);
  const prompts: SentRow[] = [];
  for (const [suffix, raw] of rows) {
    try {
      const value = JSON.parse(raw) as { createdAt?: unknown; promptId?: unknown; content?: unknown };
      if (typeof value.createdAt !== 'string') continue;
      prompts.push({
        createdAt: value.createdAt,
        promptId: typeof value.promptId === 'string' ? value.promptId : '',
        suffix,
        content: typeof value.content === 'string' ? value.content : '',
      });
    } catch {
      // A row that no longer decodes is skipped, as the index's decoder does.
    }
  }
  prompts.sort((left, right) =>
    left.createdAt === right.createdAt
      ? right.promptId.localeCompare(left.promptId)
      : right.createdAt.localeCompare(left.createdAt)
  );
  return prompts;
}

async function pruneSentHistory(keep: number, nowMs: number): Promise<void> {
  const prompts = await sortedSentPrompts(nowMs);
  for (const row of prompts.slice(keep)) {
    await writeRecord(key('sentHistory', row.suffix), null, nowMs).catch(() => undefined);
  }
}

/** `recordSentSessionChatMessage`: one sent prompt, keyed `sent:<deliveryId or uuid>`. */
export async function recordSentPrompt(
  text: string,
  sessionKey: string | null,
  deliveryId: string | null,
  timestamp: string,
  nowMs: number
): Promise<boolean> {
  if (text.trim().length === 0) return false;
  const parts = sessionKey === null ? [] : sessionKey.split(':');
  const promptId = `sent:${deliveryId ?? randomUuid()}`;
  const prompt = {
    promptId,
    content: text,
    createdAt: timestamp,
    updatedAt: timestamp,
    cwd: null,
    projectId: parts.length >= 2 ? parts[parts.length - 2] : null,
    projectName: null,
    sessionId: parts.length > 0 && parts[parts.length - 1] !== '' ? parts[parts.length - 1] : null,
  };
  await pruneSentHistory(MAX_SENT_MESSAGES - 1, nowMs);
  await writeRecord(key('sentHistory', promptId), JSON.stringify(prompt), nowMs);
  await pruneSentHistory(MAX_SENT_MESSAGES, nowMs);
  return true;
}

/** `composer('history')`: the last 50 sent prompts as plain text, OLDEST first, as JSON. */
export async function composerHistory(nowMs: number): Promise<string> {
  const contents = (await sortedSentPrompts(nowMs)).slice(0, MAX_SENT_MESSAGES).map((row) => row.content);
  await pruneSentHistory(MAX_SENT_MESSAGES, nowMs);
  contents.reverse();
  return JSON.stringify(contents);
}

/**
 * `recordDeliveredSessionChatDrafts`: every delivery the daemon reported joins the sent history
 * once. The receipt set is keyed `<projectId>:<sessionId>` (no machine prefix, the desktop spelling)
 * and holds the newest 50 ids.
 */
export async function recordDeliveries(deliveries: readonly unknown[], nowMs: number): Promise<void> {
  for (const delivery of deliveries) {
    if (typeof delivery !== 'object' || delivery === null) continue;
    const record = delivery as Record<string, unknown>;
    const id = record.id;
    const projectId = record.projectId;
    const sessionId = record.sessionId;
    if (typeof id !== 'string' || typeof projectId !== 'string' || typeof sessionId !== 'string') continue;
    const sessionKey = `${projectId}:${sessionId}`;
    const receipts = key('deliveryReceipts', sessionKey);
    let seen: string[] = [];
    try {
      const parsed = JSON.parse((await readRecord(receipts, nowMs)) ?? '[]') as unknown;
      if (Array.isArray(parsed)) seen = parsed.filter((entry): entry is string => typeof entry === 'string');
    } catch {
      seen = [];
    }
    if (seen.includes(id)) continue;
    const recorded = await recordSentPrompt(
      typeof record.text === 'string' ? record.text : '',
      sessionKey,
      id,
      typeof record.deliveredAt === 'string' ? record.deliveredAt : isoFromMillis(nowMs),
      nowMs
    ).catch(() => false);
    if (!recorded) continue;
    seen.push(id);
    await writeRecord(receipts, JSON.stringify(seen.slice(-MAX_SENT_MESSAGES)), nowMs).catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------------------------
// The draft save outbox
// ---------------------------------------------------------------------------------------------

function outboxSuffix(draft: PendingDraft): string {
  return `${draft.sessionKey}:${draft.version.draftId}:${draft.version.revision}`;
}

/** Stores one pending save BEFORE the call goes out, so a crash leaves it to be retried. */
export function queueDraftSave(draft: PendingDraft, nowMs: number): Promise<void> {
  return writeRecord(key('draftOutbox', outboxSuffix(draft)), JSON.stringify(draft), nowMs);
}

/** The pending saves of one session, oldest first. */
export async function pendingDraftSaves(sessionKey: string, nowMs: number): Promise<PendingDraft[]> {
  const rows = await scanRecords('draftOutbox', `${sessionKey}:`, nowMs);
  const drafts: PendingDraft[] = [];
  for (const [, raw] of rows) {
    try {
      const draft = JSON.parse(raw) as PendingDraft;
      if (draft.sessionKey === sessionKey && versionOf(draft.version) !== null && typeof draft.content === 'string') {
        drafts.push(draft);
      }
    } catch {
      // An unreadable row is not a save.
    }
  }
  drafts.sort((left, right) => left.updatedAt - right.updatedAt);
  return drafts;
}

/** Retires every pending save of the same draft at or below the acknowledged revision. */
export async function acknowledgeDraftSaves(sessionKey: string, version: DraftVersion, nowMs: number): Promise<void> {
  for (const draft of await pendingDraftSaves(sessionKey, nowMs)) {
    if (draft.version.draftId !== version.draftId || draft.version.revision > version.revision) continue;
    await writeRecord(key('draftOutbox', outboxSuffix(draft)), null, nowMs);
  }
}

/** The retry ladder: 1s doubling to 30s. */
export function draftRetryDelayMs(failures: number): number {
  return Math.min(30_000, 1_000 * 2 ** Math.min(failures, 5));
}
