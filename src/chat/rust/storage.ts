/**
 * The Rust chat core's client storage on the phone: the catalog rows it names, kept in
 * AsyncStorage, and the retained transcripts, kept in files.
 *
 * The core names a store and a per-session suffix (`{store, suffix}`) and never builds a key. The
 * catalog below is the desktop host's (`apps/desktop/src/app/gx_chat/storage.rs`, which copies
 * `packages/client-storage/catalog.ts`): same store ids, same key
 * prefixes, same entry bounds. The phone's WebView chat kept its drafts in the page's own browser
 * storage, which the native side cannot read, so there is nothing to migrate; matching the keys is
 * what keeps one spelling of every record across hosts.
 *
 * CDXC:Mobile 2026-09-24 WHY:
 * The retained transcripts do NOT go into AsyncStorage. Each record may be 2 MiB and 24 are kept,
 * while Android's AsyncStorage database defaults to a 6 MB total, so a few long chats would start
 * refusing every other write (drafts included). They live as one file per chat under the app's
 * document directory instead, with the same 24-record and 7-day bounds.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';

import type { ChatStorageKey } from './events';

const KIB = 1024;
const MIB = 1024 * 1024;
const DAY_MS = 86_400_000;

type RecordBounds = {
  maxEntryBytes: number;
  /** Past this many rows the oldest-written is dropped on write; `null` never evicts. */
  maxEntries: number | null;
  /** Rows older than this read as absent; `null` never expire. */
  maxAgeMs: number | null;
};

type CatalogStore = {
  id: string;
  /** A prefix for a collection, the whole key for a singleton. */
  prefix: string;
  collection: boolean;
  /** `local` rows hold the raw string (64 KiB); `records` rows are wrapped with their write time. */
  backend: { kind: 'local' } | ({ kind: 'records' } & RecordBounds);
};

/** `disk` in the catalog: 2 MiB an entry, 2000 entries. */
function disk(maxAgeMs: number | null = null): CatalogStore['backend'] {
  return { kind: 'records', maxEntryBytes: 2 * MIB, maxEntries: 2_000, maxAgeMs };
}

/** `protectedDisk` in the catalog: never evicted. */
function protectedDisk(): CatalogStore['backend'] {
  return { kind: 'records', maxEntryBytes: 2 * MIB, maxEntries: null, maxAgeMs: null };
}

const LOCAL: CatalogStore['backend'] = { kind: 'local' };

/** Every store the core or this host reads or writes, in the desktop catalog's order. */
const STORES: readonly CatalogStore[] = [
  { id: 'verbose', prefix: 'ghostex.sessionChat.verbose.', collection: true, backend: disk() },
  { id: 'summary', prefix: 'ghostex.sessionChat.summary.', collection: true, backend: disk() },
  { id: 'tasksCollapsed', prefix: 'ghostex.chat.agentTasks.collapsed', collection: false, backend: LOCAL },
  { id: 'claudeContext', prefix: 'ghostex.chat.context-details.v1', collection: false, backend: LOCAL },
  { id: 'codexContext', prefix: 'ghostex.chat.context-details.codex.v1', collection: false, backend: LOCAL },
  { id: 'cursorContext', prefix: 'ghostex.chat.context-details.cursor.v1', collection: false, backend: LOCAL },
  { id: 'basicContext', prefix: 'ghostex.chat.context-details.basic.v1', collection: false, backend: LOCAL },
  { id: 'notices', prefix: 'ghostex.sessionChat.noticeDismissed.', collection: true, backend: disk() },
  { id: 'sessionOptions', prefix: 'ghostex.sessionChat.options.', collection: true, backend: disk(30 * DAY_MS) },
  { id: 'modelFavorites', prefix: 'ghostex.model-favorites', collection: false, backend: LOCAL },
  {
    id: 'modelCatalog',
    prefix: 'ghostex.agentModelCatalog.v1',
    collection: false,
    backend: { kind: 'records', maxEntryBytes: 2 * MIB, maxEntries: 1, maxAgeMs: 30 * DAY_MS },
  },
  { id: 'modelOutbox', prefix: 'ghostex.model-selection-outbox.', collection: true, backend: protectedDisk() },
  { id: 'retiredQuestions', prefix: 'ghostex:async-questions:', collection: true, backend: protectedDisk() },
  { id: 'questionDrafts', prefix: 'ghostex.sessionChat.questionDraft.', collection: true, backend: protectedDisk() },
  { id: 'chatClient', prefix: 'ghostex.sessionChat.clientId', collection: false, backend: LOCAL },
  { id: 'returnedPrompts', prefix: 'ghostex.sessionChat.returnedPrompts.applied', collection: false, backend: LOCAL },
  { id: 'drafts', prefix: 'ghostex.sessionChat.draft.', collection: true, backend: protectedDisk() },
  { id: 'draftOutbox', prefix: 'ghostex.sessionChat.outbox.', collection: true, backend: protectedDisk() },
  {
    id: 'sentHistory',
    prefix: 'ghostex.sessionChat.sent.',
    collection: true,
    backend: { kind: 'records', maxEntryBytes: 2 * MIB, maxEntries: null, maxAgeMs: null },
  },
  { id: 'deliveryReceipts', prefix: 'ghostex.sessionChat.delivered.', collection: true, backend: protectedDisk() },
];

/** Why a read or write was refused. Short codes, never user data. */
export type StorageRefusal = 'unregistered' | 'entry' | 'write' | 'read';

export class StorageRefused extends Error {
  readonly code: StorageRefusal;
  constructor(code: StorageRefusal) {
    super(`Chat storage refused the record (${code}).`);
    this.code = code;
  }
}

function catalogStore(id: string): CatalogStore | undefined {
  return STORES.find((store) => store.id === id);
}

/** The full key a `{store, suffix}` names; refuses an unknown store or a suffix on a singleton. */
export function fullKey(key: ChatStorageKey): string {
  const store = catalogStore(key.store);
  if (store === undefined || (!store.collection && key.suffix.length > 0)) {
    throw new StorageRefused('unregistered');
  }
  return `${store.prefix}${key.suffix}`;
}

/** `packages/client-storage/budgets.ts`: UTF-16 accounting of key and value together. */
function storageBytes(key: string, raw: string): number {
  return 2 * (key.length + raw.length);
}

type Wrapped = { w: number; v: string };

function unwrap(stored: string | null, bounds: RecordBounds, nowMs: number): string | null {
  if (stored === null) return null;
  try {
    const parsed = JSON.parse(stored) as Partial<Wrapped>;
    if (typeof parsed.v !== 'string' || typeof parsed.w !== 'number') return null;
    if (bounds.maxAgeMs !== null && nowMs - parsed.w > bounds.maxAgeMs) return null;
    return parsed.v;
  } catch {
    return null;
  }
}

/** Reads one record; `null` when nothing (live) is stored. */
export async function readRecord(key: ChatStorageKey, nowMs: number): Promise<string | null> {
  const store = catalogStore(key.store);
  const name = fullKey(key);
  let stored: string | null;
  try {
    stored = await AsyncStorage.getItem(name);
  } catch {
    throw new StorageRefused('read');
  }
  if (store === undefined || store.backend.kind === 'local') return stored;
  return unwrap(stored, store.backend, nowMs);
}

/**
 * Writes one record, or deletes it when `value` is null. A value over the entry bound is REFUSED,
 * never truncated, the rule the desktop door keeps.
 */
export async function writeRecord(key: ChatStorageKey, value: string | null, nowMs: number): Promise<void> {
  const store = catalogStore(key.store);
  const name = fullKey(key);
  if (store === undefined) throw new StorageRefused('unregistered');
  try {
    if (value === null) {
      await AsyncStorage.removeItem(name);
      return;
    }
    if (store.backend.kind === 'local') {
      if (storageBytes(name, value) > 64 * KIB) throw new StorageRefused('entry');
      await AsyncStorage.setItem(name, value);
      return;
    }
    if (storageBytes(name, value) > store.backend.maxEntryBytes) throw new StorageRefused('entry');
    const wrapped: Wrapped = { w: nowMs, v: value };
    await AsyncStorage.setItem(name, JSON.stringify(wrapped));
    if (store.backend.maxEntries !== null && store.collection) {
      await evictOldest(store, store.backend.maxEntries);
    }
  } catch (error) {
    if (error instanceof StorageRefused) throw error;
    throw new StorageRefused('write');
  }
}

async function evictOldest(store: CatalogStore, maxEntries: number): Promise<void> {
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(store.prefix));
  if (keys.length <= maxEntries) return;
  const rows = await AsyncStorage.multiGet(keys);
  const stamped = rows.map(([key, raw]) => {
    let written = 0;
    try {
      written = (JSON.parse(raw ?? '{}') as Partial<Wrapped>).w ?? 0;
    } catch {
      written = 0;
    }
    return { key, written };
  });
  stamped.sort((left, right) => left.written - right.written);
  await AsyncStorage.multiRemove(stamped.slice(0, stamped.length - maxEntries).map((row) => row.key));
}

/**
 * Every live record of a collection store whose SUFFIX starts with `suffixPrefix`, as
 * `[suffix, raw]` pairs (what the TypeScript calls the key with the store prefix taken off).
 */
export async function scanRecords(storeId: string, suffixPrefix: string, nowMs: number): Promise<[string, string][]> {
  const store = catalogStore(storeId);
  if (store === undefined) throw new StorageRefused('unregistered');
  if (!store.collection) return [];
  const prefix = `${store.prefix}${suffixPrefix}`;
  let rows: readonly (readonly [string, string | null])[];
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(prefix));
    rows = await AsyncStorage.multiGet(keys);
  } catch {
    throw new StorageRefused('read');
  }
  const out: [string, string][] = [];
  for (const [key, stored] of rows) {
    const raw = store.backend.kind === 'local' ? stored : unwrap(stored, store.backend, nowMs);
    if (raw !== null) out.push([key.slice(store.prefix.length), raw]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Retained transcripts (`chatSnapshots`), one file per chat
// ---------------------------------------------------------------------------------------------

const SNAPSHOT_MAX_ENTRIES = 24;
const SNAPSHOT_MAX_AGE_MS = 7 * DAY_MS;

function snapshotDirectory(): Directory {
  const directory = new Directory(Paths.document, 'gx-chat-snapshots');
  if (!directory.exists) directory.create({ intermediates: true, idempotent: true });
  return directory;
}

/** FNV-1a over the retention key: a file name with no characters a file system could refuse. */
function snapshotFileName(retainedKey: string): string {
  let hash = 0x811c9dc5;
  let second = 0x01000193;
  for (let index = 0; index < retainedKey.length; index += 1) {
    const unit = retainedKey.charCodeAt(index);
    hash = Math.imul(hash ^ unit, 0x01000193) >>> 0;
    second = Math.imul(second ^ unit, 0x811c9dc5) >>> 0;
  }
  return `${hash.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}.json`;
}

function savedAtOf(raw: string | null): number | null {
  if (raw === null) return null;
  try {
    const savedAt = (JSON.parse(raw) as { savedAt?: unknown }).savedAt;
    return typeof savedAt === 'number' ? savedAt : null;
  } catch {
    return null;
  }
}

/** `readPersistedSessionChat`: this chat's retained transcript, or null. */
export async function readRetainedSnapshot(retainedKey: string, nowMs: number): Promise<string | null> {
  if (retainedKey.length === 0) return null;
  const file = new File(snapshotDirectory(), snapshotFileName(retainedKey));
  if (!file.exists) return null;
  const modified = file.modificationTime;
  if (typeof modified === 'number' && nowMs - modified > SNAPSHOT_MAX_AGE_MS) {
    file.delete();
    return null;
  }
  const raw = await file.text();
  // A hash collision is another chat's record, which must not be adopted.
  try {
    if ((JSON.parse(raw) as { key?: unknown }).key !== retainedKey) return null;
  } catch {
    return null;
  }
  return raw;
}

/**
 * `persistSessionChat`: write the record back, keeping the stored one when ITS `savedAt` is newer,
 * so two writers cannot roll the tail backwards. `null` deletes. Nothing answers this effect. The
 * 2 MiB record bound is the core's own (it asks for a delete instead of an oversized write).
 */
export async function writeRetainedSnapshot(retainedKey: string, value: string | null, nowMs: number): Promise<void> {
  if (retainedKey.length === 0) return;
  const directory = snapshotDirectory();
  const file = new File(directory, snapshotFileName(retainedKey));
  if (value === null) {
    if (file.exists) file.delete();
    return;
  }
  if (file.exists) {
    const stored = savedAtOf(await file.text());
    const incoming = savedAtOf(value);
    if (stored !== null && incoming !== null && stored > incoming) return;
  } else {
    file.create({ intermediates: true, overwrite: true });
  }
  file.write(value);
  pruneSnapshots(directory, nowMs);
}

function pruneSnapshots(directory: Directory, nowMs: number): void {
  const files = directory.list().filter((entry): entry is File => entry instanceof File);
  const dated = files.map((file) => ({ file, modified: file.modificationTime ?? 0 }));
  for (const entry of dated) {
    if (nowMs - entry.modified > SNAPSHOT_MAX_AGE_MS) entry.file.delete();
  }
  const live = dated.filter((entry) => nowMs - entry.modified <= SNAPSHOT_MAX_AGE_MS);
  if (live.length <= SNAPSHOT_MAX_ENTRIES) return;
  live.sort((left, right) => left.modified - right.modified);
  for (const entry of live.slice(0, live.length - SNAPSHOT_MAX_ENTRIES)) entry.file.delete();
}
