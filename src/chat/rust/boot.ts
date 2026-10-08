/**
 * `readComposerBoot`: the one read the core waits for before it publishes anything. Port of the
 * desktop host's `apps/desktop/src/app/gx_chat/boot.rs`, key for key.
 */

import type { ChatStorageKey } from './events';
import { decodeStoredDraft, nextDraftVersion, type StoredDraft } from './host-records';
import { readRecords, scanRecords, writeRecord } from './storage';

/** `ComposerBootRead` in `packages/gx-chat-core/src/event.rs`. */
export type ComposerBootRead = {
  sessionKey: string;
  clientId: string;
  entry: Record<string, unknown>;
  nextVersion: { draftId: string; revision: number };
  optionStates: Record<string, unknown>;
  modelOutboxes: Record<string, unknown>;
  modelCatalog: unknown;
  chatSettings: { hideAccountEmails: boolean; title: string | null };
  contextPreferences: {
    claude: unknown;
    codex: unknown;
    cursor: unknown;
    hermes: unknown;
    pi: unknown;
    basic: unknown;
  };
  dismissedNotice: unknown;
  summaryMode: boolean;
  verboseOverride: boolean | null;
};

/** Reads that refused, and reads attempted: all refused means storage itself is unavailable. */
type BootReads = { attempts: number; errors: number };

/** Every key in one batched read; each key counts as one attempt, and all of them fail together. */
async function loadAll(keys: readonly ChatStorageKey[], nowMs: number, reads: BootReads): Promise<(string | null)[]> {
  reads.attempts += keys.length;
  try {
    const raws = await readRecords(keys, nowMs);
    return raws.map((raw) => (raw === null || raw.length === 0 ? null : raw));
  } catch {
    reads.errors += keys.length;
    return keys.map(() => null);
  }
}

function parse(raw: string | null): unknown {
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

/** `Number.prototype.toString(36)` of a random 53-bit value. */
function base36Random(): string {
  return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER).toString(36);
}

/** `sessionChatDraftClientId()`: this phone's persisted draft-origin id, minted on first sight. */
async function clientId(stored: string | null, nowMs: number, reads: BootReads): Promise<string> {
  if (stored !== null) return stored;
  const created = `gx-${base36Random()}${Math.max(0, nowMs).toString(36)}`;
  reads.attempts += 1;
  const record: ChatStorageKey = { store: 'chatClient', suffix: '' };
  await writeRecord(record, created, nowMs).catch(() => {
    reads.errors += 1;
  });
  return created;
}

/**
 * `{...stored, version}`: a stored revision is reused only when the entry is neither submitted nor
 * parked (a parked draft went to the terminal, so the composer opens empty on a fresh draft).
 */
function entryWithVersion(stored: StoredDraft | null): Record<string, unknown> {
  const reuse = stored !== null && !stored.submitted && !stored.parked ? stored.version : undefined;
  const version = reuse ?? nextDraftVersion();
  if (stored === null) return { version };
  return {
    text: stored.text,
    ...(stored.updatedAt !== undefined ? { updatedAt: stored.updatedAt } : {}),
    submitted: stored.submitted,
    parked: stored.parked,
    version,
  };
}

/** `{ "<sessionKey>[#<scope>]": value }` for every stored record of this session. */
async function scoped(store: string, sessionKey: string, nowMs: number, reads: BootReads): Promise<Record<string, unknown>> {
  reads.attempts += 1;
  let rows: [string, string][];
  try {
    rows = await scanRecords(store, sessionKey, nowMs);
  } catch {
    reads.errors += 1;
    return {};
  }
  const states: Record<string, unknown> = {};
  for (const [suffix, raw] of rows) {
    // A prefix scan also returns sibling sessions (`p:s` against `p:s2`).
    if (suffix !== sessionKey && !suffix.startsWith(`${sessionKey}#`)) continue;
    const value = parse(raw);
    if (value !== null) states[suffix] = value;
  }
  return states;
}

/** `decodeSummary`: `"1"` is on. */
function decodeSummary(raw: string | null): boolean {
  return raw === '1';
}

/** `decodeVerbose`: `"1"` on, `"0"` off, anything else follows the setting. */
function decodeVerbose(raw: string | null): boolean | null {
  if (raw === '1') return true;
  if (raw === '0') return false;
  return null;
}

/**
 * Everything the chat reads at boot, or `null` when storage answered none of it (the core then
 * draws its `{status: 'error'}` document, as desktop's `ComposerBootFailed` arm does).
 */
export async function readComposerBoot(sessionKey: string, nowMs: number): Promise<ComposerBootRead | null> {
  const reads: BootReads = { attempts: 0, errors: 0 };
  // One multiGet for the records and the two prefix scans beside it, instead of thirteen reads
  // one after another: the cached transcript cannot paint before this read answers.
  const [records, optionStates, modelOutboxes] = await Promise.all([
    loadAll(
      [
        { store: 'chatClient', suffix: '' },
        { store: 'drafts', suffix: sessionKey },
        { store: 'modelCatalog', suffix: '' },
        { store: 'claudeContext', suffix: '' },
        { store: 'codexContext', suffix: '' },
        { store: 'cursorContext', suffix: '' },
        { store: 'hermesContext', suffix: '' },
        { store: 'piContext', suffix: '' },
        { store: 'basicContext', suffix: '' },
        { store: 'notices', suffix: sessionKey },
        { store: 'summary', suffix: sessionKey },
        { store: 'verbose', suffix: sessionKey },
      ],
      nowMs,
      reads
    ),
    scoped('sessionOptions', sessionKey, nowMs, reads),
    scoped('modelOutbox', sessionKey, nowMs, reads),
  ]);
  const [storedClientId, storedRaw, catalogRaw, claudeRaw, codexRaw, cursorRaw, hermesRaw, piRaw, basicRaw, noticeRaw, summaryRaw, verboseRaw] =
    records;
  const id = await clientId(storedClientId, nowMs, reads);
  const entry = entryWithVersion(storedRaw === null ? null : decodeStoredDraft(storedRaw));
  const modelCatalog = parse(catalogRaw);
  const claude = parse(claudeRaw);
  const codex = parse(codexRaw);
  const cursor = parse(cursorRaw);
  const hermes = parse(hermesRaw);
  const pi = parse(piRaw);
  const basic = parse(basicRaw);
  const dismissedNotice = parse(noticeRaw);
  const summaryMode = decodeSummary(summaryRaw);
  const verboseOverride = decodeVerbose(verboseRaw);
  if (reads.attempts > 0 && reads.errors === reads.attempts) return null;
  return {
    sessionKey,
    clientId: id,
    entry,
    nextVersion: nextDraftVersion(),
    optionStates,
    modelOutboxes,
    modelCatalog,
    // CDXC:Mobile 2026-09-24 WHY:
    // The phone has no "Hide account emails" setting and no session title lookup, which is the
    // same pair of answers the desktop brain reached through its boot read before that setting
    // existed; both stay the boot read's so a future phone setting lands in one place.
    chatSettings: { hideAccountEmails: false, title: null },
    contextPreferences: { claude, codex, cursor, hermes, pi, basic },
    dismissedNotice,
    summaryMode,
    verboseOverride,
  };
}
