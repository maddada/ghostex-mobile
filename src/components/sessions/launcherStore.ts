/**
 * Header launcher preferences, mirroring the desktop sidebar's persistence:
 * - the agent picked last anywhere, and the one picked in each project and each Space
 *   (desktop "ghostex-sidebar-project-terminal-launcher" and
 *   "ghostex.sidebar.agentLauncherChoices.v1"); which one a project's split-button starts is
 *   ./agentChoice.ts,
 * - the last-run quick action per project for the actions button
 *   (desktop "ghostex.titlebar.lastActionCommandByProject:<projectKey>").
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { readAgentChoiceMap, rememberAgentChoice, type AgentChoicePlace } from './agentChoice';

const LAUNCHER_STORAGE_KEY = 'drawer.launcher.v1';

type PersistedLauncher = {
  primaryAgentId?: string;
  agentByProject?: Record<string, string>;
  agentBySpace?: Record<string, string>;
  lastActionByProject?: Record<string, string>;
};

type LauncherState = {
  hydrated: boolean;
  /** The agent picked last anywhere ('' = none yet, which starts the first agent). */
  primaryAgentId: string;
  /** The agent picked in each project, keyed `${machineId}:${projectId}`. */
  agentByProject: Record<string, string>;
  /** The agent picked in each Space, keyed `${machineId}:${spaceId}`. */
  agentBySpace: Record<string, string>;
  /** Last-run quick action commandId, keyed `${machineId}:${projectId}`. */
  lastActionByProject: Record<string, string>;

  hydrate: () => Promise<void>;
  /** Remembers a launched agent for its project, its Space and as the last pick. */
  rememberAgent: (agentId: string, place: AgentChoicePlace) => void;
  setLastAction: (machineId: string, projectId: string, commandId: string) => void;
};

export function lastActionKey(machineId: string, projectId: string): string {
  return `${machineId}:${projectId}`;
}

export const useLauncherStore = create<LauncherState>()((set, get) => {
  const persist = (): void => {
    const { primaryAgentId, agentByProject, agentBySpace, lastActionByProject } = get();
    const payload: PersistedLauncher = { primaryAgentId, agentByProject, agentBySpace, lastActionByProject };
    void AsyncStorage.setItem(LAUNCHER_STORAGE_KEY, JSON.stringify(payload));
  };

  return {
    hydrated: false,
    primaryAgentId: '',
    agentByProject: {},
    agentBySpace: {},
    lastActionByProject: {},

    hydrate: async () => {
      if (get().hydrated) return;
      let primaryAgentId = '';
      let agentByProject: Record<string, string> = {};
      let agentBySpace: Record<string, string> = {};
      let lastActionByProject: Record<string, string> = {};
      try {
        const raw = await AsyncStorage.getItem(LAUNCHER_STORAGE_KEY);
        if (raw !== null) {
          const parsed: unknown = JSON.parse(raw);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            const record = parsed as PersistedLauncher;
            if (typeof record.primaryAgentId === 'string') primaryAgentId = record.primaryAgentId;
            agentByProject = readAgentChoiceMap(record.agentByProject);
            agentBySpace = readAgentChoiceMap(record.agentBySpace);
            if (typeof record.lastActionByProject === 'object' && record.lastActionByProject !== null) {
              for (const [key, value] of Object.entries(record.lastActionByProject)) {
                if (typeof value === 'string') lastActionByProject[key] = value;
              }
            }
          }
        }
      } catch {
        // Corrupt launcher state falls back to defaults.
      }
      set({ hydrated: true, primaryAgentId, agentByProject, agentBySpace, lastActionByProject });
    },

    rememberAgent: (agentId, place) => {
      const { primaryAgentId, agentByProject, agentBySpace } = get();
      const next = rememberAgentChoice(
        { last: primaryAgentId, byProject: agentByProject, bySpace: agentBySpace },
        agentId,
        place,
      );
      set({ primaryAgentId: next.last, agentByProject: next.byProject, agentBySpace: next.bySpace });
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
