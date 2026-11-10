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
import { widenFilterForNewSession } from '../../contract/unified/choices';
import {
  parseUnifiedSaved,
  rememberNewSession,
  serializeUnifiedSaved,
  UNIFIED_SAVED_STATE_KEY,
} from '../../contract/unified/saved';

type UnifiedListState = {
  filter: UnifiedFilter;
  /** Shelves toggled away from how they start; inside a project as `<repo key>|<shelf>`. */
  toggledShelves: string[];
  foldedGroups: string[];
  /** The machine a new session last used per repository (the agent menu and tray start there). */
  lastMachines: Record<string, string>;
  /** The repositories new sessions last started in, newest first: the project list's Recent. */
  recentRepos: string[];
  /** Coordinators whose threads are shown, and whose older threads are listed (contract/unified/tree.ts). */
  unfoldedCoordinators: string[];
  olderShownCoordinators: string[];
  hydrated: boolean;
  hydrate: () => void;
  setFilter: (filter: UnifiedFilter) => void;
  setQuery: (query: string) => void;
  toggleShelf: (key: string) => void;
  /** Opens the Drafts shelf for a session that just arrived there (gx-core draft_arrivals.rs). */
  openDrafts: () => void;
  toggleGroup: (repoKey: string) => void;
  /** The crew count's tap: folds or unfolds a coordinator's threads. */
  toggleCoordinator: (key: string) => void;
  /** The "N older threads" row's tap. */
  toggleOlderThreads: (key: string) => void;
  /** Opening a thread unfolds the coordinators above it, and lists the older threads it waits behind. */
  revealThread: (ancestors: readonly string[], listOlderOf: string | null) => void;
  noteLastMachine: (repoKey: string, machineId: string) => void;
  /**
   * A session started in `repoKey` on `machineId` (gx-core `remember_new_session` and
   * `widen_filter_for_new_session`): it becomes that repository's machine and the top of Recent,
   * and a filter that would hide it gains its project, machine or Space as chips.
   */
  noteNewSession: (repoKey: string, machineId: string, spaceKey: string | null) => void;
};

export const useUnifiedListStore = create<UnifiedListState>((set, get) => {
  const save = (): void => {
    const { filter, toggledShelves, foldedGroups, lastMachines, recentRepos, unfoldedCoordinators, olderShownCoordinators } =
      get();
    void AsyncStorage.setItem(
      UNIFIED_SAVED_STATE_KEY,
      serializeUnifiedSaved({
        filter,
        toggledShelves,
        foldedGroups,
        lastMachines,
        recentRepos,
        unfoldedCoordinators,
        olderShownCoordinators,
      }),
    );
  };
  const flip = (list: string[], key: string): string[] =>
    list.includes(key) ? list.filter((entry) => entry !== key) : [...list, key];
  return {
    filter: EMPTY_UNIFIED_FILTER,
    toggledShelves: [],
    foldedGroups: [],
    lastMachines: {},
    recentRepos: [],
    unfoldedCoordinators: [],
    olderShownCoordinators: [],
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
          recentRepos: saved.recentRepos,
          unfoldedCoordinators: saved.unfoldedCoordinators,
          olderShownCoordinators: saved.olderShownCoordinators,
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
    openDrafts: () => {
      if (!get().toggledShelves.includes('drafts')) return;
      set((state) => ({ toggledShelves: state.toggledShelves.filter((key) => key !== 'drafts') }));
      save();
    },
    toggleGroup: (repoKey) => {
      set((state) => ({ foldedGroups: flip(state.foldedGroups, repoKey) }));
      save();
    },
    toggleCoordinator: (key) => {
      set((state) => ({ unfoldedCoordinators: flip(state.unfoldedCoordinators, key) }));
      save();
    },
    toggleOlderThreads: (key) => {
      set((state) => ({ olderShownCoordinators: flip(state.olderShownCoordinators, key) }));
      save();
    },
    revealThread: (ancestors, listOlderOf) => {
      const state = get();
      const unfold = ancestors.filter((key) => !state.unfoldedCoordinators.includes(key));
      const listOlder = listOlderOf !== null && !state.olderShownCoordinators.includes(listOlderOf);
      if (unfold.length === 0 && !listOlder) return;
      set({
        unfoldedCoordinators: [...state.unfoldedCoordinators, ...unfold],
        olderShownCoordinators: listOlder ? [...state.olderShownCoordinators, listOlderOf] : state.olderShownCoordinators,
      });
      save();
    },
    noteLastMachine: (repoKey, machineId) => {
      set((state) => ({ lastMachines: { ...state.lastMachines, [repoKey]: machineId } }));
      save();
    },
    noteNewSession: (repoKey, machineId, spaceKey) => {
      set((state) => ({
        ...rememberNewSession(state, repoKey, machineId),
        filter: widenFilterForNewSession(state.filter, repoKey, machineId, spaceKey),
      }));
      save();
    },
  };
});

export function shelfOpen(shelf: UnifiedShelf, toggled: readonly string[], repoKey: string | null = null): boolean {
  const key = repoKey === null ? shelf : `${repoKey}|${shelf}`;
  return toggled.includes(key) !== (shelf === 'drafts');
}
