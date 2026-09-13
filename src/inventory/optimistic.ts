import { cloneCollectionsState } from '../contract/collectionsState';
import {
  parseProjectCollections,
  type GhostexMobileSummary,
  type GhostexSession,
} from '../contract/mobileSummary';

export type OptimisticSessionPatch = Partial<
  Pick<
    GhostexSession,
    | 'title'
    | 'displayTitle'
    | 'displayTitleTooltip'
    | 'isPinned'
    | 'isParked'
    | 'sessionTag'
    | 'sessionNote'
    | 'isSleeping'
    | 'isLive'
    | 'status'
    | 'activity'
    | 'nativePaneState'
  >
>;

export type OptimisticInventoryChange =
  | {
      kind: 'sessionPatch';
      sessionId: string;
      patch: OptimisticSessionPatch;
      confirmPatch: OptimisticSessionPatch;
    }
  | { kind: 'sessionClose'; sessionId: string }
  | { kind: 'projectCollections'; state: unknown }
  | { kind: 'projectOrder'; projectOrder: string[] };

export type PendingInventoryMutation = {
  id: string;
  change: OptimisticInventoryChange;
  phase: 'inFlight' | 'committed';
  confirmAfterRevision: number | null;
  confirmationMisses: number;
};

export type ReconciledInventory = {
  summary: GhostexMobileSummary;
  pending: PendingInventoryMutation[];
  divergentMutationIds: string[];
};

export const MAX_OPTIMISTIC_CONFIRMATION_MISSES = 3;

export function optimisticChangeResourceKey(change: OptimisticInventoryChange): string {
  switch (change.kind) {
    case 'sessionPatch':
    case 'sessionClose':
      return `session:${change.sessionId}`;
    case 'projectCollections':
      return 'project-collections';
    case 'projectOrder':
      return 'project-order';
  }
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function canonicalCollectionsState(raw: unknown): string {
  const state = cloneCollectionsState(raw);
  const collectionIds = [...state.order];
  for (const collectionId of Object.keys(state.collections).sort()) {
    if (!collectionIds.includes(collectionId)) collectionIds.push(collectionId);
  }
  return JSON.stringify({
    order: collectionIds,
    collections: collectionIds.map((collectionId) => {
      const collection = state.collections[collectionId];
      return collection === undefined
        ? null
        : {
            collectionId,
            title: collection.title,
            color: collection.color,
            projectIds: collection.projectIds,
          };
    }),
    nextCollectionNumber: state.nextCollectionNumber,
  });
}

function applyChange(
  summary: GhostexMobileSummary,
  change: OptimisticInventoryChange,
): GhostexMobileSummary {
  switch (change.kind) {
    case 'sessionPatch':
      return {
        ...summary,
        sessions: summary.sessions.map((session) =>
          session.sessionId === change.sessionId ? { ...session, ...change.patch } : session,
        ),
      };
    case 'sessionClose':
      return {
        ...summary,
        sessions: summary.sessions.filter((session) => session.sessionId !== change.sessionId),
      };
    case 'projectCollections':
      return {
        ...summary,
        projectCollections: parseProjectCollections(change.state),
        projectCollectionsState: change.state,
      };
    case 'projectOrder':
      return {
        ...summary,
        workspaceGroups: {
          projectOrder: [...change.projectOrder],
          projects: summary.workspaceGroups?.projects ?? {},
        },
      };
  }
}

function changeIsConfirmed(
  summary: GhostexMobileSummary,
  change: OptimisticInventoryChange,
): boolean {
  switch (change.kind) {
    case 'sessionPatch': {
      const session = summary.sessions.find((entry) => entry.sessionId === change.sessionId);
      if (session === undefined) return false;
      return Object.entries(change.confirmPatch).every(
        ([key, value]) => session[key as keyof OptimisticSessionPatch] === value,
      );
    }
    case 'sessionClose':
      return !summary.sessions.some((session) => session.sessionId === change.sessionId);
    case 'projectCollections':
      return (
        canonicalCollectionsState(summary.projectCollectionsState) ===
        canonicalCollectionsState(change.state)
      );
    case 'projectOrder':
      return arraysEqual(summary.workspaceGroups?.projectOrder ?? [], change.projectOrder);
  }
}

export function applyOptimisticMutations(
  summary: GhostexMobileSummary,
  pending: readonly PendingInventoryMutation[],
): GhostexMobileSummary {
  return pending.reduce(
    (current, mutation) => applyChange(current, mutation.change),
    summary,
  );
}

/**
 * Rebase pending mutations over a fresh server summary. In-flight mutations
 * are never reconciled against a request that may have started before their
 * command. Committed mutations get three authoritative snapshots to appear;
 * after that, server truth wins and the divergence is logged by the store.
 */
export function reconcileOptimisticMutations(
  serverSummary: GhostexMobileSummary,
  pending: PendingInventoryMutation[],
  refreshRevision: number,
): ReconciledInventory {
  let changed = false;
  const divergentMutationIds: string[] = [];
  const remaining: PendingInventoryMutation[] = [];
  const confirmedThroughIndexByResource = new Map<string, number>();

  pending.forEach((mutation, index) => {
    if (
      mutation.phase !== 'committed' ||
      mutation.confirmAfterRevision === null ||
      refreshRevision < mutation.confirmAfterRevision ||
      !changeIsConfirmed(serverSummary, mutation.change)
    ) {
      return;
    }
    confirmedThroughIndexByResource.set(
      optimisticChangeResourceKey(mutation.change),
      index,
    );
  });

  for (let index = 0; index < pending.length; index++) {
    const mutation = pending[index];
    if (
      mutation.phase === 'inFlight' ||
      mutation.confirmAfterRevision === null ||
      refreshRevision < mutation.confirmAfterRevision
    ) {
      remaining.push(mutation);
      continue;
    }
    const confirmedThrough =
      confirmedThroughIndexByResource.get(optimisticChangeResourceKey(mutation.change)) ?? -1;
    if (index <= confirmedThrough) {
      changed = true;
      if (!changeIsConfirmed(serverSummary, mutation.change)) {
        divergentMutationIds.push(mutation.id);
      }
      continue;
    }
    if (changeIsConfirmed(serverSummary, mutation.change)) {
      changed = true;
      continue;
    }
    const confirmationMisses = mutation.confirmationMisses + 1;
    if (confirmationMisses >= MAX_OPTIMISTIC_CONFIRMATION_MISSES) {
      changed = true;
      divergentMutationIds.push(mutation.id);
      continue;
    }
    changed = true;
    remaining.push({ ...mutation, confirmationMisses });
  }

  const reconciledPending = changed ? remaining : pending;
  return {
    summary: applyOptimisticMutations(serverSummary, reconciledPending),
    pending: reconciledPending,
    divergentMutationIds,
  };
}
