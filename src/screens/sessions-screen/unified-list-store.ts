/**
 * The Unified list's own state on this phone: the filter, which shelves are open and which project
 * groups are folded, kept across restarts; what is typed in the search field, only while it runs.
 *
 * CDXC:Sidebar 2026-10-31 DECISION:
 * User (Q855, "remember both"; Q856, the phone in the same build): gx-core `unified_sidebar/saved.rs` on the phone's own storage, so each device keeps its own view.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { EMPTY_UNIFIED_FILTER, type UnifiedFilter, type UnifiedShelf } from '../../contract/unified/build';
import {
  parseUnifiedSaved,
  serializeUnifiedSaved,
  UNIFIED_SAVED_STATE_KEY,
} from '../../contract/unified/saved';

type UnifiedListState = {
  filter: UnifiedFilter;
  /** Shelves toggled away from how they start; inside a project as `<repo key>|<shelf>`. */
  toggledShelves: string[];
  foldedGroups: string[];
  /** The machine a new session last used per repository (the tray's machine chips). */
  lastMachines: Record<string, string>;
  hydrated: boolean;
  hydrate: () => void;
  setFilter: (filter: UnifiedFilter) => void;
  setQuery: (query: string) => void;
  toggleShelf: (key: string) => void;
  toggleGroup: (repoKey: string) => void;
  noteLastMachine: (repoKey: string, machineId: string) => void;
};

export const useUnifiedListStore = create<UnifiedListState>((set, get) => {
  const save = (): void => {
    const { filter, toggledShelves, foldedGroups, lastMachines } = get();
    void AsyncStorage.setItem(
      UNIFIED_SAVED_STATE_KEY,
      serializeUnifiedSaved({ filter, toggledShelves, foldedGroups, lastMachines }),
    );
  };
  const flip = (list: string[], key: string): string[] =>
    list.includes(key) ? list.filter((entry) => entry !== key) : [...list, key];
  return {
    filter: EMPTY_UNIFIED_FILTER,
    toggledShelves: [],
    foldedGroups: [],
    lastMachines: {},
    hydrated: false,
    hydrate: () => {
      if (get().hydrated) return;
      set({ hydrated: true });
      void AsyncStorage.getItem(UNIFIED_SAVED_STATE_KEY).then((raw) => {
        const saved = parseUnifiedSaved(raw);
        set((state) => ({
          filter: { ...saved.filter, query: state.filter.query ?? '' },
          toggledShelves: saved.toggledShelves,
          foldedGroups: saved.foldedGroups,
          lastMachines: saved.lastMachines,
        }));
      });
    },
    setFilter: (filter) => {
      set((state) => ({ filter: { ...filter, query: state.filter.query ?? '' } }));
      save();
    },
    setQuery: (query) => set((state) => ({ filter: { ...state.filter, query } })),
    toggleShelf: (key) => {
      set((state) => ({ toggledShelves: flip(state.toggledShelves, key) }));
      save();
    },
    toggleGroup: (repoKey) => {
      set((state) => ({ foldedGroups: flip(state.foldedGroups, repoKey) }));
      save();
    },
    noteLastMachine: (repoKey, machineId) => {
      set((state) => ({ lastMachines: { ...state.lastMachines, [repoKey]: machineId } }));
      save();
    },
  };
});

export function shelfOpen(shelf: UnifiedShelf, toggled: readonly string[], repoKey: string | null = null): boolean {
  const key = repoKey === null ? shelf : `${repoKey}|${shelf}`;
  return toggled.includes(key) !== (shelf === 'drafts');
}
