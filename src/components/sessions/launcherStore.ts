/**
 * Header launcher preferences, mirroring the desktop sidebar's persistence:
 * - one global primary agent shared by every project's split-button
 *   (desktop localStorage "ghostex-sidebar-project-terminal-launcher"),
 * - the last-run quick action per project for the actions button
 *   (desktop "ghostex.titlebar.lastActionCommandByProject:<projectKey>").
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

const LAUNCHER_STORAGE_KEY = 'drawer.launcher.v1';

type PersistedLauncher = {
  primaryAgentId?: string;
  lastActionByProject?: Record<string, string>;
};

type LauncherState = {
  hydrated: boolean;
  /** Global primary agent for the split-button main half ('' = first agent). */
  primaryAgentId: string;
  /** Last-run quick action commandId, keyed `${machineId}:${projectId}`. */
  lastActionByProject: Record<string, string>;

  hydrate: () => Promise<void>;
  setPrimaryAgent: (agentId: string) => void;
  setLastAction: (machineId: string, projectId: string, commandId: string) => void;
};

export function lastActionKey(machineId: string, projectId: string): string {
  return `${machineId}:${projectId}`;
}

export const useLauncherStore = create<LauncherState>()((set, get) => {
  const persist = (): void => {
    const { primaryAgentId, lastActionByProject } = get();
    const payload: PersistedLauncher = { primaryAgentId, lastActionByProject };
    void AsyncStorage.setItem(LAUNCHER_STORAGE_KEY, JSON.stringify(payload));
  };

  return {
    hydrated: false,
    primaryAgentId: '',
    lastActionByProject: {},

    hydrate: async () => {
      if (get().hydrated) return;
      let primaryAgentId = '';
      let lastActionByProject: Record<string, string> = {};
      try {
        const raw = await AsyncStorage.getItem(LAUNCHER_STORAGE_KEY);
        if (raw !== null) {
          const parsed: unknown = JSON.parse(raw);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            const record = parsed as PersistedLauncher;
            if (typeof record.primaryAgentId === 'string') primaryAgentId = record.primaryAgentId;
            if (
              typeof record.lastActionByProject === 'object' &&
              record.lastActionByProject !== null
            ) {
              for (const [key, value] of Object.entries(record.lastActionByProject)) {
                if (typeof value === 'string') lastActionByProject[key] = value;
              }
            }
          }
        }
      } catch {
        // Corrupt launcher state falls back to defaults.
      }
      set({ hydrated: true, primaryAgentId, lastActionByProject });
    },

    setPrimaryAgent: (agentId) => {
      set({ primaryAgentId: agentId });
      persist();
    },

    setLastAction: (machineId, projectId, commandId) => {
      set({
        lastActionByProject: {
          ...get().lastActionByProject,
          [lastActionKey(machineId, projectId)]: commandId,
        },
      });
      persist();
    },
  };
});
