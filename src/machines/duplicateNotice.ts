/**
 * What the Machines list tells the user once about older entries for a computer that the phone
 * hid or merged (machines/duplicateComputers.ts hides, the start-up heal in store.ts merges).
 *
 * CDXC:RemotePairing 2026-11-11 WHY:
 * Review of the first version (finding 2): the hide and the merge were silent, only the app log
 * said so, and a user who saw an entry turn Hidden or vanish had no way to know why. The kept
 * entry's Machines card now says it in one calm line, in the card's own muted detail style, the
 * first time the list is shown after it happened; leaving the list clears it. The app log lines
 * stay. A notice is keyed by the entry kept, which the start-up merge never renames.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export const DUPLICATE_NOTICES_STORAGE_KEY = 'machines.duplicateNotices.v1';

export type DuplicateNotice = {
  /** `hidden`: older entries are hidden and go at the next start; `merged`: they are gone. */
  kind: 'hidden' | 'merged';
  /** The older entries (their ids, which are gone after a merge; only their number is shown). */
  ids: string[];
};

type DuplicateNotices = Record<string, DuplicateNotice>;

function parse(raw: string | null): DuplicateNotices {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const notices: DuplicateNotices = {};
    for (const [machineId, value] of Object.entries(parsed)) {
      const { kind, ids } = (value ?? {}) as { kind?: unknown; ids?: unknown };
      const list = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
      if ((kind === 'hidden' || kind === 'merged') && list.length > 0) notices[machineId] = { kind, ids: list };
    }
    return notices;
  } catch {
    return {};
  }
}

type DuplicateNoticeState = {
  notices: DuplicateNotices;
  hydrated: boolean;
};

export const useDuplicateNoticeStore = create<DuplicateNoticeState>()(() => ({ notices: {}, hydrated: false }));

let writes: Promise<unknown> = Promise.resolve();

/** One change at a time, read from storage so a change made before the store was read is kept. */
function change(update: (notices: DuplicateNotices) => DuplicateNotices): Promise<void> {
  const next = writes.then(async () => {
    const stored = parse(await AsyncStorage.getItem(DUPLICATE_NOTICES_STORAGE_KEY));
    const notices = update(stored);
    await AsyncStorage.setItem(DUPLICATE_NOTICES_STORAGE_KEY, JSON.stringify(notices));
    useDuplicateNoticeStore.setState({ notices, hydrated: true });
  });
  writes = next.catch(() => undefined);
  return next.catch(() => undefined);
}

/** Reads the saved notices into the store (the Machines list calls it when it opens). */
export function hydrateDuplicateNotices(): Promise<void> {
  return change((notices) => notices);
}

/**
 * `keptId`'s older entries `ids` were hidden (`hidden`) or merged into it (`merged`). A notice of
 * the same kind for the same entry gains the new ones; one of the other kind is replaced.
 */
export function noteDuplicateEntries(keptId: string, kind: DuplicateNotice['kind'], ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return Promise.resolve();
  return change((notices) => {
    const before = notices[keptId];
    const kept = before !== undefined && before.kind === kind ? before.ids : [];
    return { ...notices, [keptId]: { kind, ids: [...new Set([...kept, ...ids])] } };
  });
}

/** The user saw these notices: they are not shown again. */
export function clearDuplicateNotices(machineIds: readonly string[]): Promise<void> {
  if (machineIds.length === 0) return Promise.resolve();
  return change((notices) => {
    const next = { ...notices };
    for (const machineId of machineIds) delete next[machineId];
    return next;
  });
}
