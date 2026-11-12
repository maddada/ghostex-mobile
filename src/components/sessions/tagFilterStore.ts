/**
 * The Project list's tag filter (the desktop's Sort & Filter "Show only sessions tagged"): the tags whose sessions it
 * keeps, kept on this phone as the desktop keeps it per window. The tags offered come from the synced Session Tags
 * list (contract/sessionTagList.ts `enabledVisibleTagFilters`); a pick the list no longer offers is dropped.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const STORAGE_KEY = 'sessions.tagFilters';

type TagFilterState = {
  filters: string[];
  hydrate: () => Promise<void>;
  toggle: (filter: string) => void;
  clear: () => void;
};

export const useTagFilterStore = create<TagFilterState>()((set, get) => {
  const save = (filters: string[]) => {
    set({ filters });
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(filters)).catch(() => undefined);
  };
  return {
    filters: [],
    hydrate: async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        const parsed: unknown = raw === null ? [] : JSON.parse(raw);
        if (Array.isArray(parsed)) set({ filters: parsed.filter((item): item is string => typeof item === 'string') });
      } catch {
        // No saved filter: every session shows.
      }
    },
    toggle: (filter) => {
      const filters = get().filters;
      save(filters.includes(filter) ? filters.filter((item) => item !== filter) : [...filters, filter]);
    },
    clear: () => save([]),
  };
});
