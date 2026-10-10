/**
 * Selected workspace per computer, persisted on the phone so it reopens on the workspace the user
 * left it on. A computer with no stored pick, or one whose stored workspace was deleted since,
 * resolves to its default workspace through `resolveWorkspaceId`.
 *
 * CDXC:Workspaces 2026-10-09 DECISION:
 * User (questions-3 Q32 B): the phone gets "the taller cards with chips and a workspace switcher"
 * now. Picking a workspace filters the projects and Spaces as the desktop does.
 *
 * CDXC:Workspaces 2026-10-09 WHY:
 * The pick is per computer and kept on the device, because workspace ids belong to one computer.
 * A session opened from outside the list (a notification, a link, a search result) switches its
 * computer to that session's workspace (`revealSessionWorkspace`), so going back lands on a list
 * that holds it.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { useInventoryStore } from '../inventory/store';
import { resolveWorkspaceId, sessionWorkspaceId } from './workspaceFilter';

const SELECTED_WORKSPACE_STORAGE_KEY = 'workspaces.selectedIdByMachine';

type WorkspacesState = {
  hydrated: boolean;
  /** Raw stored workspace ids per machine. */
  selectedWorkspaceIdByMachine: Record<string, string>;
  /**
   * Workspaces each machine's list showed, newest first, for the tile's one-tap switch
   * (`workspaceSwitchTarget`). Kept for this run only, like the desktop window's recents.
   */
  recentWorkspaceIdsByMachine: Record<string, string[]>;
  hydrate: () => Promise<void>;
  selectWorkspace: (machineId: string, workspaceId: string) => void;
  /** Drop a removed machine's pick so the map cannot grow forever. */
  clearMachine: (machineId: string) => void;
};

function persistedRecord(raw: string | null): Record<string, string> {
  if (raw === null) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const result: Record<string, string> = {};
    for (const [machineId, workspaceId] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof workspaceId === 'string' && workspaceId.length > 0) result[machineId] = workspaceId;
    }
    return result;
  } catch {
    return {};
  }
}

export const useWorkspacesStore = create<WorkspacesState>()((set, get) => ({
  hydrated: false,
  selectedWorkspaceIdByMachine: {},
  recentWorkspaceIdsByMachine: {},

  hydrate: async () => {
    if (get().hydrated) return;
    const raw = await AsyncStorage.getItem(SELECTED_WORKSPACE_STORAGE_KEY);
    // A pick made before hydration finished (a notification on a cold start) wins over the stored one.
    set({
      hydrated: true,
      selectedWorkspaceIdByMachine: { ...persistedRecord(raw), ...get().selectedWorkspaceIdByMachine },
    });
  },

  selectWorkspace: (machineId, workspaceId) => {
    if (get().selectedWorkspaceIdByMachine[machineId] === workspaceId) return;
    const next = { ...get().selectedWorkspaceIdByMachine, [machineId]: workspaceId };
    const recent = (get().recentWorkspaceIdsByMachine[machineId] ?? []).filter((id) => id !== workspaceId);
    set({
      selectedWorkspaceIdByMachine: next,
      recentWorkspaceIdsByMachine: {
        ...get().recentWorkspaceIdsByMachine,
        [machineId]: [workspaceId, ...recent].slice(0, 8),
      },
    });
    void AsyncStorage.setItem(SELECTED_WORKSPACE_STORAGE_KEY, JSON.stringify(next));
  },

  clearMachine: (machineId) => {
    if (!(machineId in get().selectedWorkspaceIdByMachine)) return;
    const next = { ...get().selectedWorkspaceIdByMachine };
    delete next[machineId];
    set({ selectedWorkspaceIdByMachine: next });
    void AsyncStorage.setItem(SELECTED_WORKSPACE_STORAGE_KEY, JSON.stringify(next));
  },
}));

/**
 * The workspace a project added from the phone goes into: the one its computer's list shows,
 * unless that is the default workspace (written as no id, like the desktop's
 * `gx_store_window_non_default_workspace_id`). Undefined while the computer has no workspaces.
 */
export function addedProjectWorkspaceId(machineId: string): string | undefined {
  const workspaces = useInventoryStore.getState().inventoriesByMachineId[machineId]?.summary?.workspaces;
  if (workspaces === null || workspaces === undefined) return undefined;
  const resolved = resolveWorkspaceId(
    workspaces,
    useWorkspacesStore.getState().selectedWorkspaceIdByMachine[machineId],
  );
  return resolved === workspaces.defaultWorkspaceId ? undefined : resolved;
}

/**
 * Switch `machineId`'s list to the workspace `sessionId` is in, so the session the user opened from
 * outside the list (a notification, a link, a search result) is in the list they come back to.
 * Does nothing while the computer's summary has not loaded or the session shows everywhere.
 */
export function revealSessionWorkspace(machineId: string, sessionId: string): void {
  const summary = useInventoryStore.getState().inventoriesByMachineId[machineId]?.summary;
  if (summary === null || summary === undefined || summary.workspaces === null) return;
  const workspaceId = sessionWorkspaceId(summary, sessionId);
  if (workspaceId === null) return;
  const store = useWorkspacesStore.getState();
  const current = resolveWorkspaceId(summary.workspaces, store.selectedWorkspaceIdByMachine[machineId]);
  if (current !== workspaceId) store.selectWorkspace(machineId, workspaceId);
}
