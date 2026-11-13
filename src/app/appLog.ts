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
};

const MAX_ENTRIES = 2_000;
/** What the stored copy may take, about 400 KB of text; the oldest lines go first. */
const MAX_STORED_CHARS = 400_000;
const STORAGE_KEY = 'app.log.v1';
const SAVE_DELAY_MS = 2_000;

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

function scheduleSave(): void {
  if (!hydrated || saveTimer !== null) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(useAppLogStore.getState().entries)).catch(() => undefined);
  }, SAVE_DELAY_MS);
}

export function logAppEvent(message: string): void {
  const trimmed = message.trim();
  if (trimmed.length === 0) return;
  useAppLogStore.setState((state) => ({ entries: bounded([...state.entries, { at: Date.now(), message: trimmed }]) }));
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
          typeof (entry as AppLogEntry).message === 'string',
      );
    }
  } catch {
    // An unreadable copy starts the log over.
  }
  hydrated = true;
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

/** Full plain-text export for the clipboard, one "HH:MM:SS message" per line. */
export function formatAppLog(entries: AppLogEntry[]): string {
  return entries.map((entry) => `${formatLogTime(entry.at)} ${entry.message}`).join('\n');
}

/** "2026-11-13 14:03:22", the export's stamp: the kept log spans days. */
export function formatLogDateTime(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${formatLogTime(at)}`;
}
