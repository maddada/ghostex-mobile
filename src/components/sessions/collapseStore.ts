/**
 * Drawer disclosure state (sessions-drawer.md §3):
 * - Project-header collapse and flat-project session-list collapse are
 *   persisted per machine (AsyncStorage).
 * - Named-group collapse and machine-section collapse are in-memory only.
 * All sets default to empty = expanded, mirroring the Android reference.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const DISCLOSURE_STORAGE_KEY = 'drawer.disclosure.v1';

type PersistedDisclosure = Record<string, { projects: string[]; sessionLists: string[] }>;

function toggled(list: string[], key: string): string[] {
  return list.includes(key) ? list.filter((entry) => entry !== key) : [...list, key];
}

function isPersistedDisclosure(value: unknown): value is PersistedDisclosure {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(
    (entry) =>
      typeof entry === 'object' &&
      entry !== null &&
      Array.isArray((entry as { projects?: unknown }).projects) &&
      Array.isArray((entry as { sessionLists?: unknown }).sessionLists),
  );
}

type CollapseState = {
  hydrated: boolean;
  /** Persisted per machine: collapsed PROJECT_HEADER projectKeys. */
  collapsedProjectsByMachine: Record<string, string[]>;
  /** Persisted per machine: flat projects collapsed to 6 rows ("Show more"). */
  collapsedSessionListsByMachine: Record<string, string[]>;
  /** In-memory per machine: collapsed named-group collapse keys. */
  collapsedGroupsByMachine: Record<string, string[]>;
  /** In-memory: collapsed machine section ids (multi-machine drawer). */
  collapsedMachineIds: string[];

  hydrate: () => Promise<void>;
  toggleProject: (machineId: string, projectKey: string) => void;
  toggleSessionList: (machineId: string, projectKey: string) => void;
  toggleGroup: (machineId: string, groupCollapseKey: string) => void;
  toggleMachine: (machineId: string) => void;
};

export const useCollapseStore = create<CollapseState>()((set, get) => {
  const persist = (): void => {
    const { collapsedProjectsByMachine, collapsedSessionListsByMachine } = get();
    const persisted: PersistedDisclosure = {};
    const machineIds = new Set([
      ...Object.keys(collapsedProjectsByMachine),
      ...Object.keys(collapsedSessionListsByMachine),
    ]);
    for (const machineId of machineIds) {
      persisted[machineId] = {
        projects: collapsedProjectsByMachine[machineId] ?? [],
        sessionLists: collapsedSessionListsByMachine[machineId] ?? [],
      };
    }
    void AsyncStorage.setItem(DISCLOSURE_STORAGE_KEY, JSON.stringify(persisted));
  };

  return {
    hydrated: false,
    collapsedProjectsByMachine: {},
    collapsedSessionListsByMachine: {},
    collapsedGroupsByMachine: {},
    collapsedMachineIds: [],

    hydrate: async () => {
      if (get().hydrated) return;
      let projects: Record<string, string[]> = {};
      let sessionLists: Record<string, string[]> = {};
      try {
        const raw = await AsyncStorage.getItem(DISCLOSURE_STORAGE_KEY);
        if (raw !== null) {
          const parsed: unknown = JSON.parse(raw);
          if (isPersistedDisclosure(parsed)) {
            for (const [machineId, entry] of Object.entries(parsed)) {
              projects = { ...projects, [machineId]: entry.projects };
              sessionLists = { ...sessionLists, [machineId]: entry.sessionLists };
            }
          }
        }
      } catch {
        // Corrupt disclosure state falls back to everything expanded.
      }
      set({
        hydrated: true,
        collapsedProjectsByMachine: projects,
        collapsedSessionListsByMachine: sessionLists,
      });
    },

    toggleProject: (machineId, projectKey) => {
      const byMachine = get().collapsedProjectsByMachine;
      set({
        collapsedProjectsByMachine: {
          ...byMachine,
          [machineId]: toggled(byMachine[machineId] ?? [], projectKey),
        },
      });
      persist();
    },

    toggleSessionList: (machineId, projectKey) => {
      const byMachine = get().collapsedSessionListsByMachine;
      set({
        collapsedSessionListsByMachine: {
          ...byMachine,
          [machineId]: toggled(byMachine[machineId] ?? [], projectKey),
        },
      });
      persist();
    },

    toggleGroup: (machineId, groupCollapseKey) => {
      const byMachine = get().collapsedGroupsByMachine;
      set({
        collapsedGroupsByMachine: {
          ...byMachine,
          [machineId]: toggled(byMachine[machineId] ?? [], groupCollapseKey),
        },
      });
    },

    toggleMachine: (machineId) => {
      set({ collapsedMachineIds: toggled(get().collapsedMachineIds, machineId) });
    },
  };
});
