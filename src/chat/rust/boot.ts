/**
 * `readComposerBoot`: the one read the core waits for before it publishes anything. Port of the
 * desktop host's `apps/desktop/src/app/gx_chat/boot.rs`, key for key.
 */

import type { ChatStorageKey } from './events';
import { decodeStoredDraft, nextDraftVersion, type StoredDraft } from './host-records';
import { readRecords, scanRecords, writeRecord } from './storage';
import { useSettingsStore } from '../../settings/store';

/** `ComposerBootRead` in `packages/gx-chat-core/src/event.rs`. */
export type ComposerBootRead = {
  sessionKey: string;
  clientId: string;
  entry: Record<string, unknown>;
  nextVersion: { draftId: string; revision: number };
  optionStates: Record<string, unknown>;
  modelOutboxes: Record<string, unknown>;
  modelCatalog: unknown;
  chatSettings: {
    hideAccountEmails: boolean;
    title: string | null;
    toolCards: boolean;
    detailedDefault: boolean;
    statusLineFromComputer: boolean;
  };
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
  simpleOverride: boolean | null;
  /** The chat's own Quiet View choice (gx-chat-core `transcript/quiet_view.rs`). */
  quietView: boolean | null;
  /** When each view record was picked and whether the computer has it (`transcript/view_sync.rs`). */
  viewSync: unknown;
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

/**
 * Each agent's status line as it was drawn before 2026-11-09, when an unsaved record meant these
 * pins (`recommended_preferences` in `packages/gx-chat-core/src/menus/context/preferences.rs`;
 * keep the two in step): the popover rows that differ from a row's own recommendation, and the pins.
 */
const RECOMMENDED_STATUS_LINES: Record<string, { shown: Record<string, boolean>; starred: string[] }> = {
  claudeContext: {
    shown: { fiveHourReset: false },
    starred: ['accountName', 'modelLimit', 'fiveHourLimit', 'sevenDayLimit', 'repo'],
  },
  codexContext: {
    shown: { fiveHourLimit: false, fiveHourReset: false, sevenDayReset: true, accountEmail: true },
    starred: ['accountEmail', 'sevenDayLimit', 'sevenDayReset', 'accountResets'],
  },
  cursorContext: {
    shown: { thinking: false, contextUsed: true, contextTokens: true, totalOutputTokens: true, pr: true },
    starred: ['contextUsed', 'branch', 'lines'],
  },
  hermesContext: { shown: {}, starred: ['contextUsed', 'costUsd', 'tokens', 'sessionTime'] },
  piContext: { shown: {}, starred: ['model', 'contextUsed', 'costUsd', 'tokens'] },
  basicContext: { shown: {}, starred: ['repo', 'branch'] },
};

/**
 * Writes each agent's recommended status line into a record that was never saved, once, for a
 * person who already used the chat, so the new default that pins nothing never takes their line
 * away. Twin of `keep_status_line_for_existing_users` in the desktop's
 * `apps/desktop/src/app/gx_chat/boot.rs`: someone who used the chat before has this phone's chat
 * client id, a new install has none yet and gets the empty default, and the `statusLineDefault`
 * record says this ran. A refused read or write leaves the marker unwritten so the next boot tries
 * again, and a record the person saved is never overwritten.
 */
async function keepStatusLineForExistingUsers(nowMs: number, reads: BootReads): Promise<void> {
  const stores = Object.keys(RECOMMENDED_STATUS_LINES);
  const keys: ChatStorageKey[] = [
    { store: 'statusLineDefault', suffix: '' },
    { store: 'chatClient', suffix: '' },
    ...stores.map((store) => ({ store, suffix: '' })),
  ];
  reads.attempts += keys.length;
  let raws: (string | null)[];
  try {
    raws = await readRecords(keys, nowMs);
  } catch {
    reads.errors += keys.length;
    return;
  }
  const [marker, client, ...records] = raws.map((raw) => (raw === null || raw.length === 0 ? null : raw));
  if (marker !== null) return;
  const existing = client !== null;
  try {
    if (existing) {
      for (const [index, store] of stores.entries()) {
        if (records[index] !== null) continue;
        const { shown, starred } = RECOMMENDED_STATUS_LINES[store];
        const record = {
          shown,
          starred: Object.fromEntries(starred.map((id) => [id, true])),
          order: {},
          starredOrder: starred,
        };
        await writeRecord({ store, suffix: '' }, JSON.stringify(record), nowMs);
      }
    }
    await writeRecord({ store: 'statusLineDefault', suffix: '' }, existing ? 'kept' : 'new', nowMs);
  } catch {
    reads.errors += 1;
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
async function scoped(
  store: string,
  sessionKey: string,
  nowMs: number,
  reads: BootReads,
): Promise<Record<string, unknown>> {
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
  await keepStatusLineForExistingUsers(nowMs, reads);
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
        { store: 'simple', suffix: sessionKey },
        { store: 'quietView', suffix: sessionKey },
        { store: 'viewSync', suffix: sessionKey },
      ],
      nowMs,
      reads,
    ),
    scoped('sessionOptions', sessionKey, nowMs, reads),
    scoped('modelOutbox', sessionKey, nowMs, reads),
  ]);
  const [
    storedClientId,
    storedRaw,
    catalogRaw,
    claudeRaw,
    codexRaw,
    cursorRaw,
    hermesRaw,
    piRaw,
    basicRaw,
    noticeRaw,
    summaryRaw,
    verboseRaw,
    simpleRaw,
    quietViewRaw,
    viewSyncRaw,
  ] = records;
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
  // The chat's Normal or Detailed record (gx-chat-core `transcript/view_level.rs`), the same
  // encoding as `verbose`.
  const simpleOverride = decodeVerbose(simpleRaw);
  const quietView = decodeVerbose(quietViewRaw);
  const viewSync = parse(viewSyncRaw);
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
    // Tool call lines (`chatToolCallLines`) is the phone's own switch, which draws the tool call
    // card as one quiet line. Tool call cards is retired (gx-chat-core chat_look.rs, 2026-11-13).
    chatSettings: {
      hideAccountEmails: false,
      title: null,
      toolCards: useSettingsStore.getState().settings.chatToolCallLines,
      detailedDefault: useSettingsStore.getState().settings.sessionChatDetailedView,
      // The status line under the chat box is the one the chat's computer shows, which its reads
      // carry; this phone's own pins stay for a computer that sends none (gx-chat-core
      // `menus/context/computer_pins.rs`, CDXC:SessionChat 2026-11-12).
      statusLineFromComputer: true,
    },
    contextPreferences: { claude, codex, cursor, hermes, pi, basic },
    dismissedNotice,
    summaryMode,
    verboseOverride,
    simpleOverride,
    quietView,
    viewSync,
  };
}
