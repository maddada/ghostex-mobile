/**
 * The synced values the phone applies, published by settingsSync.ts after every load, exchange and edit: each
 * entry's value by key (deleted entries left out), who wrote it, and which categories each computer synced at its
 * last exchange. Its own module, with no imports from the app, so the inventory store can read it without a cycle.
 */

import { create } from 'zustand';

export type SyncedEntriesState = {
  loaded: boolean;
  values: Record<string, unknown>;
  origins: Record<string, string>;
  categoriesByMachine: Record<string, string[]>;
};

export const useSyncedEntriesStore = create<SyncedEntriesState>(() => ({
  loaded: false,
  values: {},
  origins: {},
  categoriesByMachine: {},
}));
