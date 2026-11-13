/**
 * In-app event log behind the sessions-screen status line: timestamped status and connection events (transient
 * statuses, per-computer connect/fail transitions and their reasons, refused channels, checks, Tailscale state
 * changes). Tapping the status line opens the logs sheet over this store; Copy, Export and Send to developer take it.
 *
 * CDXC:RemoteMachines 2026-11-13 WHY: a connection that drops about once a minute on one person's phone could not be
 * reproduced anywhere else, and the 300 lines held in memory were gone with the app. The log now keeps 2,000 lines
 * across restarts (bounded in entries and bytes), and Logs can export it as a file.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

export type AppLogEntry = {
  /** Epoch milliseconds when the event was recorded. */
  at: number;
  message: string;
  /** How many times the same line came in a row (absent means once); `at` is the first, `lastAt` the latest. */
  repeats?: number;
  lastAt?: number;
};

const MAX_ENTRIES = 2_000;
/** What the stored copy may take, about 400 KB of text; the oldest lines go first. */
const MAX_STORED_CHARS = 400_000;
const STORAGE_KEY = 'app.log.v1';
const SAVE_DELAY_MS = 2_000;
/** One event's longest text: an oversized error is cut, never allowed to push the whole log out. */
const MAX_MESSAGE_CHARS = 4_000;

type AppLogState = {
  entries: AppLogEntry[];
};

export const useAppLogStore = create<AppLogState>()(() => ({ entries: [] }));

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let hydrated = false;

function bounded(entries: AppLogEntry[]): AppLogEntry[] {
  let kept = entries.length > MAX_ENTRIES ? entries.slice(-MAX_ENTRIES) : entries;
  let chars = 0;
  for (let index = kept.length - 1; index >= 0; index -= 1) {
    chars += kept[index]!.message.length + 16;
    if (chars > MAX_STORED_CHARS) {
      kept = kept.slice(index + 1);
      break;
    }
  }
  return kept;
}

let storedScrubber: ((text: string) => string) | null = null;
/**
 * Each entry's stored text, fixed at its first save: scrubbed with the names known then, so a later rename or
 * removal (whose old name the scrubber no longer knows) never writes the original back.
 */
const storedText = new WeakMap<AppLogEntry, string>();

/**
 * Replaces personal details in the copy kept across restarts, with the names known when it is saved, so a computer
 * renamed or removed later still has its old name replaced there. Installed at startup (src/app/lifecycle.ts) to keep
 * this module free of the machine store.
 */
export function setStoredLogScrubber(scrub: (text: string) => string): void {
  storedScrubber = scrub;
}

function scheduleSave(): void {
  if (!hydrated || saveTimer !== null) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const scrub = storedScrubber;
    const entries = useAppLogStore.getState().entries.map((entry) => {
      let message = storedText.get(entry);
      if (message === undefined) {
        message = scrub === null ? entry.message : scrub(entry.message);
        if (scrub !== null) storedText.set(entry, message);
      }
      return entry.repeats === undefined
        ? { at: entry.at, message }
        : { at: entry.at, message, repeats: entry.repeats, lastAt: entry.lastAt };
    });
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(entries)).catch(() => undefined);
  }, SAVE_DELAY_MS);
}

export function logAppEvent(message: string): void {
  const whole = message.trim();
  if (whole.length === 0) return;
  const trimmed = whole.length > MAX_MESSAGE_CHARS ? `${whole.slice(0, MAX_MESSAGE_CHARS)}… (cut)` : whole;
  const now = Date.now();
  const entries = useAppLogStore.getState().entries;
  const last = entries[entries.length - 1];
  /**
   * CDXC:RemoteMachines 2026-11-13 WHY: a minute's channel snapshot or a quiet chat's check repeats the same line for
   * hours; the same line in a row becomes one with a count ("×N") so the kept 2,000 lines still cover a long day.
   */
  if (last !== undefined && last.message === trimmed) {
    const repeated: AppLogEntry = { at: last.at, message: last.message, repeats: (last.repeats ?? 1) + 1, lastAt: now };
    const kept = storedText.get(last);
    if (kept !== undefined) storedText.set(repeated, kept);
    useAppLogStore.setState({ entries: [...entries.slice(0, -1), repeated] });
    scheduleSave();
    return;
  }
  const entry: AppLogEntry = { at: now, message: trimmed };
  // Scrubbed for the kept copy now, with the names known as it is logged: a rename before the save can't leak it.
  const scrub = storedScrubber;
  if (scrub !== null) storedText.set(entry, scrub(trimmed));
  useAppLogStore.setState((state) => ({ entries: bounded([...state.entries, entry]) }));
  scheduleSave();
}

/** Reads the log kept by earlier runs in front of what this run logged so far; once per run. */
export async function hydrateAppLog(): Promise<void> {
  if (hydrated) return;
  let stored: AppLogEntry[] = [];
  try {
    const text = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed: unknown = text === null ? [] : JSON.parse(text);
    if (Array.isArray(parsed)) {
      stored = parsed.filter(
        (entry): entry is AppLogEntry =>
          typeof entry === 'object' &&
          entry !== null &&
          typeof (entry as AppLogEntry).at === 'number' &&
          typeof (entry as AppLogEntry).message === 'string' &&
          ((entry as AppLogEntry).repeats === undefined || typeof (entry as AppLogEntry).repeats === 'number') &&
          ((entry as AppLogEntry).lastAt === undefined || typeof (entry as AppLogEntry).lastAt === 'number'),
      );
    }
  } catch {
    // An unreadable copy starts the log over.
  }
  hydrated = true;
  // What earlier runs kept is already scrubbed.
  for (const entry of stored) storedText.set(entry, entry.message);
  useAppLogStore.setState((state) => ({ entries: bounded([...stored, ...state.entries]) }));
  scheduleSave();
}

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** "14:03:22" local wall-clock stamp shown next to each log line. */
export function formatLogTime(at: number): string {
  const date = new Date(at);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** An entry's text with its count: "… (×12, last 14:09:22)". */
export function logEntryText(entry: AppLogEntry): string {
  if (entry.repeats === undefined || entry.repeats < 2) return entry.message;
  return `${entry.message} (×${entry.repeats}${entry.lastAt === undefined ? '' : `, last ${formatLogTime(entry.lastAt)}`})`;
}

/** Full plain-text export for the clipboard, one "YYYY-MM-DD HH:MM:SS message" per line: the kept log spans days. */
export function formatAppLog(entries: AppLogEntry[]): string {
  return entries.map((entry) => `${formatLogDateTime(entry.at)} ${logEntryText(entry)}`).join('\n');
}

/** "2026-11-13 14:03:22", the export's stamp: the kept log spans days. */
export function formatLogDateTime(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${formatLogTime(at)}`;
}
