/**
 * Selected Space per machine, persisted so the phone reopens on the Space the
 * user left it on. A machine with no stored selection — or one whose stored
 * Space the daemon has since deleted — resolves through
 * `resolveSelectedSpaceId`, so nothing here has to know the fallback rule.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const SELECTED_SPACE_STORAGE_KEY = 'spaces.selectedIdByMachine';

type SpacesState = {
  hydrated: boolean;
  /** Raw stored ids; a Space id or the reserved "other". */
  selectedSpaceIdByMachine: Record<string, string>;
  hydrate: () => Promise<void>;
  selectSpace: (machineId: string, spaceId: string) => void;
  /** Drop a removed machine's selection so the map cannot grow forever. */
  clearMachine: (machineId: string) => void;
};

function persistedRecord(raw: string | null): Record<string, string> {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const result: Record<string, string> = {};
    for (const [machineId, spaceId] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof spaceId === 'string' && spaceId.length > 0) result[machineId] = spaceId;
    }
    return result;
  } catch {
    return {};
  }
}

export const useSpacesStore = create<SpacesState>()((set, get) => ({
  hydrated: false,
  selectedSpaceIdByMachine: {},

  hydrate: async () => {
    if (get().hydrated) return;
    const raw = await AsyncStorage.getItem(SELECTED_SPACE_STORAGE_KEY);
    set({ hydrated: true, selectedSpaceIdByMachine: persistedRecord(raw) });
  },

  selectSpace: (machineId, spaceId) => {
    if (get().selectedSpaceIdByMachine[machineId] === spaceId) return;
    const next = { ...get().selectedSpaceIdByMachine, [machineId]: spaceId };
    set({ selectedSpaceIdByMachine: next });
    void AsyncStorage.setItem(SELECTED_SPACE_STORAGE_KEY, JSON.stringify(next));
  },

  clearMachine: (machineId) => {
    if (!(machineId in get().selectedSpaceIdByMachine)) return;
    const next = { ...get().selectedSpaceIdByMachine };
    delete next[machineId];
    set({ selectedSpaceIdByMachine: next });
    void AsyncStorage.setItem(SELECTED_SPACE_STORAGE_KEY, JSON.stringify(next));
  },
}));
