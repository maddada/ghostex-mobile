/**
 * Shared session-command runtime.
 *
 * Extracted verbatim from SessionsScreen so the Terminal screen's Agent
 * Actions menu runs session mutations through the SAME serialized queue and
 * optimistic-inventory bookkeeping. Two copies of `remoteMutationQueues` would
 * let a sleep from the terminal header race a sleep from the drawer for one
 * session, so this module owns the only queue map in the app.
 */

import { runGhostexCli, type CliJsonResult } from '../components/sessions/cli';
import {
  optimisticChangeResourceKey,
  type OptimisticInventoryChange,
} from '../inventory/optimistic';
import { useInventoryStore } from '../inventory/store';
import type { MachineRecord } from '../machines/store';
import { useTerminalStore } from '../terminal/sessions';

/** Agent icons whose sessions gxserver can fork (desktop sidebar parity). */
export const FORK_AGENT_ICONS = ['codex', 'claude', 'pi'];

const remoteMutationQueues = new Map<string, Promise<void>>();

export async function enqueueRemoteMutation(
  machineId: string,
  resourceKey: string,
  run: () => Promise<void>,
): Promise<void> {
  const queueKey = `${machineId}:${resourceKey}`;
  const previous = remoteMutationQueues.get(queueKey) ?? Promise.resolve();
  const scheduled = previous.catch(() => undefined).then(run);
  remoteMutationQueues.set(queueKey, scheduled);
  try {
    await scheduled;
  } finally {
    if (remoteMutationQueues.get(queueKey) === scheduled) {
      remoteMutationQueues.delete(queueKey);
    }
  }
}

export function pinMutation(sessionId: string, isPinned: boolean): OptimisticInventoryChange {
  return {
    kind: 'sessionPatch',
    sessionId,
    patch: { isPinned },
    confirmPatch: { isPinned },
  };
}

export function tagMutation(sessionId: string, tag: string): OptimisticInventoryChange {
  const sessionTag = tag === 'none' ? '' : tag;
  return {
    kind: 'sessionPatch',
    sessionId,
    patch: { sessionTag },
    confirmPatch: { sessionTag },
  };
}

/**
 * Session note write. The saved note is trimmed by gxserver before it reaches
 * presentation, so the optimistic row has to carry the trimmed text or the
 * confirmation would never match the server's own answer.
 */
export function sessionNoteMutation(
  sessionId: string,
  note: string,
): OptimisticInventoryChange {
  const sessionNote = note.trim();
  return {
    kind: 'sessionPatch',
    sessionId,
    patch: { sessionNote },
    confirmPatch: { sessionNote },
  };
}

export function renameMutation(sessionId: string, title: string): OptimisticInventoryChange {
  return {
    kind: 'sessionPatch',
    sessionId,
    patch: { title, displayTitle: title, displayTitleTooltip: title },
    confirmPatch: { title },
  };
}

export function lifecycleMutation(
  sessionId: string,
  sleeping: boolean,
): OptimisticInventoryChange {
  return sleeping
    ? {
        kind: 'sessionPatch',
        sessionId,
        patch: {
          isSleeping: true,
          isLive: false,
          status: 'sleep',
          activity: 'sleep',
          nativePaneState: 'unmounted',
        },
        confirmPatch: { isSleeping: true },
      }
    : {
        kind: 'sessionPatch',
        sessionId,
        patch: {
          isSleeping: false,
          isLive: true,
          status: 'idle',
          activity: 'idle',
          nativePaneState: 'mounted',
        },
        confirmPatch: { isSleeping: false },
      };
}

export type RunSessionCommandOptions = {
  /** Drop this session's warm native surface before running (sleep/kill). */
  closeWarmSessionId?: string;
  optimisticChange?: OptimisticInventoryChange;
  /** Already-summarized failure text; callers render it in their own status UI. */
  onError?: (message: string) => void;
};

/**
 * Run one session-mutating CLI command with optimistic inventory bookkeeping:
 * begin → (queued) close warm surface → CLI → commit → fresh refresh, with a
 * rollback plus `onError` on any failure.
 *
 * Returns the command's parsed JSON result, or null when it failed — callers
 * that act on the daemon's answer (the agent rename request's
 * `shouldSendAgentRenameCommand`) read it; the rest ignore it.
 */
export async function runSessionCommand(
  target: MachineRecord,
  command: string,
  options?: RunSessionCommandOptions,
): Promise<CliJsonResult | null> {
  const inventory = useInventoryStore.getState();
  const mutationId =
    options?.optimisticChange === undefined
      ? null
      : inventory.beginOptimisticMutations(target.id, [options.optimisticChange])[0];
  const mutationIds = mutationId === null ? [] : [mutationId];
  let result: CliJsonResult | null = null;
  try {
    const run = async (): Promise<void> => {
      if (options?.closeWarmSessionId !== undefined) {
        await useTerminalStore
          .getState()
          .closeWarmSessionFor(target.id, options.closeWarmSessionId);
      }
      result = await runGhostexCli(target, command);
      if (mutationIds.length > 0) {
        useInventoryStore.getState().commitOptimisticMutations(target.id, mutationIds);
      }
    };
    if (options?.optimisticChange === undefined) {
      await run();
    } else {
      await enqueueRemoteMutation(
        target.id,
        optimisticChangeResourceKey(options.optimisticChange),
        run,
      );
    }
    await useInventoryStore.getState().refreshMachineFresh(target);
    return result;
  } catch (error) {
    if (mutationIds.length > 0) {
      useInventoryStore.getState().rollbackOptimisticMutations(target.id, mutationIds);
    }
    options?.onError?.(error instanceof Error ? error.message : String(error));
    return null;
  }
}
