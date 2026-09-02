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
import {
  enabledMachines,
  machineDisplayLabel,
  useMachinesStore,
  type MachineRecord,
} from '../machines/store';
import { fetchInventory, summarizeFailure } from './client';
import {
  applyOptimisticMutations,
  reconcileOptimisticMutations,
  type OptimisticInventoryChange,
  type PendingInventoryMutation,
} from './optimistic';

export const INVENTORY_POLL_INTERVAL_MS = 5000;

export type MachineInventory = {
  /** Rendered summary: latest server state with pending mutations applied. */
  summary: GhostexMobileSummary | null;
  /** Latest unmodified summary received from the connected machine. */
  serverSummary: GhostexMobileSummary | null;
  /** Summarized failure copy (sessions-drawer.md §5), null when healthy. */
  lastError: string | null;
  /** True once any load (success or failure) has completed. */
  hasLoaded: boolean;
  refreshing: boolean;
  fingerprint: string | null;
};

export function emptyMachineInventory(): MachineInventory {
  return {
    summary: null,
    serverSummary: null,
    lastError: null,
    hasLoaded: false,
    refreshing: false,
    fingerprint: null,
  };
}

type InventoryState = {
  inventoriesByMachineId: Record<string, MachineInventory>;
  pendingMutationsByMachineId: Record<string, PendingInventoryMutation[]>;
  polling: boolean;
  refreshMachine: (machine: MachineRecord) => Promise<void>;
  /**
   * Wait for any older request, then fetch an inventory that started after the
   * caller's mutation command completed.
   */
  refreshMachineFresh: (machine: MachineRecord) => Promise<void>;
  /** Refresh every saved machine concurrently. */
  refreshAll: () => Promise<void>;
  startPolling: () => void;
  stopPolling: () => void;
  /** Drop cached inventory (e.g. when a machine is removed). */
  clearMachine: (machineId: string) => void;
  beginOptimisticMutations: (
    machineId: string,
    changes: readonly OptimisticInventoryChange[],
  ) => Array<string | null>;
  commitOptimisticMutations: (machineId: string, mutationIds: readonly string[]) => void;
  rollbackOptimisticMutations: (machineId: string, mutationIds: readonly string[]) => void;
  /**
   * Optimistically clear a session's attention state (desktop-parity instant
   * dot clear on tap). Drops the fingerprint so the next poll always swaps the
   * summary back to server truth, covering a failed acknowledge CLI call.
   */
  acknowledgeAttentionLocally: (machineId: string, sessionId: string) => void;
};

let pollTimer: ReturnType<typeof setInterval> | null = null;
let nextMutationNumber = 1;
const inFlightRefreshes = new Map<string, Promise<void>>();
const refreshRevisions = new Map<string, number>();

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

  const setPendingMutations = (
    machineId: string,
    pending: PendingInventoryMutation[],
  ): Record<string, PendingInventoryMutation[]> => {
    const next = { ...get().pendingMutationsByMachineId };
    if (pending.length === 0) delete next[machineId];
    else next[machineId] = pending;
    return next;
  };

  return {
    inventoriesByMachineId: {},
    pendingMutationsByMachineId: {},
    polling: false,

    refreshMachine: (machine) => {
      const existing = inFlightRefreshes.get(machine.id);
      if (existing !== undefined) return existing;

      const refreshRevision = (refreshRevisions.get(machine.id) ?? 0) + 1;
      refreshRevisions.set(machine.id, refreshRevision);
      patchMachine(machine.id, { refreshing: true });

      const refresh = (async (): Promise<void> => {
        try {
          const { summary: serverSummary, fingerprint } = await fetchInventory(machine);
          const previous = get().inventoriesByMachineId[machine.id];
          const previousPending = get().pendingMutationsByMachineId[machine.id] ?? [];
          const reconciled = reconcileOptimisticMutations(
            serverSummary,
            previousPending,
            refreshRevision,
          );
          useMachinesStore.getState().markConnected(machine.id);
          // Log only connect transitions (first load or recovery), not every poll.
          if (previous === undefined || !previous.hasLoaded || previous.lastError !== null) {
            logAppEvent(`${machineDisplayLabel(machine)}: connected`);
          }
          for (const mutationId of reconciled.divergentMutationIds) {
            logAppEvent(
              `${machineDisplayLabel(machine)}: optimistic mutation ${mutationId} did not appear in server inventory`,
            );
          }

          if (
            previous !== undefined &&
            previous.fingerprint === fingerprint &&
            reconciled.pending === previousPending
          ) {
            patchMachine(machine.id, {
              refreshing: false,
              hasLoaded: true,
              lastError: null,
            });
            return;
          }

          set({
            inventoriesByMachineId: {
              ...get().inventoriesByMachineId,
              [machine.id]: {
                ...(previous ?? emptyMachineInventory()),
                summary: reconciled.summary,
                serverSummary,
                fingerprint,
                refreshing: false,
                hasLoaded: true,
                lastError: null,
              },
            },
            pendingMutationsByMachineId: setPendingMutations(
              machine.id,
              reconciled.pending,
            ),
          });
        } catch (error) {
          const raw = error instanceof Error ? error.message : String(error);
          let machineHasPassword = false;
          try {
            machineHasPassword = await hasPassword(machine.id);
          } catch {
            // Credential lookup failure must not leave inventory refreshing.
          }
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
        }
      })();

      inFlightRefreshes.set(machine.id, refresh);
      const clearRefresh = (): void => {
        if (inFlightRefreshes.get(machine.id) === refresh) {
          inFlightRefreshes.delete(machine.id);
        }
      };
      void refresh.then(clearRefresh, clearRefresh);
      return refresh;
    },

    refreshMachineFresh: async (machine) => {
      const olderRefresh = inFlightRefreshes.get(machine.id);
      if (olderRefresh !== undefined) {
        try {
          await olderRefresh;
        } catch {
          // A fresh request should still run if an older refresh aborted.
        }
      }
      await get().refreshMachine(machine);
    },

    refreshAll: async () => {
      // Machines hidden from the Sessions screen are never connected to, so a
      // hidden machine costs no SSH connection and no poll.
      const machines = enabledMachines(useMachinesStore.getState());
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
      const nextPending = { ...get().pendingMutationsByMachineId };
      delete next[machineId];
      delete nextPending[machineId];
      refreshRevisions.delete(machineId);
      set({
        inventoriesByMachineId: next,
        pendingMutationsByMachineId: nextPending,
      });
    },

    beginOptimisticMutations: (machineId, changes) => {
      const inventory = get().inventoriesByMachineId[machineId];
      const serverSummary = inventory?.serverSummary ?? inventory?.summary;
      if (
        inventory === undefined ||
        serverSummary === null ||
        serverSummary === undefined
      ) {
        return changes.map(() => null);
      }
      const usedMutationIds = new Set(
        Object.values(get().pendingMutationsByMachineId)
          .flat()
          .map((mutation) => mutation.id),
      );
      const additions = changes.map((change): PendingInventoryMutation => {
        let id = `optimistic-${nextMutationNumber++}`;
        while (usedMutationIds.has(id)) id = `optimistic-${nextMutationNumber++}`;
        usedMutationIds.add(id);
        return {
          id,
          change,
          phase: 'inFlight',
          confirmAfterRevision: null,
          confirmationMisses: 0,
        };
      });
      const pending = [
        ...(get().pendingMutationsByMachineId[machineId] ?? []),
        ...additions,
      ];
      set({
        inventoriesByMachineId: {
          ...get().inventoriesByMachineId,
          [machineId]: {
            ...inventory,
            summary: applyOptimisticMutations(serverSummary, pending),
            serverSummary,
          },
        },
        pendingMutationsByMachineId: setPendingMutations(machineId, pending),
      });
      return additions.map((mutation) => mutation.id);
    },

    commitOptimisticMutations: (machineId, mutationIds) => {
      if (mutationIds.length === 0) return;
      const mutationIdSet = new Set(mutationIds);
      const confirmAfterRevision = (refreshRevisions.get(machineId) ?? 0) + 1;
      const current = get().pendingMutationsByMachineId[machineId] ?? [];
      const pending = current.map((mutation) =>
        mutationIdSet.has(mutation.id)
          ? {
              ...mutation,
              phase: 'committed' as const,
              confirmAfterRevision,
              confirmationMisses: 0,
            }
          : mutation,
      );
      if (pending.some((mutation, index) => mutation !== current[index])) {
        set({ pendingMutationsByMachineId: setPendingMutations(machineId, pending) });
      }
    },

    rollbackOptimisticMutations: (machineId, mutationIds) => {
      if (mutationIds.length === 0) return;
      const mutationIdSet = new Set(mutationIds);
      const current = get().pendingMutationsByMachineId[machineId] ?? [];
      const pending = current.filter((mutation) => !mutationIdSet.has(mutation.id));
      if (pending.length === current.length) return;
      const inventory = get().inventoriesByMachineId[machineId];
      const serverSummary = inventory?.serverSummary ?? inventory?.summary;
      if (
        inventory === undefined ||
        serverSummary === null ||
        serverSummary === undefined
      ) {
        set({ pendingMutationsByMachineId: setPendingMutations(machineId, pending) });
        return;
      }
      set({
        inventoriesByMachineId: {
          ...get().inventoriesByMachineId,
          [machineId]: {
            ...inventory,
            summary: applyOptimisticMutations(serverSummary, pending),
            serverSummary,
          },
        },
        pendingMutationsByMachineId: setPendingMutations(machineId, pending),
      });
    },

    acknowledgeAttentionLocally: (machineId, sessionId) => {
      const inventory = get().inventoriesByMachineId[machineId];
      const serverSummary = inventory?.serverSummary ?? inventory?.summary;
      if (
        inventory === undefined ||
        serverSummary === null ||
        serverSummary === undefined
      ) {
        return;
      }
      const sessions = serverSummary.sessions.map((session) =>
        session.sessionId === sessionId
          ? {
              ...session,
              activity: 'idle',
              status: session.status === 'attention' ? 'idle' : session.status,
              attentionAcknowledged: true,
            }
          : session,
      );
      const nextServerSummary = { ...serverSummary, sessions };
      const pending = get().pendingMutationsByMachineId[machineId] ?? [];
      set({
        inventoriesByMachineId: {
          ...get().inventoriesByMachineId,
          [machineId]: {
            ...inventory,
            serverSummary: nextServerSummary,
            summary: applyOptimisticMutations(nextServerSummary, pending),
            fingerprint: null,
          },
        },
      });
    },
  };
});
