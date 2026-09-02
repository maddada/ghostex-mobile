/**
 * Web preview preferences: the port the user last previewed on each machine, so
 * the picker's manual field comes back prefilled with it. Persisted to
 * AsyncStorage the same way the header launcher preferences are
 * (src/components/sessions/launcherStore.ts).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import { isValidPort } from './urls';

const WEB_PREVIEW_STORAGE_KEY = 'webPreview.v1';

type PersistedWebPreview = {
  lastPortByMachine?: Record<string, number>;
};

type WebPreviewState = {
  hydrated: boolean;
  /** Last previewed port, keyed by machine id. */
  lastPortByMachine: Record<string, number>;

  hydrate: () => Promise<void>;
  setLastPort: (machineId: string, port: number) => void;
};

export const useWebPreviewStore = create<WebPreviewState>()((set, get) => {
  const persist = (): void => {
    const payload: PersistedWebPreview = { lastPortByMachine: get().lastPortByMachine };
    void AsyncStorage.setItem(WEB_PREVIEW_STORAGE_KEY, JSON.stringify(payload));
  };

  return {
    hydrated: false,
    lastPortByMachine: {},

    hydrate: async () => {
      if (get().hydrated) return;
      const lastPortByMachine: Record<string, number> = {};
      try {
        const raw = await AsyncStorage.getItem(WEB_PREVIEW_STORAGE_KEY);
        if (raw !== null) {
          const parsed: unknown = JSON.parse(raw);
          if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
            const record = (parsed as PersistedWebPreview).lastPortByMachine;
            if (typeof record === 'object' && record !== null) {
              for (const [machineId, port] of Object.entries(record)) {
                if (typeof port === 'number' && isValidPort(port)) lastPortByMachine[machineId] = port;
              }
            }
          }
        }
      } catch {
        // Corrupt preview state has no remembered ports to contribute.
      }
      /*
       * A preview opened before hydration finished has already recorded its
       * port in memory, and that is the newer of the two. Merging keeps it
       * instead of replacing it with the older persisted table.
       */
      set({ hydrated: true, lastPortByMachine: { ...lastPortByMachine, ...get().lastPortByMachine } });
    },

    setLastPort: (machineId, port) => {
      if (!isValidPort(port)) return;
      set({ lastPortByMachine: { ...get().lastPortByMachine, [machineId]: port } });
      persist();
    },
  };
});
