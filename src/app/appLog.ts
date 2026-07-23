/**
 * In-app event log behind the sessions-screen status line: a small ring buffer
 * of timestamped status/connection events (transient statuses, per-machine
 * connect/fail transitions, Tailscale state changes). Tapping the status line
 * opens the logs sheet over this store; Copy exports the formatted lines.
 */

import { create } from 'zustand';

export type AppLogEntry = {
  /** Epoch milliseconds when the event was recorded. */
  at: number;
  message: string;
};

const MAX_ENTRIES = 300;

type AppLogState = {
  entries: AppLogEntry[];
};

export const useAppLogStore = create<AppLogState>()(() => ({ entries: [] }));

export function logAppEvent(message: string): void {
  const trimmed = message.trim();
  if (trimmed.length === 0) return;
  useAppLogStore.setState((state) => {
    const entries = [...state.entries, { at: Date.now(), message: trimmed }];
    return { entries: entries.length > MAX_ENTRIES ? entries.slice(-MAX_ENTRIES) : entries };
  });
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
