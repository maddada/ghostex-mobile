/**
 * Per-machine session inventory store.
 * - 5s polling loop, active only while the sessions screen is focused AND a
 *   machine is selected (screens call startPolling/stopPolling on focus/blur).
 * - Multi-machine refreshes run concurrently.
 * - Fingerprint change-skip avoids re-rendering identical summaries.
 */

import { create } from 'zustand';

import { logAppEvent } from '../app/appLog';
import type { GhostexMobileSummary } from '../contract/mobileSummary';
import { hasPassword } from '../machines/credentials';
import { machineDisplayLabel, useMachinesStore, type MachineRecord } from '../machines/store';
import { fetchInventory, summarizeFailure } from './client';

export const INVENTORY_POLL_INTERVAL_MS = 5000;

export type MachineInventory = {
  summary: GhostexMobileSummary | null;
  /** Summarized failure copy (sessions-drawer.md §5), null when healthy. */
  lastError: string | null;
  /** True once any load (success or failure) has completed. */
  hasLoaded: boolean;
  refreshing: boolean;
  fingerprint: string | null;
};

export function emptyMachineInventory(): MachineInventory {
  return { summary: null, lastError: null, hasLoaded: false, refreshing: false, fingerprint: null };
}

type InventoryState = {
  inventoriesByMachineId: Record<string, MachineInventory>;
  polling: boolean;
  refreshMachine: (machine: MachineRecord) => Promise<void>;
  /** Refresh every saved machine concurrently. */
  refreshAll: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
  /** Drop cached inventory (e.g. when a machine is removed). */
  clearMachine: (machineId: string) => void;
  /**
   * Optimistically clear a session's attention state (desktop-parity instant
   * dot clear on tap). Drops the fingerprint so the next poll always swaps the
   * summary back to server truth, covering a failed acknowledge CLI call.
   */
  acknowledgeAttentionLocally: (machineId: string, sessionId: string) => void;
};

let pollTimer: ReturnType<typeof setInterval> | null = null;
/** Guards against overlapping refresh passes for the same machine. */
const inFlightMachineIds = new Set<string>();

export const useInventoryStore = create<InventoryState>()((set, get) => {
  const patchMachine = (machineId: string, patch: Partial<MachineInventory>): void => {
    const current = get().inventoriesByMachineId[machineId] ?? emptyMachineInventory();
    set({
      inventoriesByMachineId: {
        ...get().inventoriesByMachineId,
        [machineId]: { ...current, ...patch },
      },
    });
  };

  return {
    inventoriesByMachineId: {},
    polling: false,

    refreshMachine: async (machine) => {
      if (inFlightMachineIds.has(machine.id)) return;
      inFlightMachineIds.add(machine.id);
      patchMachine(machine.id, { refreshing: true });
      try {
        const { summary, fingerprint } = await fetchInventory(machine);
        const previous = get().inventoriesByMachineId[machine.id];
        useMachinesStore.getState().markConnected(machine.id);
        // Log only connect transitions (first load or recovery), not every poll.
        if (previous === undefined || !previous.hasLoaded || previous.lastError !== null) {
          logAppEvent(`${machineDisplayLabel(machine)}: connected`);
        }
        if (previous !== undefined && previous.fingerprint === fingerprint) {
          // Unchanged payload: skip the summary swap, just clear transient state.
          patchMachine(machine.id, { refreshing: false, hasLoaded: true, lastError: null });
          return;
        }
        patchMachine(machine.id, {
          summary,
          fingerprint,
          refreshing: false,
          hasLoaded: true,
          lastError: null,
        });
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        const machineHasPassword = await hasPassword(machine.id);
        const failure = summarizeFailure(raw, machineHasPassword);
        // 5s polling repeats the same failure; log only new failure text.
        if (get().inventoriesByMachineId[machine.id]?.lastError !== failure) {
          logAppEvent(`${machineDisplayLabel(machine)}: ${failure}`);
        }
        patchMachine(machine.id, {
          refreshing: false,
          hasLoaded: true,
          lastError: failure,
        });
      } finally {
        inFlightMachineIds.delete(machine.id);
      }
    },

    refreshAll: async () => {
      const { machines } = useMachinesStore.getState();
      await Promise.all(machines.map((machine) => get().refreshMachine(machine)));
    },

    startPolling: () => {
      if (pollTimer !== null) return;
      set({ polling: true });
      const tick = (): void => {
        const machinesState = useMachinesStore.getState();
        if (machinesState.selectedMachineId === null) return;
        void get().refreshAll();
      };
      tick();
      pollTimer = setInterval(tick, INVENTORY_POLL_INTERVAL_MS);
    },

    stopPolling: () => {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      set({ polling: false });
    },

    clearMachine: (machineId) => {
      const next = { ...get().inventoriesByMachineId };
      delete next[machineId];
      set({ inventoriesByMachineId: next });
    },

    acknowledgeAttentionLocally: (machineId, sessionId) => {
      const summary = get().inventoriesByMachineId[machineId]?.summary;
      if (summary === null || summary === undefined) return;
      const sessions = summary.sessions.map((session) =>
        session.sessionId === sessionId
          ? {
              ...session,
              activity: 'idle',
              status: session.status === 'attention' ? 'idle' : session.status,
              attentionAcknowledged: true,
            }
          : session,
      );
      patchMachine(machineId, { summary: { ...summary, sessions }, fingerprint: null });
    },
  };
});
