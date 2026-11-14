/**
 * Per-machine session inventory store.
 * - 5s polling loop on every screen while the app is in the foreground AND a
 *   machine is selected; `summaryRefresh.ts` owns the timer
 *   and reports it through `setPolling`.
 * - Multi-machine refreshes run concurrently.
 * - Fingerprint change-skip avoids re-rendering identical summaries.
 */

import { loadSummaryIcons, summaryIconRefs } from './projectIcons';
import { create } from 'zustand';

import { reportClientHello } from '../analytics/clientHello';
import { logAppEvent } from '../app/appLog';
import { withoutGlobalQuickActions, type GhostexMobileSummary } from '../contract/mobileSummary';
import { hasPassword } from '../machines/credentials';
import { reconnectMachine } from '../remote/connection';
import { dialWaitMs } from '../remote/dialBackoff';
import { restoreAttachTabs } from '../terminal/sessions';
import { enabledMachines, machineDisplayLabel, useMachinesStore, type MachineRecord } from '../machines/store';
import { FailureCopy } from '../copy';
import { fetchInventory, summarizeFailureDetailed, type FailureReasonCode } from './client';
import { closePushedList, closePushedLists, onPushedListChanged } from './summaryStream';
import { pairingEpoch, samePairing } from '../machines/pairingEpoch';
import { refreshCloudBoxes } from '../cloudBoxes/sync';
import { organizeSummary } from '../settingsSync/sidebarOrganization';
import { useSyncedEntriesStore } from '../settingsSync/syncedEntries';
import { useSettingsStore } from '../settings/store';
import {
  applyOptimisticMutations as applyMutations,
  reconcileOptimisticMutations,
  type OptimisticInventoryChange,
  type PendingInventoryMutation,
} from './optimistic';

export const INVENTORY_POLL_INTERVAL_MS = 5000;

/**
 * While a computer is out of channels (`channelsBusy`), the poll waits 2, 5, 10, then 20 s between reads instead of
 * adding a read every 5 s to what already fills them; the list on screen stays (CDXC:RemoteMachines 2026-11-13 in
 * src/remote/channelBudget.ts).
 */
const BUSY_RETRY_DELAYS_MS = [2_000, 5_000, 10_000, 20_000];
const busyBackoff = new Map<string, { attempt: number; until: number }>();

function noteBusy(machineId: string, busy: boolean): void {
  if (!busy) {
    busyBackoff.delete(machineId);
    return;
  }
  const attempt = (busyBackoff.get(machineId)?.attempt ?? -1) + 1;
  const delay = BUSY_RETRY_DELAYS_MS[Math.min(attempt, BUSY_RETRY_DELAYS_MS.length - 1)]!;
  busyBackoff.set(machineId, { attempt, until: Date.now() + delay });
}

function waitingOutBusy(machineId: string): boolean {
  const backoff = busyBackoff.get(machineId);
  return backoff !== undefined && Date.now() < backoff.until;
}
/**
 * While a computer's Ghostex is not answering, its list is read again this soon rather than on the
 * next 5 s poll (CDXC:Sidebar 2026-10-08 in `packages/gx-core/src/sidebar_view/daemon_wait.rs`):
 * the user asked every client to retry every 2 seconds until Ghostex is there. Only while the
 * summary poll runs, and one pending retry per machine.
 */
const NOT_ANSWERING_RETRY_MS = 2000;
const notAnsweringRetries = new Map<string, ReturnType<typeof setTimeout>>();
/** Machines whose next refresh must be read after the caller's change (`refreshMachineFresh`). */
const freshReads = new Set<string>();
/** When each machine's Ghostex stopped answering, for the "taking longer than usual" line. */
const notAnsweringSince = new Map<string, number>();
const NOT_ANSWERING_LONG_MS = 30_000;

export type MachineInventory = {
  /** Rendered summary: latest server state with pending mutations applied. */
  summary: GhostexMobileSummary | null;
  /** Latest unmodified summary received from the connected machine. */
  serverSummary: GhostexMobileSummary | null;
  /** Summarized failure copy (sessions-drawer.md §5), null when healthy. */
  lastError: string | null;
  /** Why `lastError` happened (native error code first, message second); null when healthy. */
  lastErrorCode: FailureReasonCode | null;
  /** True once any load (success or failure) has completed. */
  hasLoaded: boolean;
  refreshing: boolean;
  /**
   * True while a user-initiated retry (tab glyph, failed card) is in flight.
   * Separate from `refreshing`, which the 5s poll flips on every tick, so the
   * tab spinner shows for an explicit retry even when a summary is retained.
   */
  retrying: boolean;
  fingerprint: string | null;
  /**
   * When `summary` was last read from the computer (epoch ms), the data time the Live Activity shows;
   * null before the first successful read. Failed reads keep the old time.
   */
  loadedAt: number | null;
};

export function emptyMachineInventory(): MachineInventory {
  return {
    summary: null,
    serverSummary: null,
    lastError: null,
    lastErrorCode: null,
    hasLoaded: false,
    refreshing: false,
    retrying: false,
    fingerprint: null,
    loadedAt: null,
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
  /**
   * Retry one machine's connection from its tab glyph or menu, by id, without
   * touching the selection: the drawer keeps showing whatever machine it was
   * showing, exactly like clicking the cloud on a desktop machine tab. Hidden
   * or unknown ids are ignored because they have no tab to retry from.
   */
  retryMachine: (machineId: string) => Promise<void>;
  /** Refresh every saved machine concurrently. */
  refreshAll: () => Promise<void>;
  /** Set by the summary refresh (`summaryRefresh.ts`); false also drops pending not-answering retries. */
  setPolling: (polling: boolean) => void;
  /** Drop cached inventory (e.g. when a machine is removed). */
  clearMachine: (machineId: string) => void;
  beginOptimisticMutations: (machineId: string, changes: readonly OptimisticInventoryChange[]) => Array<string | null>;
  commitOptimisticMutations: (machineId: string, mutationIds: readonly string[]) => void;
  rollbackOptimisticMutations: (machineId: string, mutationIds: readonly string[]) => void;
  /**
   * Forget the computer's cached Global Actions and capability, keeping everything else on screen; for a connection
   * that is recovered outside this store (the automatic reconnect, the check on returning to the foreground). A list
   * read already under way was sent over the connection being recovered: its answer is discarded, and the next
   * read starts anew.
   */
  dropGlobalQuickActions: (machineId: string) => void;
  /**
   * Optimistically clear a session's attention state (desktop-parity instant
   * dot clear on tap). Drops the fingerprint so the next poll always swaps the
   * summary back to server truth, covering a failed acknowledge CLI call.
   */
  acknowledgeAttentionLocally: (machineId: string, sessionId: string) => void;
};

/**
 * The rendered summary: the computer's, with pending changes applied and the synced Sidebar organization laid over
 * its own sidebar settings (settingsSync/sidebarOrganization.ts), so every list rule reads the synced value.
 */
function applyOptimisticMutations(
  serverSummary: GhostexMobileSummary,
  pending: readonly PendingInventoryMutation[],
): GhostexMobileSummary {
  return organizeSummary(applyMutations(serverSummary, pending));
}

/**
 * `next`, a computer's newly rendered list, with every session and project that is the same as in `previous` (the list
 * the store holds now) kept as the object held before, and `previous` itself when nothing at all changed. A read, a
 * pushed change or a re-laid list rebuilds every record from scratch; without this, a screen that shows one session
 * (the terminal screen, its chat's links) re-renders for any change to any other session, and for none at all.
 */
export function keepUnchanged(
  previous: GhostexMobileSummary | null | undefined,
  next: GhostexMobileSummary,
): GhostexMobileSummary {
  if (previous === null || previous === undefined || previous === next) return next;
  const reuse = <T>(before: readonly T[], after: T[], key: (item: T) => string): { items: T[]; all: boolean } => {
    const held = new Map(before.map((item) => [key(item), item]));
    let all = before.length === after.length;
    const items = after.map((item, index) => {
      const old = held.get(key(item));
      if (old !== undefined && JSON.stringify(old) === JSON.stringify(item)) {
        if (before[index] !== old) all = false;
        return old;
      }
      all = false;
      return item;
    });
    return { items, all };
  };
  const sessions = reuse(
    previous.sessions,
    next.sessions,
    (session) => session.globalRef || `${session.projectId}:${session.sessionId}`,
  );
  const projects = reuse(previous.projects, next.projects, (project) => project.projectId);
  const kept = { ...next, sessions: sessions.items, projects: projects.items };
  if (sessions.all && projects.all) {
    const rest = (summary: GhostexMobileSummary): string =>
      JSON.stringify({ ...summary, sessions: null, projects: null });
    if (rest(previous) === rest(next)) return previous;
  }
  return kept;
}

let nextMutationNumber = 1;
const inFlightRefreshes = new Map<string, Promise<void>>();
const refreshRevisions = new Map<string, number>();
const retryRequests = new Map<string, Promise<void>>();

/** A read already under way for the computer is not applied when it answers, and the next refresh starts anew. */
function forgetInFlightRefresh(machineId: string): void {
  refreshRevisions.set(machineId, (refreshRevisions.get(machineId) ?? 0) + 1);
  inFlightRefreshes.delete(machineId);
}

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

  /**
   * A lost or re-established connection keeps the list on screen but not the computer's Global Actions: they are
   * shown and run only from a summary read over the current connection, since the computer that answers next may
   * no longer offer them. The fingerprint goes too, so the next answer is applied even when its text is unchanged.
   */
  const dropGlobalQuickActions = (machineId: string): void => {
    const current = get().inventoriesByMachineId[machineId];
    if (current === undefined) return;
    const cached =
      current.summary?.globalQuickActionsSupported === true ||
      current.serverSummary?.globalQuickActionsSupported === true;
    if (!cached) return;
    patchMachine(machineId, {
      summary: current.summary === null ? null : withoutGlobalQuickActions(current.summary),
      serverSummary: current.serverSummary === null ? null : withoutGlobalQuickActions(current.serverSummary),
      fingerprint: null,
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
      const retry = retryRequests.get(machine.id);
      if (retry !== undefined) return retry;
      const existing = inFlightRefreshes.get(machine.id);
      if (existing !== undefined) return existing;

      const refreshRevision = (refreshRevisions.get(machine.id) ?? 0) + 1;
      refreshRevisions.set(machine.id, refreshRevision);
      // An answer from the computer the entry was paired with before a re-pair is not this entry's
      // (machines/pairingEpoch.ts): neither its sessions nor "connected" are kept.
      const epoch = pairingEpoch(machine.id);
      const pairedAgain = (): boolean => {
        if (samePairing(machine.id, epoch)) return false;
        patchMachine(machine.id, { refreshing: false });
        return true;
      };
      patchMachine(machine.id, { refreshing: true });

      const refresh = (async (): Promise<void> => {
        try {
          const fresh = freshReads.delete(machine.id);
          const { summary: serverSummary, fingerprint } = await fetchInventory(machine, { fresh });
          if (refreshRevisions.get(machine.id) !== refreshRevision) return;
          if (pairedAgain()) return;
          const previous = get().inventoriesByMachineId[machine.id];
          const previousPending = get().pendingMutationsByMachineId[machine.id] ?? [];
          const reconciled = reconcileOptimisticMutations(serverSummary, previousPending, refreshRevision);
          notAnsweringSince.delete(machine.id);
          noteBusy(machine.id, false);
          loadSummaryIcons(machine, serverSummary, () => {
            const current = get().inventoriesByMachineId[machine.id]?.serverSummary;
            return current == null ? summaryIconRefs(serverSummary) : summaryIconRefs(current);
          });
          useMachinesStore.getState().markConnected(machine.id);
          reportClientHello(machine);
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
              lastErrorCode: null,
              loadedAt: Date.now(),
            });
            return;
          }

          set({
            inventoriesByMachineId: {
              ...get().inventoriesByMachineId,
              [machine.id]: {
                ...(previous ?? emptyMachineInventory()),
                summary: keepUnchanged(previous?.summary, organizeSummary(reconciled.summary)),
                serverSummary,
                fingerprint,
                refreshing: false,
                hasLoaded: true,
                lastError: null,
                lastErrorCode: null,
                loadedAt: Date.now(),
              },
            },
            pendingMutationsByMachineId: setPendingMutations(machine.id, reconciled.pending),
          });
        } catch (error) {
          let machineHasPassword = false;
          try {
            machineHasPassword = await hasPassword(machine.id);
          } catch {
            // Credential lookup failure must not leave inventory refreshing.
          }
          if (refreshRevisions.get(machine.id) !== refreshRevision) return;
          if (pairedAgain()) return;
          const failure = summarizeFailureDetailed(error, machineHasPassword);
          noteBusy(machine.id, failure.reasonCode === 'channelsBusy');
          if (failure.reasonCode === 'ghostexNotAnswering') {
            const since = notAnsweringSince.get(machine.id) ?? Date.now();
            notAnsweringSince.set(machine.id, since);
            // The sessions list's own words; other actions keep the general not-answering line.
            failure.message =
              Date.now() - since >= NOT_ANSWERING_LONG_MS
                ? FailureCopy.ghostexNotAnsweringLong
                : FailureCopy.ghostexNotAnswering;
          } else {
            notAnsweringSince.delete(machine.id);
          }
          // 5s polling repeats the same failure; log only new failure text.
          if (get().inventoriesByMachineId[machine.id]?.lastError !== failure.message) {
            logAppEvent(`${machineDisplayLabel(machine)}: ${failure.message}`);
          }
          patchMachine(machine.id, {
            refreshing: false,
            hasLoaded: true,
            lastError: failure.message,
            lastErrorCode: failure.reasonCode,
          });
          dropGlobalQuickActions(machine.id);
          if (failure.reasonCode === 'ghostexNotAnswering' && get().polling && !notAnsweringRetries.has(machine.id)) {
            notAnsweringRetries.set(
              machine.id,
              setTimeout(() => {
                notAnsweringRetries.delete(machine.id);
                if (get().polling) void get().refreshMachine(machine);
              }, NOT_ANSWERING_RETRY_MS),
            );
          }
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
      freshReads.add(machine.id);
      await get().refreshMachine(machine);
    },

    retryMachine: (machineId) => {
      const existing = retryRequests.get(machineId);
      if (existing !== undefined) return existing;
      const machine = enabledMachines(useMachinesStore.getState()).find((entry) => entry.id === machineId);
      if (machine === undefined) return Promise.resolve();
      forgetInFlightRefresh(machineId);
      patchMachine(machine.id, { retrying: true });
      dropGlobalQuickActions(machine.id);
      const request = Promise.resolve().then(async () => {
        try {
          await reconnectMachine(machine);
          if (retryRequests.get(machineId) !== request) return;
          retryRequests.delete(machineId);
          const refresh = get().refreshMachine(machine);
          retryRequests.set(machineId, request);
          await Promise.all([refresh, restoreAttachTabs(machineId)]);
        } catch (error) {
          const failure = summarizeFailureDetailed(error, await hasPassword(machineId).catch(() => false));
          if (retryRequests.get(machineId) !== request) return;
          patchMachine(machineId, {
            refreshing: false,
            hasLoaded: true,
            lastError: failure.message,
            lastErrorCode: failure.reasonCode,
          });
          logAppEvent(`${machineDisplayLabel(machine)}: ${failure.message}`);
          return;
        } finally {
          if (retryRequests.get(machineId) === request) {
            retryRequests.delete(machineId);
            patchMachine(machineId, { retrying: false });
          }
        }
      });
      retryRequests.set(machineId, request);
      return request;
    },

    dropGlobalQuickActions: (machineId) => {
      forgetInFlightRefresh(machineId);
      dropGlobalQuickActions(machineId);
    },

    refreshAll: async () => {
      // Machines hidden from the Sessions screen are never connected to, so a
      // hidden machine costs no SSH connection and no poll.
      const machines = enabledMachines(useMachinesStore.getState()).filter((machine) => {
        const failure = get().inventoriesByMachineId[machine.id]?.lastErrorCode;
        return (
          failure !== 'authFailed' &&
          failure !== 'hostKeyChanged' &&
          !waitingOutBusy(machine.id) &&
          // A computer that did not answer its last dials waits for its next one (src/remote/dialBackoff.ts).
          dialWaitMs(machine.id) === 0
        );
      });
      await Promise.all(machines.map((machine) => get().refreshMachine(machine)));
      // Each computer's Cloud Boxes and their sessions ride the same poll (cloudBoxes/sync.ts).
      void refreshCloudBoxes().catch(() => undefined);
    },

    setPolling: (polling) => {
      if (!polling) {
        for (const timer of notAnsweringRetries.values()) clearTimeout(timer);
        notAnsweringRetries.clear();
        // Pushed lists follow the poll: none stays open in the background (summaryStream.ts).
        closePushedLists();
      }
      set({ polling });
    },

    clearMachine: (machineId) => {
      retryRequests.delete(machineId);
      closePushedList(machineId);
      const next = { ...get().inventoriesByMachineId };
      const nextPending = { ...get().pendingMutationsByMachineId };
      delete next[machineId];
      delete nextPending[machineId];
      forgetInFlightRefresh(machineId);
      set({
        inventoriesByMachineId: next,
        pendingMutationsByMachineId: nextPending,
      });
    },

    beginOptimisticMutations: (machineId, changes) => {
      const inventory = get().inventoriesByMachineId[machineId];
      const serverSummary = inventory?.serverSummary ?? inventory?.summary;
      if (inventory === undefined || serverSummary === null || serverSummary === undefined) {
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
      const pending = [...(get().pendingMutationsByMachineId[machineId] ?? []), ...additions];
      set({
        inventoriesByMachineId: {
          ...get().inventoriesByMachineId,
          [machineId]: {
            ...inventory,
            summary: keepUnchanged(
              get().inventoriesByMachineId[machineId]?.summary,
              applyOptimisticMutations(serverSummary, pending),
            ),
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
      if (inventory === undefined || serverSummary === null || serverSummary === undefined) {
        set({ pendingMutationsByMachineId: setPendingMutations(machineId, pending) });
        return;
      }
      set({
        inventoriesByMachineId: {
          ...get().inventoriesByMachineId,
          [machineId]: {
            ...inventory,
            summary: keepUnchanged(
              get().inventoriesByMachineId[machineId]?.summary,
              applyOptimisticMutations(serverSummary, pending),
            ),
            serverSummary,
          },
        },
        pendingMutationsByMachineId: setPendingMutations(machineId, pending),
      });
    },

    acknowledgeAttentionLocally: (machineId, sessionId) => {
      const inventory = get().inventoriesByMachineId[machineId];
      const serverSummary = inventory?.serverSummary ?? inventory?.summary;
      if (inventory === undefined || serverSummary === null || serverSummary === undefined) {
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
            summary: keepUnchanged(
              get().inventoriesByMachineId[machineId]?.summary,
              applyOptimisticMutations(nextServerSummary, pending),
            ),
            fingerprint: null,
          },
        },
      });
    },
  };
});

/** A synced value or one of the phone's own Sessions list switches changed: every list is laid out again. */
function reorganizeAll(): void {
  const { inventoriesByMachineId, pendingMutationsByMachineId } = useInventoryStore.getState();
  let changed = false;
  const next: Record<string, MachineInventory> = {};
  for (const [machineId, inventory] of Object.entries(inventoriesByMachineId)) {
    if (inventory.serverSummary === null) {
      next[machineId] = inventory;
      continue;
    }
    const summary = keepUnchanged(
      inventory.summary,
      applyOptimisticMutations(inventory.serverSummary, pendingMutationsByMachineId[machineId] ?? []),
    );
    if (summary === inventory.summary) {
      next[machineId] = inventory;
      continue;
    }
    changed = true;
    next[machineId] = { ...inventory, summary };
  }
  if (changed) useInventoryStore.setState({ inventoriesByMachineId: next });
}

useSyncedEntriesStore.subscribe((state, previous) => {
  if (state.values !== previous.values) reorganizeAll();
});
useSettingsStore.subscribe((state, previous) => {
  const own = (settings: typeof state.settings) =>
    `${settings.sessionsListLayout}|${settings.sessionsListGroupByProject}|${settings.sessionsListWorkingSection}|${settings.sessionsListHideProjectsWithoutSessions}`;
  if (own(state.settings) !== own(previous.settings)) reorganizeAll();
});

// A computer that pushes its list shows each change as it arrives, not on the next poll tick.
onPushedListChanged((machineId) => {
  const store = useInventoryStore.getState();
  if (!store.polling) return;
  const machine = enabledMachines(useMachinesStore.getState()).find((entry) => entry.id === machineId);
  if (machine !== undefined) void store.refreshMachine(machine);
});
