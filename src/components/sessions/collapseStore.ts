/**
 * Drawer disclosure state.
 * Matching the desktop gpui sidebar request: on first start EVERYTHING
 * (collections, projects, named groups) is collapsed, so the store tracks
 * EXPANDED sets — absence means collapsed. Projects, collections, and named
 * groups are persisted per machine (AsyncStorage, v2 key); the flat-project
 * "Show more" collapse keeps desktop semantics (default expanded, presence =
 * collapsed to 6 rows). Machine-section collapse stays in-memory only.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const DISCLOSURE_STORAGE_KEY = 'drawer.disclosure.v2';

type PersistedMachineDisclosure = {
  expandedProjects: string[];
  expandedCollections: string[];
  expandedGroups: string[];
  collapsedSessionLists: string[];
  /** Collapsed "Quick"/"Projects" section labels (default expanded). */
  collapsedSections?: string[];
};

type PersistedDisclosure = Record<string, PersistedMachineDisclosure>;

function toggled(list: string[], key: string): string[] {
  return list.includes(key) ? list.filter((entry) => entry !== key) : [...list, key];
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

type CollapseState = {
  hydrated: boolean;
  /** Persisted per machine: expanded PROJECT_HEADER projectKeys. */
  expandedProjectsByMachine: Record<string, string[]>;
  /** Persisted per machine: expanded COLLECTION_HEADER collectionIds. */
  expandedCollectionsByMachine: Record<string, string[]>;
  /** Persisted per machine: expanded named-group collapse keys. */
  expandedGroupsByMachine: Record<string, string[]>;
  /** Persisted per machine: flat projects collapsed to 6 rows ("Show more"). */
  collapsedSessionListsByMachine: Record<string, string[]>;
  /** Persisted per machine: collapsed 'quick'/'projects' section labels. */
  collapsedSectionsByMachine: Record<string, string[]>;
  /** In-memory: collapsed machine section ids (multi-machine drawer). */
  collapsedMachineIds: string[];

  hydrate: () => Promise<void>;
  toggleProject: (machineId: string, projectKey: string) => void;
  toggleCollection: (machineId: string, collectionId: string) => void;
  toggleGroup: (machineId: string, groupCollapseKey: string) => void;
  toggleSessionList: (machineId: string, projectKey: string) => void;
  toggleSection: (machineId: string, section: 'quick' | 'projects') => void;
  toggleMachine: (machineId: string) => void;
  /** Projects-section bulk disclosure (desktop Collapse All / Expand). */
  collapseAllProjects: (machineId: string) => void;
  expandAllProjects: (machineId: string, projectKeys: string[], collectionIds: string[]) => void;
};

export const useCollapseStore = create<CollapseState>()((set, get) => {
  const persist = (): void => {
    const {
      expandedProjectsByMachine,
      expandedCollectionsByMachine,
      expandedGroupsByMachine,
      collapsedSessionListsByMachine,
      collapsedSectionsByMachine,
    } = get();
    const persisted: PersistedDisclosure = {};
    const machineIds = new Set([
      ...Object.keys(expandedProjectsByMachine),
      ...Object.keys(expandedCollectionsByMachine),
      ...Object.keys(expandedGroupsByMachine),
      ...Object.keys(collapsedSessionListsByMachine),
      ...Object.keys(collapsedSectionsByMachine),
    ]);
    for (const machineId of machineIds) {
      persisted[machineId] = {
        expandedProjects: expandedProjectsByMachine[machineId] ?? [],
        expandedCollections: expandedCollectionsByMachine[machineId] ?? [],
        expandedGroups: expandedGroupsByMachine[machineId] ?? [],
        collapsedSessionLists: collapsedSessionListsByMachine[machineId] ?? [],
        collapsedSections: collapsedSectionsByMachine[machineId] ?? [],
      };
    }
    void AsyncStorage.setItem(DISCLOSURE_STORAGE_KEY, JSON.stringify(persisted));
  };

  const toggleIn = (
    field:
      | 'expandedProjectsByMachine'
      | 'expandedCollectionsByMachine'
      | 'expandedGroupsByMachine'
      | 'collapsedSessionListsByMachine'
      | 'collapsedSectionsByMachine',
    machineId: string,
    key: string,
  ): void => {
    const byMachine = get()[field];
    set({
      [field]: {
        ...byMachine,
        [machineId]: toggled(byMachine[machineId] ?? [], key),
      },
    } as Partial<CollapseState>);
    persist();
  };

  return {
    hydrated: false,
    expandedProjectsByMachine: {},
    expandedCollectionsByMachine: {},
    expandedGroupsByMachine: {},
    collapsedSessionListsByMachine: {},
    collapsedSectionsByMachine: {},
    collapsedMachineIds: [],

    hydrate: async () => {
      if (get().hydrated) return;
      let expandedProjects: Record<string, string[]> = {};
      let expandedCollections: Record<string, string[]> = {};
      let expandedGroups: Record<string, string[]> = {};
      let collapsedSessionLists: Record<string, string[]> = {};
      let collapsedSections: Record<string, string[]> = {};
      try {
        const raw = await AsyncStorage.getItem(DISCLOSURE_STORAGE_KEY);
        if (raw !== null) {
          const parsed: unknown = JSON.parse(raw);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            for (const [machineId, entry] of Object.entries(parsed)) {
              if (typeof entry !== 'object' || entry === null) continue;
              const record = entry as Partial<PersistedMachineDisclosure>;
              expandedProjects = {
                ...expandedProjects,
                [machineId]: stringArray(record.expandedProjects),
              };
              expandedCollections = {
                ...expandedCollections,
                [machineId]: stringArray(record.expandedCollections),
              };
              expandedGroups = { ...expandedGroups, [machineId]: stringArray(record.expandedGroups) };
              collapsedSessionLists = {
                ...collapsedSessionLists,
                [machineId]: stringArray(record.collapsedSessionLists),
              };
              collapsedSections = {
                ...collapsedSections,
                [machineId]: stringArray(record.collapsedSections),
              };
            }
          }
        }
      } catch {
        // Corrupt disclosure state falls back to everything collapsed.
      }
      set({
        hydrated: true,
        expandedProjectsByMachine: expandedProjects,
        expandedCollectionsByMachine: expandedCollections,
        expandedGroupsByMachine: expandedGroups,
        collapsedSessionListsByMachine: collapsedSessionLists,
        collapsedSectionsByMachine: collapsedSections,
      });
    },

    toggleProject: (machineId, projectKey) =>
      toggleIn('expandedProjectsByMachine', machineId, projectKey),

    toggleCollection: (machineId, collectionId) =>
      toggleIn('expandedCollectionsByMachine', machineId, collectionId),

    toggleGroup: (machineId, groupCollapseKey) =>
      toggleIn('expandedGroupsByMachine', machineId, groupCollapseKey),

    toggleSessionList: (machineId, projectKey) =>
      toggleIn('collapsedSessionListsByMachine', machineId, projectKey),

    toggleSection: (machineId, section) =>
      toggleIn('collapsedSectionsByMachine', machineId, section),

    toggleMachine: (machineId) => {
      set({ collapsedMachineIds: toggled(get().collapsedMachineIds, machineId) });
    },

    collapseAllProjects: (machineId) => {
      set({
        expandedProjectsByMachine: { ...get().expandedProjectsByMachine, [machineId]: [] },
        expandedCollectionsByMachine: { ...get().expandedCollectionsByMachine, [machineId]: [] },
      });
      persist();
    },

    expandAllProjects: (machineId, projectKeys, collectionIds) => {
      set({
        expandedProjectsByMachine: {
          ...get().expandedProjectsByMachine,
          [machineId]: [...projectKeys],
        },
        expandedCollectionsByMachine: {
          ...get().expandedCollectionsByMachine,
          [machineId]: [...collectionIds],
        },
      });
      persist();
    },
  };
});
